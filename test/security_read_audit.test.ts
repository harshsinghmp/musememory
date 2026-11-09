import { describe, test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, save, get } from "../src/store.ts";
import { resolveMemoriesForCode, resolveProjectIdentity } from "../src/retrieval/code_context.ts";
import { getAuditTrail } from "../src/audit.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "muse-read-audit-"));
  const memoryDir = join(root, ".memory");
  mkdirSync(memoryDir, { recursive: true });
  const store = openStore(memoryDir);
  return { root, memoryDir, store };
}

describe("security: sensitive reads and project identity", () => {
  test("cross-project and untrusted reads are audited; normal reads are not", () => {
    const { memoryDir, store } = fixture();
    try {
      const own = propose(store, { content: "own", project: "p", type: "constraint", confirmed: true });
      save(store, { ...get(store, own.id)!, anchors: [{ id: "a1", kind: "file", file_path: "src/a.ts" }] });
      const foreign = propose(store, { content: "foreign", project: "other", type: "constraint", confirmed: true });
      save(store, { ...get(store, foreign.id)!, anchors: [{ id: "a2", kind: "file", file_path: "src/a.ts" }] });

      resolveMemoriesForCode(store, { files: ["src/a.ts"], project: "p" });
      expect(getAuditTrail(memoryDir, { operation: "read" })).toHaveLength(0);

      resolveMemoriesForCode(store, { files: ["src/a.ts"], scope: "all" });
      resolveMemoriesForCode(store, { files: ["src/a.ts"], project: "p", includeUntrusted: true });
      const reads = getAuditTrail(memoryDir, { operation: "read" });
      expect(reads).toHaveLength(2);
      expect(reads.map((entry) => entry.reason).sort()).toEqual(["cross_project_read", "untrusted_read"]);
    } finally {
      rmSync(join(memoryDir, ".."), { recursive: true, force: true });
    }
  });

  test("configured project identity overrides dominant inference", () => {
    const { memoryDir, store } = fixture();
    try {
      propose(store, { content: "one", project: "p", confirmed: true });
      propose(store, { content: "two", project: "p", confirmed: true });
      propose(store, { content: "three", project: "other", confirmed: true });
      writeFileSync(join(memoryDir, "config.json"), JSON.stringify({ project: "other" }), "utf8");
      expect(resolveProjectIdentity(store)).toEqual({ project: "other", source: "config" });
    } finally {
      rmSync(join(memoryDir, ".."), { recursive: true, force: true });
    }
  });
});
