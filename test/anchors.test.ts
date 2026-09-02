import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, save, get } from "../src/store.ts";
import {
  computeStructuralHash,
  normalizeStructuralCode,
  extractSymbolBody,
  createCodeAnchor,
  verifyCodeAnchor,
  attachAnchorToMemory,
  auditMemoryAnchors,
} from "../src/anchors/index.ts";
import { createServer } from "../src/mcp.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("R8: Native Code Anchors & Stable Structural Code Identity", () => {
  let tmpDir: string;
  let store: ReturnType<typeof openStore>;
  let codeDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-anchor-test-"));
    store = openStore(join(tmpDir, ".memory"));
    codeDir = join(tmpDir, "src");
    mkdirSync(codeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Structural Fingerprinting & Normalization", () => {
    it("strips comments and normalizes whitespace", () => {
      const codeWithComments = `
        // This is a test comment
        export function calculateTotal(price: number, tax: number): number {
          /* Multi-line
             comment block */
          return price + (price * tax);
        }
      `;

      const normalized = normalizeStructuralCode(codeWithComments);
      expect(normalized).not.toContain("This is a test comment");
      expect(normalized).not.toContain("Multi-line");
      expect(normalized).toContain("calculateTotal(price: number,tax: number): number{return price +(price * tax);}");
    });

    it("produces identical structural hashes despite comment and line formatting changes", () => {
      const codeA = `
        export function authenticate(user: string, token: string): boolean {
          if (!user || !token) return false;
          return token === "secret";
        }
      `;

      const codeB = `
        // Added documentation comment
        // Line shifted down
        export function authenticate(
          user: string, 
          token: string
        ): boolean {
          /* Check validity */
          if (!user || !token) return false;

          return token === "secret";
        }
      `;

      const hashA = computeStructuralHash(codeA);
      const hashB = computeStructuralHash(codeB);

      expect(hashA).toBe(hashB);
    });

    it("produces different structural hashes when logical code changes", () => {
      const codeA = `
        export function validate(val: string): boolean {
          return val.length > 5;
        }
      `;

      const codeB = `
        export function validate(val: string): boolean {
          return val.length > 10;
        }
      `;

      const hashA = computeStructuralHash(codeA);
      const hashB = computeStructuralHash(codeB);

      expect(hashA).not.toBe(hashB);
    });

    it("extracts symbol signature and balanced body correctly", () => {
      const source = `
        export class PaymentProcessor {
          async processPayment(amount: number, currency: string): Promise<boolean> {
            if (amount <= 0) {
              throw new Error("Invalid amount");
            }
            return true;
          }
        }
      `;

      const extracted = extractSymbolBody(source, "processPayment");
      expect(extracted.found).toBe(true);
      expect(extracted.signature).toContain("processPayment");
      expect(extracted.body).toContain("throw new Error");
      expect(extracted.body).toContain("return true;");
    });
  });

  describe("Anchor Creation & Verification", () => {
    it("creates a valid anchor for an existing symbol", () => {
      const authFile = join(codeDir, "auth.ts");
      writeFileSync(
        authFile,
        `export function verifySession(token: string): boolean {\n  return token.length > 10;\n}\n`
      );

      const anchor = createCodeAnchor(tmpDir, {
        kind: "symbol",
        filePath: "src/auth.ts",
        symbolName: "verifySession",
        qualifiedName: "auth.verifySession",
      });

      expect(anchor.status).toBe("valid");
      expect(anchor.symbol_name).toBe("verifySession");
      expect(anchor.structural_hash).toBeDefined();
      expect(anchor.signature).toContain("verifySession");

      // Verify anchor immediately
      const verification = verifyCodeAnchor(tmpDir, anchor);
      expect(verification.status).toBe("valid");
      expect(verification.file_exists).toBe(true);
      expect(verification.symbol_exists).toBe(true);
      expect(verification.hash_matched).toBe(true);
    });

    it("maintains valid anchor verification across line movements and extra comments", () => {
      const serviceFile = join(codeDir, "service.ts");
      writeFileSync(
        serviceFile,
        `export function executeJob(id: string): void {\n  console.log("job", id);\n}\n`
      );

      const anchor = createCodeAnchor(tmpDir, {
        kind: "symbol",
        filePath: "src/service.ts",
        symbolName: "executeJob",
      });
      expect(anchor.status).toBe("valid");

      // Shift line numbers and add comments
      writeFileSync(
        serviceFile,
        `// Header license\n// 5 new lines\n\n\n\nexport function executeJob(id: string): void {\n  /* log */\n  console.log("job", id);\n}\n`
      );

      const verification = verifyCodeAnchor(tmpDir, anchor);
      expect(verification.status).toBe("valid");
      expect(verification.hash_matched).toBe(true);
    });

    it("detects drifted anchor when symbol implementation changes", () => {
      const mathFile = join(codeDir, "math.ts");
      writeFileSync(
        mathFile,
        `export function computeRate(a: number): number {\n  return a * 1.5;\n}\n`
      );

      const anchor = createCodeAnchor(tmpDir, {
        kind: "symbol",
        filePath: "src/math.ts",
        symbolName: "computeRate",
      });
      expect(anchor.status).toBe("valid");

      // Mutate logic
      writeFileSync(
        mathFile,
        `export function computeRate(a: number): number {\n  return a * 2.0;\n}\n`
      );

      const verification = verifyCodeAnchor(tmpDir, anchor);
      expect(verification.status).toBe("drifted");
      expect(verification.hash_matched).toBe(false);
      expect(verification.drift_details).toContain("Structural code hash mismatch");
    });

    it("detects orphaned anchor when symbol is deleted from file", () => {
      const utilFile = join(codeDir, "util.ts");
      writeFileSync(
        utilFile,
        `export function legacyHelper(): string {\n  return "old";\n}\n`
      );

      const anchor = createCodeAnchor(tmpDir, {
        kind: "symbol",
        filePath: "src/util.ts",
        symbolName: "legacyHelper",
      });
      expect(anchor.status).toBe("valid");

      // Replace with different function
      writeFileSync(
        utilFile,
        `export function modernHelper(): string {\n  return "new";\n}\n`
      );

      const verification = verifyCodeAnchor(tmpDir, anchor);
      expect(verification.status).toBe("orphaned");
      expect(verification.symbol_exists).toBe(false);
      expect(verification.drift_details).toContain("Symbol 'legacyHelper' no longer found");
    });

    it("detects orphaned anchor when file is deleted", () => {
      const tempFile = join(codeDir, "temp.ts");
      writeFileSync(tempFile, `export const x = 42;\n`);

      const anchor = createCodeAnchor(tmpDir, {
        kind: "file",
        filePath: "src/temp.ts",
      });
      expect(anchor.status).toBe("valid");

      // Delete file
      rmSync(tempFile);

      const verification = verifyCodeAnchor(tmpDir, anchor);
      expect(verification.status).toBe("orphaned");
      expect(verification.file_exists).toBe(false);
      expect(verification.drift_details).toContain("File 'src/temp.ts' does not exist");
    });
  });

  describe("Memory Attachment & Repository-wide Audit", () => {
    it("attaches anchor to memory entry with audit event", () => {
      const routerFile = join(codeDir, "router.ts");
      writeFileSync(routerFile, `export function routeRequest() { return 200; }`);

      const entry: MemoryEntry = {
        id: "m_801_router",
        title: "Router Dispatch Contract",
        content: "Always handle errors in routeRequest before responding.",
        project: "api",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["routing"],
      };
      save(store, entry);

      const anchor = createCodeAnchor(tmpDir, {
        kind: "symbol",
        filePath: "src/router.ts",
        symbolName: "routeRequest",
      });

      const updated = attachAnchorToMemory(store, entry.id, anchor);
      expect(updated.anchors).toBeDefined();
      expect(updated.anchors?.length).toBe(1);
      expect(updated.anchors?.[0].file_path).toBe("src/router.ts");

      // Verify audit log
      const auditLog = readFileSync(join(store.memoryDir!, "audit.jsonl"), "utf8");
      expect(auditLog).toContain('"operation":"anchor_created"');
    });

    it("runs auditMemoryAnchors across multiple memories and computes integrity score", () => {
      const fileA = join(codeDir, "a.ts");
      const fileB = join(codeDir, "b.ts");
      const fileC = join(codeDir, "c.ts");

      writeFileSync(fileA, `export function funcA() { return 1; }`);
      writeFileSync(fileB, `export function funcB() { return 2; }`);
      writeFileSync(fileC, `export function funcC() { return 3; }`);

      const ancA = createCodeAnchor(tmpDir, { kind: "symbol", filePath: "src/a.ts", symbolName: "funcA" });
      const ancB = createCodeAnchor(tmpDir, { kind: "symbol", filePath: "src/b.ts", symbolName: "funcB" });
      const ancC = createCodeAnchor(tmpDir, { kind: "symbol", filePath: "src/c.ts", symbolName: "funcC" });

      const entryA: MemoryEntry = {
        id: "m_802_a",
        title: "Module A invariant",
        content: "Rule for funcA",
        project: "test",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["a"],
        anchors: [ancA],
      };

      const entryB: MemoryEntry = {
        id: "m_803_b",
        title: "Module B invariant",
        content: "Rule for funcB",
        project: "test",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["b"],
        anchors: [ancB],
      };

      const entryC: MemoryEntry = {
        id: "m_804_c",
        title: "Module C invariant",
        content: "Rule for funcC",
        project: "test",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["c"],
        anchors: [ancC],
      };

      save(store, entryA);
      save(store, entryB);
      save(store, entryC);

      // Now: mutate B (drift) and delete C (orphaned)
      writeFileSync(fileB, `export function funcB() { return 999; }`); // changed
      rmSync(fileC); // deleted

      const auditReport = auditMemoryAnchors(store, tmpDir);

      expect(auditReport.total_anchors).toBe(3);
      expect(auditReport.valid_anchors).toBe(1);
      expect(auditReport.drifted_anchors).toBe(1);
      expect(auditReport.orphaned_anchors).toBe(1);
      expect(auditReport.integrity_score).toBe(0.33);

      // Verify entries updated in store
      const refreshedB = get(store, entryB.id);
      expect(refreshedB?.anchors?.[0].status).toBe("drifted");

      const refreshedC = get(store, entryC.id);
      expect(refreshedC?.anchors?.[0].status).toBe("orphaned");
    });
  });

  describe("MCP Tool Execution", () => {
    it("creates, verifies, and audits anchors through MCP tools", async () => {
      const dbFile = join(codeDir, "db.ts");
      writeFileSync(dbFile, `export function connectDb() { return "connected"; }`);

      const entry: MemoryEntry = {
        id: "m_805_db",
        title: "Database connection pattern",
        content: "Use connectDb with 5s timeout.",
        project: "db",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["db"],
      };
      save(store, entry);

      const server = createServer(tmpDir);
      const callHandler = (server as any)._requestHandlers.get("tools/call");

      // 1. memory_anchor_create
      const createRes = await callHandler({
        method: "tools/call",
        params: {
          name: "memory_anchor_create",
          arguments: {
            memory_id: entry.id,
            file_path: "src/db.ts",
            symbol_name: "connectDb",
            dir: tmpDir,
          },
        },
      });
      expect(createRes.isError).toBeFalsy();
      const createData = JSON.parse(createRes.content[0].text);
      expect(createData.anchor.status).toBe("valid");
      expect(createData.total_anchors).toBe(1);

      // 2. memory_anchor_verify
      const verifyRes = await callHandler({
        method: "tools/call",
        params: {
          name: "memory_anchor_verify",
          arguments: {
            memory_id: entry.id,
            dir: tmpDir,
          },
        },
      });
      expect(verifyRes.isError).toBeFalsy();
      const verifyData = JSON.parse(verifyRes.content[0].text);
      expect(verifyData.verification[0].status).toBe("valid");

      // 3. memory_anchor_audit
      const auditRes = await callHandler({
        method: "tools/call",
        params: {
          name: "memory_anchor_audit",
          arguments: {
            dir: tmpDir,
          },
        },
      });
      expect(auditRes.isError).toBeFalsy();
      const auditData = JSON.parse(auditRes.content[0].text);
      expect(auditData.total_anchors).toBe(1);
      expect(auditData.valid_anchors).toBe(1);
      expect(auditData.integrity_score).toBe(1.0);
    });
  });
});
