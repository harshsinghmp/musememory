import type { Store } from "./store.ts";
import { get } from "./store.ts";
import { daysSince } from "./retrieval.ts";
import type { MemoryEntry } from "./types.ts";

export interface TraceNode {
  id: string;
  title: string;
  status: string;
  type?: string;
  ageDays: number;
  /** Edge relation used to reach this node: root | supersedes | superseded_by | related */
  relation: string;
  children: TraceNode[];
}

function normalizeIdArray(val: string | string[] | null | undefined): string[] {
  if (!val) return [];
  if (typeof val === "string") return [val];
  return val;
}

/**
 * Multi-hop causality trace: recursively walk supersedes/superseded_by and
 * related-memory edges from a root entry. Cycle-safe (each id visited once)
 * and depth-bounded. Pure read path — no store mutations.
 */
export function traceGraph(store: Store, rootId: string, maxDepth = 5): TraceNode | null {
  const rootEntry = get(store, rootId);
  if (!rootEntry) return null;

  const visited = new Set<string>();

  const walk = (entry: MemoryEntry, depth: number, relation: string): TraceNode => {
    visited.add(entry.id);
    const ageMs = daysSince(entry.updated_at, Date.now());
    const node: TraceNode = {
      id: entry.id,
      title: entry.title,
      status: entry.status,
      type: entry.type,
      ageDays: Math.floor(ageMs),
      relation,
      children: [],
    };
    if (depth >= maxDepth) return node;

    const edges: { id: string; rel: string }[] = [
      ...normalizeIdArray(entry.supersedes).map((id) => ({ id, rel: "supersedes" })),
      ...normalizeIdArray(entry.superseded_by).map((id) => ({ id, rel: "superseded_by" })),
      ...(entry.related_memory_ids ?? []).map((id) => ({ id, rel: "related" })),
    ];
    for (const { id: targetId, rel } of edges) {
      if (visited.has(targetId)) continue;
      const target = get(store, targetId);
      if (!target) continue;
      node.children.push(walk(target, depth + 1, rel));
    }
    return node;
  };

  return walk(rootEntry, 0, "root");
}

/** Render the trace as an indented tree with status/type/age per hop. */
export function renderTrace(node: TraceNode, indent = ""): string[] {
  const marker = node.relation === "root" ? "*" : `<-${node.relation}-`;
  const typePart = node.type ? `/${node.type}` : "";
  const lines = [`${indent}${marker} ${node.id} [${node.status}${typePart}] (${node.ageDays}d) ${node.title}`];
  for (const child of node.children) {
    lines.push(...renderTrace(child, `${indent}  `));
  }
  return lines;
}
