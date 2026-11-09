import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, save, get } from "../src/store.ts";
import { resolveMemoriesForCode } from "../src/retrieval/code_context.ts";
import { recallAnchoredMemories } from "../src/retrieval/anchors.ts";
import { resolveMemoryForCode } from "../src/orchestrator/bidirectional.ts";

describe("W26-1: one file→memory resolver", () => {
  test("anchor-only, mention and project scoping agree across adapters", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-code-context-"));
    try {
      const store = openStore(memoryDir);
      const constraint = propose(store, { content: "auth tokens must rotate", project: "p", type: "constraint", confirmed: true });
      save(store, { ...get(store, constraint.id)!, anchors: [{ id: "a1", kind: "file", file_path: "src/auth.ts" }] });

      const prose = propose(store, { content: "see src/auth.ts before editing the session", project: "p", type: "discovery", confirmed: true });
      const foreign = propose(store, { content: "foreign auth rule", project: "other", type: "constraint", confirmed: true });
      save(store, { ...get(store, foreign.id)!, anchors: [{ id: "a2", kind: "file", file_path: "src/auth.ts" }] });

      const anchored = resolveMemoriesForCode(store, { files: ["src/auth.ts"], project: "p" });
      expect(anchored.map((item) => item.entry.id)).toEqual([constraint.id]);
      expect(anchored[0].why_retrieved?.[0]).toContain("anchor:file");

      const withMentions = resolveMemoriesForCode(store, { files: ["src/auth.ts"], project: "p", includeMentions: true });
      expect(withMentions.map((item) => item.entry.id)).toContain(prose.id);
      expect(withMentions[0].entry.id).toBe(constraint.id);

      const preflight = recallAnchoredMemories(store, { files: ["src/auth.ts"], project: "p" });
      const prContext = resolveMemoryForCode(store, { filePath: "src/auth.ts", project: "p" });
      expect(preflight.map((item) => item.entry.id)).toEqual([constraint.id]);
      expect(prContext.constraints.map((entry) => entry.id)).toContain(constraint.id);
      expect(prContext.constraints.map((entry) => entry.id)).not.toContain(foreign.id);
      expect(prContext.associated_memories.map((entry) => entry.id)).toContain(prose.id);
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });
});
