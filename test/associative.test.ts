import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, save, get } from "../src/store.ts";
import { expandAssociative, expandAssociativeDetailed } from "../src/associative.ts";
import { queryContext } from "../src/retrieval.ts";

function link(store: ReturnType<typeof openStore>, from: string, to: string) {
  const entry = get(store, from)!;
  save(store, { ...entry, linked_memory_ids: [...(entry.linked_memory_ids ?? []), to] });
}

describe("T-432: recursive CTE associative expansion", () => {
  test("walks a cycle once, records depth and excludes seeds", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-assoc-"));
    try {
      const store = openStore(memoryDir);
      const a = propose(store, { content: "alpha auth", project: "p", confirmed: true });
      const b = propose(store, { content: "beta auth", project: "p", confirmed: true });
      const c = propose(store, { content: "gamma auth", project: "p", confirmed: true });
      link(store, a.id, b.id);
      link(store, b.id, c.id);
      link(store, c.id, a.id);

      const nodes = expandAssociative(store, [a.id], { maxDepth: 3 });
      expect(nodes.map((node) => node.id)).toEqual([b.id, c.id]);
      expect(nodes[0].depth).toBe(1);
      expect(nodes[1].depth).toBe(2);

      const result = queryContext(store, "alpha", { associative: true, limit: 1 });
      expect(result.associated?.some((node) => node.id === b.id && node.depth === 1)).toBe(true);

      const other = propose(store, { content: "other project", project: "other", confirmed: true });
      const scoped = propose(store, { content: "scoped alpha", project: "p", confirmed: true });
      link(store, scoped.id, other.id);
      expect(expandAssociative(store, [scoped.id], { project: "p" }).some((n) => n.id === other.id)).toBe(false);

      const broken = { db: { query: () => { throw new Error("no such table"); } } } as any;
      const degraded = expandAssociativeDetailed(broken, ["m_1_x"]);
      expect(degraded.degraded).toBe(true);
      expect(degraded.error).toContain("no such table");
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });
});
