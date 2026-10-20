import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

export interface HebbianEdge {
  weight: number;
  count: number;
  lastActivated: string;
}

export type HebbianGraph = Record<string, Record<string, HebbianEdge>>;

/** Maximum number of co-retrieved entries to associate in a single turn to avoid O(N²) explosion */
export const MAX_COACTIVE_SEEDS = 8;
/** Maximum outgoing associative edges kept per memory node */
export const MAX_EDGES_PER_NODE = 30;
/** Maximum total nodes retained in the plasticity graph */
export const MAX_GRAPH_NODES = 500;

function getPlasticityPath(memoryDir: string): string {
  return join(memoryDir, "hebbian-plasticity.json");
}

export function loadHebbianGraph(memoryDir: string): HebbianGraph {
  const p = getPlasticityPath(memoryDir);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

export function saveHebbianGraph(memoryDir: string, graph: HebbianGraph): void {
  const p = getPlasticityPath(memoryDir);
  const tmp = `${p}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(graph, null, 2), "utf8");
    renameSync(tmp, p);
  } catch {}
}

/**
 * Records a co-activation event among a set of memories (e.g. co-retrieved or confirmed together).
 * Increments associative edge weights by +0.05 (capped at 1.0) following Hebbian synaptic rules.
 * T-307: Bounded to MAX_COACTIVE_SEEDS (8) and MAX_EDGES_PER_NODE (30) to eliminate O(N²) explosion.
 */
export function recordCoActivation(memoryIds: string[], memoryDir: string): void {
  const ids = Array.from(new Set(memoryIds.filter(Boolean))).slice(0, MAX_COACTIVE_SEEDS);
  if (ids.length < 2) return;

  const graph = loadHebbianGraph(memoryDir);
  const now = new Date().toISOString();
  let changed = false;

  for (let i = 0; i < ids.length; i++) {
    const src = ids[i];
    if (!graph[src]) graph[src] = {};

    for (let j = 0; j < ids.length; j++) {
      if (i === j) continue;
      const tgt = ids[j];
      const existing = graph[src][tgt];
      const prevWeight = existing ? existing.weight : 0;
      const prevCount = existing ? existing.count : 0;

      const newWeight = Math.min(1.0, Math.round((prevWeight + 0.05) * 1000) / 1000);
      graph[src][tgt] = {
        weight: newWeight,
        count: prevCount + 1,
        lastActivated: now,
      };
      changed = true;
    }

    // Prune edges if node exceeds MAX_EDGES_PER_NODE
    const edgeEntries = Object.entries(graph[src]);
    if (edgeEntries.length > MAX_EDGES_PER_NODE) {
      edgeEntries.sort((a, b) => b[1].weight - a[1].weight || b[1].count - a[1].count);
      graph[src] = Object.fromEntries(edgeEntries.slice(0, MAX_EDGES_PER_NODE));
      changed = true;
    }
  }

  // Prune total nodes if graph exceeds MAX_GRAPH_NODES
  const nodeEntries = Object.entries(graph);
  if (nodeEntries.length > MAX_GRAPH_NODES) {
    nodeEntries.sort((a, b) => Object.keys(b[1]).length - Object.keys(a[1]).length);
    const prunedGraph: HebbianGraph = Object.fromEntries(nodeEntries.slice(0, MAX_GRAPH_NODES));
    saveHebbianGraph(memoryDir, prunedGraph);
    return;
  }

  if (changed) {
    saveHebbianGraph(memoryDir, graph);
  }
}

/**
 * Gets associative synaptic edge weight between two memories.
 */
export function getHebbianAssociationWeight(
  sourceId: string,
  targetId: string,
  memoryDir: string,
): number {
  const graph = loadHebbianGraph(memoryDir);
  return graph[sourceId]?.[targetId]?.weight ?? 0;
}

/**
 * Returns all associated memories for a given memory ID sorted by weight descending.
 */
export function getAssociatedMemories(
  sourceId: string,
  memoryDir: string,
): { targetId: string; weight: number; count: number }[] {
  const graph = loadHebbianGraph(memoryDir);
  const targets = graph[sourceId];
  if (!targets) return [];

  return Object.entries(targets)
    .map(([targetId, edge]) => ({
      targetId,
      weight: edge.weight,
      count: edge.count,
    }))
    .sort((a, b) => b.weight - a.weight);
}
