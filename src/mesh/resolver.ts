import fs from "node:fs";
import path from "node:path";
import type { Store } from "../store.ts";
import { openStore, list, propose } from "../store.ts";
import type { MemoryEntry, MemoryType } from "../types.ts";
import type { MeshTopology, MeshQueryResult, MeshNode } from "./types.ts";

function closeStoreSafe(store: Store): void {
  try {
    store.db?.close();
  } catch {}
}

export interface MeshQueryOptions {
  query?: string;
  targetProjects?: string[];
  types?: MemoryType[];
  limit?: number;
  minScore?: number;
  includeCurrent?: boolean;
  excludeArchived?: boolean;
}

/**
 * Compute fuzzy relevance score between a query and memory entry
 */
function scoreEntryRelevance(query: string, entry: MemoryEntry): number {
  if (!query) return 1.0;
  const qTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (qTerms.length === 0) return 1.0;

  const titleLower = entry.title.toLowerCase();
  const contentLower = entry.content.toLowerCase();
  const tagsLower = (entry.tags || []).map((t) => t.toLowerCase());

  let matches = 0;
  for (const term of qTerms) {
    if (titleLower.includes(term)) matches += 2.0;
    else if (contentLower.includes(term)) matches += 1.0;
    else if (tagsLower.some((t) => t.includes(term))) matches += 1.5;
  }

  const maxPossible = qTerms.length * 2.0;
  const baseScore = Math.min(1.0, matches / maxPossible);

  // Bonus for high utility / constraints
  let bonus = 0;
  if (entry.type === "constraint") bonus += 0.15;
  if (entry.type === "architecture") bonus += 0.1;
  if (entry.utility && entry.utility.retrieval_count > 0) bonus += 0.05;

  return Math.min(1.0, baseScore + bonus);
}

/**
 * Query memories across the multi-repo and monorepo mesh topology
 */
export function resolveMeshMemories(
  currentStore: Store,
  topology: MeshTopology,
  options: MeshQueryOptions = {}
): MeshQueryResult[] {
  const {
    query = "",
    targetProjects,
    types,
    limit = 20,
    minScore = 0.15,
    includeCurrent = true,
    excludeArchived = true,
  } = options;

  const results: MeshQueryResult[] = [];

  for (const node of topology.nodes) {
    // Check project filters
    if (targetProjects && targetProjects.length > 0) {
      const match = targetProjects.some(
        (tp) => tp.toLowerCase() === node.id.toLowerCase() || tp.toLowerCase() === node.name.toLowerCase()
      );
      if (!match) continue;
    }

    // Check current node option
    if (node.isCurrent && !includeCurrent) continue;

    // Check store existence
    if (!node.hasStore) continue;

    let storeToUse: Store;
    let needsClose = false;

    if (node.isCurrent) {
      storeToUse = currentStore;
    } else {
      try {
        storeToUse = openStore(node.memoryDir);
        needsClose = true;
      } catch {
        continue;
      }
    }

    try {
      const entries = list(storeToUse);
      for (const entry of entries) {
        if (excludeArchived && (entry.status === "archived" || entry.status === "superseded")) {
          continue;
        }
        if (types && types.length > 0 && (!entry.type || !types.includes(entry.type))) {
          continue;
        }

        const score = query ? scoreEntryRelevance(query, entry) : 1.0;
        if (score >= minScore) {
          results.push({
            memory: entry,
            sourceNode: {
              id: node.id,
              name: node.name,
              path: node.path,
            },
            score,
            originProject: node.name,
          });
        }
      }
    } finally {
      if (needsClose) {
        closeStoreSafe(storeToUse);
      }
    }
  }

  // Sort descending by score
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, limit);
}

/**
 * Propagate a constraint across all active stores in the mesh
 */
export function propagateConstraintToMesh(
  currentStore: Store,
  topology: MeshTopology,
  constraint: { title: string; content: string; tags?: string[] }
): { propagatedNodes: string[]; failedNodes: string[] } {
  const propagatedNodes: string[] = [];
  const failedNodes: string[] = [];

  const meshTag = "mesh-shared-constraint";
  const tags = Array.from(new Set([...(constraint.tags || []), meshTag]));

  for (const node of topology.nodes) {
    if (!node.hasStore) continue;

    let storeToUse: Store;
    let needsClose = false;

    if (node.isCurrent) {
      storeToUse = currentStore;
    } else {
      try {
        storeToUse = openStore(node.memoryDir);
        needsClose = true;
      } catch {
        failedNodes.push(node.name);
        continue;
      }
    }

    try {
      propose(storeToUse, {
        title: `[Mesh: ${topology.rootPath ? path.basename(topology.rootPath) : "Monorepo"}] ${constraint.title}`,
        content: constraint.content,
        project: topology.rootPath ? path.basename(topology.rootPath) : "monorepo",
        type: "constraint",
        confirmed: true,
        tags,
      });
      propagatedNodes.push(node.name);
    } catch {
      failedNodes.push(node.name);
    } finally {
      if (needsClose) {
        closeStoreSafe(storeToUse);
      }
    }
  }

  return { propagatedNodes, failedNodes };
}
