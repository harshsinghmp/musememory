import type { Store } from "./store.ts";
import { list } from "./store.ts";

export interface AssociativeOptions {
  maxDepth?: number;
  maxNodes?: number;
  project?: string;
  includeSuperseded?: boolean;
}

export interface AssociativeNode {
  id: string;
  depth: number;
}

export interface AssociativeExpansion {
  nodes: AssociativeNode[];
  degraded: boolean;
  error?: string;
}

const HIDDEN_STATUSES = new Set(["superseded", "rejected", "conflicted"]);

/**
 * T-432: cycle-safe transitive closure over `linked_memory_ids` using a
 * recursive SQLite CTE. Seeds are excluded; tombstones are never traversed
 * or returned.
 */
export function expandAssociative(
  store: Store,
  seedIds: string[],
  options: AssociativeOptions = {},
): AssociativeNode[] {
  return expandAssociativeDetailed(store, seedIds, options).nodes;
}

export function expandAssociativeDetailed(
  store: Store,
  seedIds: string[],
  options: AssociativeOptions = {},
): AssociativeExpansion {
  if (!store.db || seedIds.length === 0) return { nodes: [], degraded: false };
  const maxDepth = Math.min(Math.max(options.maxDepth ?? 2, 1), 5);
  const maxNodes = Math.min(Math.max(options.maxNodes ?? 100, 1), 1000);
  const seeds = JSON.stringify([...new Set(seedIds.filter(Boolean))]);

  try {
    const seedSet = new Set(seedIds);
    const rows = store.db
      .query<AssociativeNode>(
        `WITH RECURSIVE assoc(id, depth) AS (
           SELECT value, 0 FROM json_each(?)
           UNION
           SELECT link.value, assoc.depth + 1
           FROM assoc
           JOIN memories m ON m.id = assoc.id
           JOIN json_each(CASE WHEN json_valid(m.linked_memory_ids) THEN m.linked_memory_ids ELSE '[]' END) link
           WHERE assoc.depth < ? AND m.deleted_at IS NULL
         )
         SELECT a.id AS id, MIN(a.depth) AS depth
         FROM assoc a
         JOIN memories m2 ON m2.id = a.id
         WHERE a.depth > 0 AND m2.deleted_at IS NULL
         GROUP BY a.id
         ORDER BY depth ASC, a.id ASC
         LIMIT ?`,
      )
      .all([seeds, maxDepth, maxNodes]);

    // Gate the output through the same lifecycle/scope view as normal reads.
    const visible = new Map(list(store).map((entry) => [entry.id, entry]));
    const nodes = rows.filter((node) => {
      if (seedSet.has(node.id)) return false;
      const entry = visible.get(node.id);
      if (!entry) return false;
      if (options.project && entry.project !== options.project) return false;
      if (!options.includeSuperseded && HIDDEN_STATUSES.has(entry.status)) return false;
      if (entry.trust === "untrusted") return false;
      return true;
    });
    return { nodes, degraded: false };
  } catch (err) {
    return { nodes: [], degraded: true, error: err instanceof Error ? err.message : String(err) };
  }
}
