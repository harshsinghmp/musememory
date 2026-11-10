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

  // W26-5: with the LIMIT only on the outer SELECT, SQLite materialised the
  // whole reachable frontier before projecting. On a dense graph that was
  // ~11.5k rows and ~270ms to return at most 100 nodes. The bound now sits
  // inside the recursive member too.
  test("bounds the recursive walk on a dense graph", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-assoc-dense-"));
    try {
      const store = openStore(memoryDir);
      const N = 1200;
      const ids: string[] = [];
      for (let i = 0; i < N; i++) {
        const links: string[] = [];
        for (let k = 1; k <= 50; k++) {
          const t = (i * 50 + k) % N;
          if (t !== i) links.push(`dense_${t}`);
        }
        save(store, {
          id: `dense_${i}`,
          title: `t${i}`,
          content: `c${i}`,
          project: "p",
          status: "confirmed",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          linked_memory_ids: links,
        } as any);
        ids.push(`dense_${i}`);
      }

      const started = performance.now();
      const result = expandAssociativeDetailed(store, [ids[0]], { maxDepth: 5, maxNodes: 100 });
      const elapsed = performance.now() - started;

      // The node cap is still honoured — the fix bounds work, not the answer.
      expect(result.nodes.length).toBeLessThanOrEqual(100);
      expect(result.nodes.length).toBeGreaterThan(0);
      // Generous ceiling: with the inner LIMIT this is ~7ms on a 1200-node
      // dense graph; without it, ~112ms. The bound is set well above the
      // fixed cost and well below the unbounded one, so it fails if the
      // inner LIMIT is ever removed.
      expect(elapsed).toBeLessThan(50);
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });
});
