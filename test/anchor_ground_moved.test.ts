import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, save, propose, type Store } from "../src/store.ts";
import {
  createCodeAnchor,
  verifyCodeAnchor,
  auditMemoryAnchors,
  formatAnchorAuditReport,
  findRelocatedSymbol,
} from "../src/anchors/index.ts";
import type { CodeAnchor } from "../src/types.ts";

describe("T-134: ground-moved reporting for anchors (silent when undeterminable)", () => {
  let tmpDir: string;
  let workspaceRoot: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-anchor-ground-"));
    workspaceRoot = join(tmpDir, "repo");
    mkdirSync(join(workspaceRoot, "src"), { recursive: true });
    store = openStore(join(tmpDir, "memories"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Proven Ground Movements (Determinable)", () => {
    it("reports ground-moved when symbol body hash changes", () => {
      const authPath = join(workspaceRoot, "src", "auth.ts");
      writeFileSync(
        authPath,
        `export function authenticateUser(token: string): boolean {\n  return token.length > 10;\n}\n`
      );

      // Create anchor with baseline structural hash
      const anchor = createCodeAnchor(workspaceRoot, {
        kind: "symbol",
        filePath: "src/auth.ts",
        symbolName: "authenticateUser",
      });

      expect(anchor.structural_hash).toBeDefined();

      // Mutate symbol implementation
      writeFileSync(
        authPath,
        `export function authenticateUser(token: string): boolean {\n  // Completely new auth logic\n  return verifyJwtSignature(token) && checkExpiry(token);\n}\n`
      );

      const verification = verifyCodeAnchor(workspaceRoot, anchor);
      expect(verification.status).toBe("drifted");
      expect(verification.ground_moved).toBe(true);
      expect(verification.undeterminable).toBe(false);
      expect(verification.ground_moved_details).toContain("Structural code body changed");
    });

    it("reports ground-moved with relocated_path when symbol is moved to another file", () => {
      const oldPath = join(workspaceRoot, "src", "legacy_auth.ts");
      writeFileSync(
        oldPath,
        `export function validateSession(id: string): boolean {\n  return id.startsWith("sess_");\n}\n`
      );

      const anchor = createCodeAnchor(workspaceRoot, {
        kind: "symbol",
        filePath: "src/legacy_auth.ts",
        symbolName: "validateSession",
      });

      // Move symbol to new module and remove from old file
      writeFileSync(oldPath, `// legacy_auth is now deprecated\nexport const DEPRECATED = true;\n`);
      const newPath = join(workspaceRoot, "src", "session_service.ts");
      writeFileSync(
        newPath,
        `export function validateSession(id: string): boolean {\n  return id.startsWith("sess_");\n}\n`
      );

      const verification = verifyCodeAnchor(workspaceRoot, anchor);
      expect(verification.status).toBe("orphaned");
      expect(verification.ground_moved).toBe(true);
      expect(verification.relocated_path).toBe("src/session_service.ts");
      expect(verification.ground_moved_details).toContain("relocated from 'src/legacy_auth.ts' to 'src/session_service.ts'");
      expect(verification.undeterminable).toBe(false);
    });

    it("reports ground-moved when file was removed from disk with known baseline hash", () => {
      const helperPath = join(workspaceRoot, "src", "helper.ts");
      writeFileSync(helperPath, `export function formatData(d: any) { return String(d); }\n`);

      const anchor = createCodeAnchor(workspaceRoot, {
        kind: "file",
        filePath: "src/helper.ts",
      });
      expect(anchor.structural_hash).toBeDefined();

      // Delete file
      rmSync(helperPath);

      const verification = verifyCodeAnchor(workspaceRoot, anchor);
      expect(verification.status).toBe("orphaned");
      expect(verification.ground_moved).toBe(true);
      expect(verification.ground_moved_details).toContain("File 'src/helper.ts' was removed from disk");
      expect(verification.undeterminable).toBe(false);
    });
  });

  describe("Strictly Silent When Undeterminable (No False Alarms)", () => {
    it("stays silent when anchor lacks structural hash and file/symbol exists", () => {
      const filePath = join(workspaceRoot, "src", "constants.ts");
      writeFileSync(filePath, `export const API_TIMEOUT_MS = 5000;\n`);

      // Anchor without structural hash baseline
      const anchor: CodeAnchor = {
        id: "anc_no_hash",
        kind: "file",
        file_path: "src/constants.ts",
        status: "valid",
      };

      const verification = verifyCodeAnchor(workspaceRoot, anchor);
      expect(verification.status).toBe("valid");
      expect(verification.ground_moved).toBe(false);
      expect(verification.undeterminable).toBe(true);
      expect(verification.ground_moved_details).toBeUndefined();
    });

    it("stays silent when cited file is missing and lacks structural hash baseline", () => {
      const anchor: CodeAnchor = {
        id: "anc_missing_untracked",
        kind: "file",
        file_path: "src/non_existent.ts",
        status: "orphaned",
      };

      const verification = verifyCodeAnchor(workspaceRoot, anchor);
      expect(verification.status).toBe("orphaned");
      // Must not falsely claim ground moved without baseline evidence
      expect(verification.ground_moved).toBe(false);
      expect(verification.undeterminable).toBe(true);
      expect(verification.ground_moved_details).toBeUndefined();
    });

    it("stays silent when symbol is missing without baseline hash and not found in workspace", () => {
      const filePath = join(workspaceRoot, "src", "empty.ts");
      writeFileSync(filePath, `export const x = 1;\n`);

      const anchor: CodeAnchor = {
        id: "anc_symbol_untracked",
        kind: "symbol",
        file_path: "src/empty.ts",
        symbol_name: "missingSymbol",
        status: "orphaned",
      };

      const verification = verifyCodeAnchor(workspaceRoot, anchor);
      expect(verification.status).toBe("orphaned");
      expect(verification.ground_moved).toBe(false);
      expect(verification.undeterminable).toBe(true);
      expect(verification.ground_moved_details).toBeUndefined();
    });
  });

  describe("Audit & Reporting Integration", () => {
    it("auditMemoryAnchors records ground-moved count and excludes undeterminable from ground_moved_reports", () => {
      const codeFile = join(workspaceRoot, "src", "logic.ts");
      writeFileSync(codeFile, `export function computeTotal() { return 100; }\n`);

      // Anchor 1: Proven ground moved (hash changed)
      const anc1 = createCodeAnchor(workspaceRoot, {
        kind: "symbol",
        filePath: "src/logic.ts",
        symbolName: "computeTotal",
      });

      // Anchor 2: Undeterminable (no baseline hash)
      const anc2: CodeAnchor = {
        id: "anc_undeterminable",
        kind: "file",
        file_path: "src/logic.ts",
        status: "valid",
      };

      // Save memory with both anchors
      const mem = propose(store, {
        title: "Total computation memory",
        content: "Computes invoice total with tax",
        project: "test",
        type: "decision",
        confirmed: true,
        anchors: [anc1, anc2],
        skipRetentionGate: true,
      });
      save(store, mem);

      // Mutate code for anchor 1
      writeFileSync(codeFile, `export function computeTotal() { return 200 + tax(); }\n`);

      const audit = auditMemoryAnchors(store, workspaceRoot);
      expect(audit.total_anchors).toBe(2);
      expect(audit.ground_moved_anchors).toBe(1);
      expect(audit.undeterminable_anchors).toBe(1);

      // Ground moved report must only contain proven ground-moved anchor, NOT undeterminable
      expect(audit.ground_moved_reports).toBeDefined();
      expect(audit.ground_moved_reports?.length).toBe(1);
      expect(audit.ground_moved_reports?.[0].anchor_id).toBe(anc1.id);

      // Markdown formatting
      const formatted = formatAnchorAuditReport(audit);
      expect(formatted).toContain("## 🚨 Proven Ground-Moved Code Anchors");
      expect(formatted).toContain(anc1.id);
      expect(formatted).not.toContain(anc2.id);
      expect(formatted).toContain("Silent Guard: 1 anchor(s) had undeterminable baseline hashes; stayed silent without false alarms.");
    });
  });
});
