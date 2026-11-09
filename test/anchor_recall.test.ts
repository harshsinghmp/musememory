import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, save, get } from "../src/store.ts";
import { recallAnchoredMemories } from "../src/retrieval/anchors.ts";

describe("T-435: AST-anchored invariant auto-recall", () => {
  test("surfaces anchored constraints by file and symbol, ranked first", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-anchors-"));
    try {
      const store = openStore(memoryDir);
      const constraint = propose(store, { content: "auth tokens must rotate", project: "p", type: "constraint", confirmed: true });
      const discovery = propose(store, { content: "auth note", project: "p", confirmed: true });
      save(store, { ...get(store, constraint.id)!, anchors: [{ id: "a1", kind: "file", file_path: "src/auth.ts" }] });
      save(store, { ...get(store, discovery.id)!, anchors: [{ id: "a2", kind: "symbol", file_path: "src/util.ts", symbol_name: "hashToken" }] });

      const byFile = recallAnchoredMemories(store, { files: ["src/auth.ts"] });
      expect(byFile.map((item) => item.entry.id)).toEqual([constraint.id]);
      expect(byFile[0].why_retrieved?.[0]).toContain("anchor:file:src/auth.ts");

      const bySymbol = recallAnchoredMemories(store, { symbols: ["hashToken"] });
      expect(bySymbol.map((item) => item.entry.id)).toEqual([discovery.id]);
      expect(recallAnchoredMemories(store, { files: ["src/none.ts"] })).toEqual([]);

      const foreign = propose(store, { content: "foreign constraint", project: "other", type: "constraint", confirmed: true });
      save(store, { ...get(store, foreign.id)!, anchors: [{ id: "a3", kind: "file", file_path: "src/auth.ts" }] });
      expect(recallAnchoredMemories(store, { files: ["src/auth.ts"], project: "p" }).map((i) => i.entry.id)).toEqual([constraint.id]);

      save(store, { ...get(store, constraint.id)!, anchors: [{ id: "a1", kind: "file", file_path: "src/auth.ts", status: "orphaned" }] });
      expect(recallAnchoredMemories(store, { files: ["src/auth.ts"], project: "p" })).toEqual([]);
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });
});
