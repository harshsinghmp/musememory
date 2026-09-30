import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, get } from "../src/store.ts";
import {
  createCodeAnchor,
  attachAnchorToMemory,
  enforceWriteTimeVerification,
  formatRejectionError,
} from "../src/anchors/index.ts";
import type { Store } from "../src/store.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("Write-Time Citation Verification (GAP-1)", () => {
  let tmpDir: string;
  let store: Store;
  let workspaceRoot: string;
  let entry: MemoryEntry;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-verify-write-test-"));
    workspaceRoot = join(tmpDir, "workspace");
    const codeDir = join(workspaceRoot, "src");
    mkdirSync(codeDir, { recursive: true });
    writeFileSync(
      join(codeDir, "auth.ts"),
      `export function login(user: string): boolean {\n  return user.length > 0;\n}\n`,
      "utf8",
    );
    store = openStore(join(tmpDir, ".memory"));
    entry = propose(store, { content: "Auth flow uses login() from src/auth.ts", project: "test" });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("admits an anchor that matches live code and stamps verified_at", () => {
    const anchor = createCodeAnchor(workspaceRoot, {
      kind: "symbol",
      filePath: "src/auth.ts",
      symbolName: "login",
    });
    expect(anchor.status).toBe("valid");

    const probe: MemoryEntry = { ...entry, anchors: [anchor] };
    const result = enforceWriteTimeVerification(store, workspaceRoot, probe);

    expect(result.admitted).toBe(true);
    expect(result.rejected).toHaveLength(0);
    expect(result.downgraded).toHaveLength(0);
    expect(probe.anchors?.[0].status).toBe("valid");
    expect(probe.anchors?.[0].verified_at).toBeTruthy();
  });

  it("rejects a hallucinated citation (nonexistent file) under fail_fast", () => {
    const anchor = createCodeAnchor(workspaceRoot, {
      kind: "file",
      filePath: "src/does-not-exist.ts",
    });
    // createCodeAnchor marks it orphaned without a hash — simulate an agent
    // inventing an anchor wholesale to prove the verifier catches it too.
    const fabricated = {
      ...anchor,
      status: "valid" as const,
      structural_hash: "deadbeef",
    };

    const probe: MemoryEntry = { ...entry, anchors: [fabricated] };
    const result = enforceWriteTimeVerification(store, workspaceRoot, probe);

    expect(result.admitted).toBe(false);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].status).toBe("orphaned");
    // The bad anchor must not survive into the entry.
    expect(probe.anchors ?? []).toHaveLength(0);
  });

  it("rejects a hallucinated citation (symbol not in file)", () => {
    const anchor = createCodeAnchor(workspaceRoot, {
      kind: "symbol",
      filePath: "src/auth.ts",
      symbolName: "nonexistentFunction",
    });
    const fabricated = {
      ...anchor,
      status: "valid" as const,
      structural_hash: "deadbeef",
    };

    const probe: MemoryEntry = { ...entry, anchors: [fabricated] };
    const result = enforceWriteTimeVerification(store, workspaceRoot, probe);

    expect(result.admitted).toBe(false);
    expect(result.rejected[0].drift_details).toContain("nonexistentFunction");
  });

  it("flags drifted code (body changed) as downgraded, not rejected, under default policy", () => {
    const anchor = createCodeAnchor(workspaceRoot, {
      kind: "symbol",
      filePath: "src/auth.ts",
      symbolName: "login",
    });
    expect(anchor.status).toBe("valid");

    // Code evolves after the anchor was created.
    writeFileSync(
      join(workspaceRoot, "src", "auth.ts"),
      `export function login(user: string, token?: string): boolean {\n  return user.length > 0 && !!token;\n}\n`,
      "utf8",
    );

    const probe: MemoryEntry = { ...entry, anchors: [anchor] };
    const result = enforceWriteTimeVerification(store, workspaceRoot, probe);

    expect(result.admitted).toBe(true);
    expect(result.downgraded).toHaveLength(1);
    expect(probe.anchors?.[0].status).toBe("drifted");
  });

  it("rejects drifted anchors under strict policy", () => {
    const anchor = createCodeAnchor(workspaceRoot, {
      kind: "symbol",
      filePath: "src/auth.ts",
      symbolName: "login",
    });

    writeFileSync(
      join(workspaceRoot, "src", "auth.ts"),
      `export function login(user: string, token?: string): boolean {\n  return user.length > 0 && !!token;\n}\n`,
      "utf8",
    );

    const probe: MemoryEntry = { ...entry, anchors: [anchor] };
    const result = enforceWriteTimeVerification(store, workspaceRoot, probe, { policy: "strict" });

    expect(result.admitted).toBe(false);
    expect(result.rejected).toHaveLength(1);
  });

  it("strips invalid anchors and proceeds under warn policy", () => {
    const anchor = createCodeAnchor(workspaceRoot, {
      kind: "file",
      filePath: "src/ghost.ts",
    });

    const probe: MemoryEntry = { ...entry, anchors: [anchor] };
    const result = enforceWriteTimeVerification(store, workspaceRoot, probe, { policy: "warn" });

    expect(result.admitted).toBe(true);
    expect(result.downgraded).toHaveLength(1);
    expect(probe.anchors ?? []).toHaveLength(0);
  });

  it("attachAnchorToMemory admits a valid anchor with verification stamps", () => {
    const anchor = createCodeAnchor(workspaceRoot, {
      kind: "symbol",
      filePath: "src/auth.ts",
      symbolName: "login",
    });

    const updated = attachAnchorToMemory(store, entry.id, anchor, "test", { workspaceRoot });
    expect(updated.anchors).toHaveLength(1);
    expect(updated.anchors?.[0].status).toBe("valid");
    expect(updated.anchors?.[0].verified_at).toBeTruthy();
  });

  it("attachAnchorToMemory throws on hallucinated citation by default", () => {
    const fabricated = {
      id: "anc_fabricated",
      kind: "file" as const,
      file_path: "src/never-existed.ts",
      status: "valid" as const,
      structural_hash: "deadbeef",
      created_at: new Date().toISOString(),
      verified_at: new Date().toISOString(),
    };

    expect(() => attachAnchorToMemory(store, entry.id, fabricated as any)).toThrow(
      /hallucinated citation/i,
    );
    const stored = get(store, entry.id);
    expect(stored?.anchors ?? []).toHaveLength(0);
  });

  it("formatRejectionError names the first bad citation", () => {
    const result = {
      admitted: false,
      verdicts: [],
      rejected: [
        {
          anchor_id: "a1",
          file_path: "src/ghost.ts",
          status: "orphaned" as const,
          action: "rejected" as const,
        },
      ],
      downgraded: [],
    };
    const msg = formatRejectionError(result as any);
    expect(msg).toContain("src/ghost.ts");
    expect(msg).toContain("hallucinated citation");
  });
});
