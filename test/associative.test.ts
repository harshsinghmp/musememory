import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, save, get, type Store } from "../src/store.ts";
import { expandAssociative, expandAssociativeDetailed } from "../src/associative.ts";
import { queryContext } from "../src/retrieval.ts";

function link(store: ReturnType<typeof openStore>, from: string, to: string) {
  const entry = get(store, from)!;
  save(store, { ...entry, linked_memory_ids: [...(entry.linked_memory_ids ?? []), to] });
}

/**
 * Counts the rows the recursive CTE materialises for one expansion call.
 *
 * A wall-clock ceiling cannot do this reliably on shared CI hardware, so the
 * walk's work is measured instead of its duration: `expandAssociativeDetailed`
 * issues exactly one recursive-CTE query, and re-running only that CTE with a
 * `COUNT(*)` projection reports how many rows the recursion produced. Bounding
 * the recursive member keeps the count at `maxNodes`; an unbounded member
 * materialises the entire reachable frontier.
 */
function materialisedCteRows(db: NonNullable<Store["db"]>, sql: string, params: unknown[]): number {
  // "WITH RECURSIVE <name>(<cols>) AS (" — everything before the body is kept
  // verbatim so the counted query is the implementation's own CTE, never a copy.
  const cte = /^\s*WITH\s+RECURSIVE\s+([A-Za-z_][\w$]*)\s*\([^)]*\)\s*AS\s*\(/i.exec(sql);
  if (!cte) return Number.NaN;
  let depth = 0;
  let bodyEnd = -1;
  for (let i = cte.index + cte[0].length - 1; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")" && --depth === 0) {
      bodyEnd = i;
      break;
    }
  }
  if (bodyEnd < 0) return Number.NaN;
  const prefix = sql.slice(0, bodyEnd + 1);
  // Only the placeholders that live inside the CTE body are re-bound; the
  // outer projection's parameters (e.g. its own LIMIT) are not part of it.
  const placeholders = (prefix.match(/\?/g) ?? []).length;
  const counted = db
    .query<{ n: number }>(`${prefix} SELECT COUNT(*) AS n FROM ${cte[1]}`)
    .get(params.slice(0, placeholders));
  return counted?.n ?? Number.NaN;
}

/** Wraps a store so every recursive-CTE query it runs is also row-counted. */
function countingStore(store: Store): { store: Store; cteRows: number[] } {
  const cteRows: number[] = [];
  const db = store.db!;
  const instrumented: Store = {
    ...store,
    db: {
      ...db,
      query<T = unknown>(sql: string) {
        const statement = db.query<T>(sql);
        return {
          all(params?: unknown[] | Record<string, unknown>): T[] {
            if (/^\s*WITH\s+RECURSIVE/i.test(sql)) {
              cteRows.push(materialisedCteRows(db, sql, (params as unknown[]) ?? []));
            }
            return (statement.all as (p?: unknown) => T[])(params);
          },
          get(params?: unknown[] | Record<string, unknown>): T | null | undefined {
            return (statement.get as (p?: unknown) => T | null | undefined)(params);
          },
        };
      },
    },
  };
  return { store: instrumented, cteRows };
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

      const { store: counted, cteRows } = countingStore(store);
      const result = expandAssociativeDetailed(counted, [ids[0]], { maxDepth: 5, maxNodes: 100 });

      // The node cap is still honoured — the fix bounds work, not the answer.
      // This cap alone is not the regression guard: `maxNodes` trims the output
      // whether or not the recursion is bounded, so it passes either way.
      expect(result.nodes.length).toBeLessThanOrEqual(100);
      expect(result.nodes.length).toBeGreaterThan(0);

      // W26-5 regression guard, without a wall clock. With the inner LIMIT the
      // recursive member materialises `maxNodes` rows; remove that LIMIT and it
      // materialises the whole reachable frontier instead (4851 rows, ~115ms
      // vs 100 rows / ~6ms on this 1200-node graph, depth 5). Counting the rows
      // the CTE produced discriminates bounded from unbounded work
      // deterministically, whereas a millisecond ceiling flakes on loaded
      // shared runners — the old `elapsed < 50` assertion did exactly that.
      expect(cteRows).toHaveLength(1);
      expect(cteRows[0]).toBeLessThanOrEqual(100);
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });
});
