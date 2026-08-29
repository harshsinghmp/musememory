import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { list, type Store } from "../store.ts";
import type { MemoryEntry, MemoryType } from "../types.ts";

/** Lowercase alphanumeric-only tokens, split on non-alphanumeric. */
function tokenize(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

const SHARD_THRESHOLD = 10_000;
const SHARD_TIME_BUCKET = "monthly" as "daily" | "weekly" | "monthly";
const UPSERT_INTERVAL_MS = 60_000;
const MAX_RECURSION_DEPTH = 5;
const SEARCH_SCORE_THRESHOLD = 0.05;

export interface TreeNode {
  id: string;
  title: string;
  summary: string;
  content?: string;
  type: MemoryType;
  status: string;
  project: string;
  children: TreeNode[];
  memoryIds: string[];
  metadata: {
    createdAt: string;
    updatedAt: string;
    salience: number;
    verification: string;
    tags: string[];
  };
  partition?: {
    shardId: string;
    nodeCount: number;
    minScore: number;
    maxScore: number;
  };
}

export interface TreeShardStats {
  memoryCount: number;
  nodeCount: number;
  minScore: number;
  maxScore: number;
  builtAt: string;
}

export interface TreeShard {
  id: string;
  project: string;
  type: MemoryType;
  timeRange: { start: string; end: string };
  nodes: TreeNode[];
  stats: TreeShardStats;
}

export interface TreePartition {
  project: string;
  type: MemoryType;
  shards: TreeShard[];
  totalNodes: number;
  totalMemories: number;
  updatedAt: string;
}

export interface TreeIndex {
  version: number;
  partitions: Record<string, TreePartition>;
  totalNodes: number;
  totalMemories: number;
  builtAt: string;
}

export interface TreeIndexConfig {
  maxDepth: number;
  maxNodesPerQuery: number;
  clusteringThreshold: number;
  minClusterSize: number;
  shardThreshold: number;
  shardTimeBucket: "daily" | "weekly" | "monthly";
  enableLLMReasoning: boolean;
  summaryModel?: string;
  upsertIntervalMs: number;
}

export interface TreeSearchOptions {
  query: string;
  project?: string;
  type?: MemoryType;
  maxDepth?: number;
  maxNodes?: number;
  pageSize?: number;
  page?: number;
  disclosureDepth?: "L1" | "L2" | "L3";
  tokenBudget?: number;
}

export interface ScoredNode {
  node: TreeNode;
  score: number;
}

export interface TreeSearchResult {
  nodes: ScoredNode[];
  memories: MemoryEntry[];
  total: number;
  tokensUsed: number;
  partitionsSearched: number;
  shardsSearched: number;
}

const DEFAULT_CONFIG: TreeIndexConfig = {
  maxDepth: 5,
  maxNodesPerQuery: 100,
  clusteringThreshold: 0.5,
  minClusterSize: 3,
  shardThreshold: SHARD_THRESHOLD,
  shardTimeBucket: SHARD_TIME_BUCKET,
  enableLLMReasoning: false,
  upsertIntervalMs: UPSERT_INTERVAL_MS,
};

function indexDir(memoryDir: string): string {
  return join(memoryDir, "tree-index");
}

function partitionDir(idxDir: string, project: string, type: MemoryType): string {
  return join(idxDir, project, type);
}

function shardFilePath(pDir: string, shardId: string): string {
  return join(pDir, `${shardId}.json`);
}

function partitionIndexFilePath(pDir: string): string {
  return join(pDir, "index.json");
}

function globalIndexFilePath(idxDir: string): string {
  return join(idxDir, "index.json");
}

function nowIso(): string {
  return new Date().toISOString();
}

function formatTimeBucket(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function parseTimeBucket(bucket: string): { start: Date; end: Date } {
  const parts = bucket.split("-").map(Number);
  const year = parts[0] || 2026;
  const month = parts[1] || 1;
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59);
  return { start, end };
}

import {
  cosineSimilarity,
  tokenBag,
  mergeBag,
  dominantTopicTokens,
  entryTokens,
  clusterByTokenOverlap,
} from "../compounding/cluster.ts";

function makeShardId(project: string, type: MemoryType, date: Date): string {
  const bucket = formatTimeBucket(date);
  return `${project}_${type}_${bucket}`;
}

function buildLeafCluster(cluster: MemoryEntry[]): TreeNode {
  const topic = dominantTopicTokens(cluster.map((e) => e.title));
  const rootId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${topic.join("-") || "cluster"}`;

  return {
    id: rootId,
    title: topic.length > 0 ? topic.join(" ") : (cluster[0]?.type ?? "cluster"),
    summary: cluster.map((e) => e.content.replace(/\s+/g, " ").slice(0, 200)).join(" | "),
    type: cluster[0]?.type ?? "discovery",
    status: "confirmed",
    project: cluster[0]?.project ?? "default",
    children: [],
    memoryIds: cluster.map((e) => e.id),
    metadata: {
      createdAt: cluster[0]?.created_at ?? nowIso(),
      updatedAt: cluster[0]?.updated_at ?? nowIso(),
      salience: cluster.reduce((max, e) => Math.max(max, e.salience ?? 0), 0),
      verification: "user-confirmed",
      tags: [...new Set(cluster.flatMap((e) => e.tags ?? []))],
    },
    content: cluster.map((e) => e.content).join("\n---\n"),
  };
}

function buildClusterHierarchy(
  cluster: MemoryEntry[],
  config: TreeIndexConfig,
  depth = 0,
): TreeNode {
  if (depth >= MAX_RECURSION_DEPTH || cluster.length <= config.minClusterSize * 2) {
    return buildLeafCluster(cluster);
  }

  const topic = dominantTopicTokens(cluster.map((e) => e.title));
  const rootId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${topic.join("-") || "cluster"}`;

  const root: TreeNode = {
    id: rootId,
    title: topic.length > 0 ? topic.join(" ") : (cluster[0]?.type ?? "cluster"),
    summary: cluster.map((e) => e.content.replace(/\s+/g, " ").slice(0, 200)).join(" | "),
    type: cluster[0]?.type ?? "discovery",
    status: "confirmed",
    project: cluster[0]?.project ?? "default",
    children: [],
    memoryIds: [],
    metadata: {
      createdAt: cluster[0]?.created_at ?? nowIso(),
      updatedAt: cluster[0]?.updated_at ?? nowIso(),
      salience: cluster.reduce((max, e) => Math.max(max, e.salience ?? 0), 0),
      verification: "user-confirmed",
      tags: [...new Set(cluster.flatMap((e) => e.tags ?? []))],
    },
  };

  const subClusters = clusterByTokenOverlap(cluster, entryTokens, config.clusteringThreshold);
  const validSubClusters = subClusters.filter(
    (sc) => sc.length < cluster.length && sc.length >= config.minClusterSize,
  );

  if (validSubClusters.length === 0) {
    return buildLeafCluster(cluster);
  }

  for (const subCluster of validSubClusters) {
    root.children.push(buildClusterHierarchy(subCluster, config, depth + 1));
  }

  const remaining = subClusters
    .filter((sc) => sc.length < config.minClusterSize)
    .flatMap((sc) => sc.map((e) => e.id));
  root.memoryIds.push(...remaining);

  root.content = root.children.map((c) => c.summary).join("\n---\n");
  return root;
}

function countNodes(node: TreeNode): number {
  return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);
}

function collectMemoryIds(node: TreeNode): string[] {
  const ids = [...node.memoryIds];
  for (const c of node.children) {
    ids.push(...collectMemoryIds(c));
  }
  return ids;
}

function splitShard(shard: TreeShard, threshold: number): TreeShard[] {
  if (shard.nodes.length <= threshold) return [shard];

  // Try splitting by time buckets first
  const byBucket = new Map<string, TreeNode[]>();
  for (const node of shard.nodes) {
    const time = node.metadata?.createdAt ? new Date(node.metadata.createdAt) : new Date();
    const bucket = formatTimeBucket(time);
    const arr = byBucket.get(bucket);
    if (arr) arr.push(node);
    else byBucket.set(bucket, [node]);
  }

  const result: TreeShard[] = [];
  if (byBucket.size > 1) {
    for (const [bucket, nodes] of byBucket) {
      if (nodes.length === 0) continue;
      const { start, end } = parseTimeBucket(bucket);
      const subShards = splitNodesIntoChunks(shard.project, shard.type, bucket, start, end, nodes, threshold);
      result.push(...subShards);
    }
  } else {
    // If all nodes have same timestamp bucket, split into chunk shards
    const bucket = formatTimeBucket(new Date());
    const { start, end } = parseTimeBucket(bucket);
    const subShards = splitNodesIntoChunks(shard.project, shard.type, bucket, start, end, shard.nodes, threshold);
    result.push(...subShards);
  }

  return result;
}

function splitNodesIntoChunks(
  project: string,
  type: MemoryType,
  bucket: string,
  start: Date,
  end: Date,
  nodes: TreeNode[],
  threshold: number,
): TreeShard[] {
  const shards: TreeShard[] = [];
  const chunkSize = Math.max(1, threshold);
  for (let i = 0; i < nodes.length; i += chunkSize) {
    const chunkNodes = nodes.slice(i, i + chunkSize);
    const shardIndex = Math.floor(i / chunkSize);
    const shardId = shardIndex === 0 && nodes.length <= threshold
      ? `${project}_${type}_${bucket}`
      : `${project}_${type}_${bucket}_p${shardIndex + 1}`;

    const newShard: TreeShard = {
      id: shardId,
      project,
      type,
      timeRange: { start: start.toISOString(), end: end.toISOString() },
      nodes: chunkNodes,
      stats: {
        memoryCount: chunkNodes.reduce((sum, n) => sum + collectMemoryIds(n).length, 0),
        nodeCount: chunkNodes.reduce((sum, n) => sum + countNodes(n), 0),
        minScore: 1,
        maxScore: 0,
        builtAt: nowIso(),
      },
    };

    for (const node of chunkNodes) {
      const score = node.metadata?.salience ?? 0;
      newShard.stats.minScore = Math.min(newShard.stats.minScore, score);
      newShard.stats.maxScore = Math.max(newShard.stats.maxScore, score);
    }
    shards.push(newShard);
  }
  return shards;
}

export function buildTreeIndex(
  store: Store,
  memoryDir: string,
  config: Partial<TreeIndexConfig> = {},
): TreeIndex {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const allMemories = list(store).filter((e) => e.status === "confirmed");

  mkdirSync(indexDir(memoryDir), { recursive: true });

  if (allMemories.length === 0) {
    const emptyIndex: TreeIndex = {
      version: 1,
      partitions: {},
      totalNodes: 0,
      totalMemories: 0,
      builtAt: nowIso(),
    };
    writeFileSync(globalIndexFilePath(indexDir(memoryDir)), JSON.stringify(emptyIndex, null, 2), "utf8");
    return emptyIndex;
  }

  const groups = new Map<string, MemoryEntry[]>();
  for (const e of allMemories) {
    const key = `${e.project}|${e.type ?? "unknown"}`;
    const group = groups.get(key);
    if (group) group.push(e);
    else groups.set(key, [e]);
  }

  const partitions: Record<string, TreePartition> = {};
  let totalIndexNodes = 0;
  let totalIndexMemories = 0;

  for (const [key, memories] of groups) {
    const [project, type] = key.split("|") as [string, MemoryType];
    const pDir = partitionDir(indexDir(memoryDir), project, type);
    mkdirSync(pDir, { recursive: true });

    const maxShardSize = cfg.shardThreshold || 10000;
    const finalShards: TreeShard[] = [];

    // Group memories into chunks if exceeding shard threshold
    const memoryChunks: MemoryEntry[][] = [];
    if (memories.length > maxShardSize) {
      for (let i = 0; i < memories.length; i += maxShardSize) {
        memoryChunks.push(memories.slice(i, i + maxShardSize));
      }
    } else {
      memoryChunks.push(memories);
    }

    for (let chunkIdx = 0; chunkIdx < memoryChunks.length; chunkIdx++) {
      const chunk = memoryChunks[chunkIdx];
      const clusters = clusterByTokenOverlap(chunk, entryTokens, cfg.clusteringThreshold);

      const medianTime = chunk
        .map((e) => (e.created_at ? Date.parse(e.created_at) : Date.now()))
        .sort((a, b) => a - b)[Math.floor(chunk.length / 2)] || Date.now();
      const baseShardId = makeShardId(project, type, new Date(medianTime));
      const shardId = memoryChunks.length > 1 ? `${baseShardId}_p${chunkIdx + 1}` : baseShardId;
      const bucket = formatTimeBucket(new Date(medianTime));
      const { start, end } = parseTimeBucket(bucket);

      const shardNodes: TreeNode[] = [];
      for (const cluster of clusters) {
        if (cluster.length === 0) continue;
        const node = cluster.length >= cfg.minClusterSize
          ? buildClusterHierarchy(cluster, cfg)
          : buildLeafCluster(cluster);
        node.partition = { shardId, nodeCount: countNodes(node), minScore: 0, maxScore: 0 };
        shardNodes.push(node);
      }

      const shard: TreeShard = {
        id: shardId,
        project,
        type,
        timeRange: { start: start.toISOString(), end: end.toISOString() },
        nodes: shardNodes,
        stats: {
          memoryCount: chunk.length,
          nodeCount: shardNodes.reduce((sum, n) => sum + countNodes(n), 0),
          minScore: 1,
          maxScore: 0,
          builtAt: nowIso(),
        },
      };

      for (const node of shardNodes) {
        const score = node.metadata?.salience ?? 0;
        shard.stats.minScore = Math.min(shard.stats.minScore, score);
        shard.stats.maxScore = Math.max(shard.stats.maxScore, score);
      }

      finalShards.push(shard);
    }

    const partitionMemories = memories.length;
    const partitionNodes = finalShards.reduce((sum, s) => sum + s.nodes.length, 0);

    const partition: TreePartition = {
      project,
      type,
      shards: finalShards,
      totalNodes: partitionNodes,
      totalMemories: partitionMemories,
      updatedAt: nowIso(),
    };

    partitions[`${project}|${type}`] = partition;
    totalIndexNodes += partitionNodes;
    totalIndexMemories += partitionMemories;

    writeFileSync(partitionIndexFilePath(pDir), JSON.stringify(partition, null, 2), "utf8");
    for (const shard of finalShards) {
      writeFileSync(shardFilePath(pDir, shard.id), JSON.stringify(shard, null, 2), "utf8");
    }
  }

  const index: TreeIndex = {
    version: 1,
    partitions,
    totalNodes: totalIndexNodes,
    totalMemories: totalIndexMemories,
    builtAt: nowIso(),
  };

  writeFileSync(globalIndexFilePath(indexDir(memoryDir)), JSON.stringify(index, null, 2), "utf8");
  return index;
}

/**
 * Asynchronous, non-blocking tree index builder.
 * Yields execution to the event loop between partition batches to prevent event loop starvation on large stores.
 */
export async function buildTreeIndexAsync(
  store: Store,
  memoryDir: string,
  config: Partial<TreeIndexConfig> = {},
): Promise<TreeIndex> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  return buildTreeIndex(store, memoryDir, config);
}

export function loadTreeIndex(memoryDir: string): TreeIndex | null {
  const path = globalIndexFilePath(indexDir(memoryDir));
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as TreeIndex;
    return data.version === 1 ? data : null;
  } catch {
    return null;
  }
}

export function loadPartition(memoryDir: string, project: string, type: MemoryType): TreePartition | null {
  const path = partitionIndexFilePath(partitionDir(indexDir(memoryDir), project, type));
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as TreePartition;
  } catch {
    return null;
  }
}

export function loadShard(memoryDir: string, project: string, type: MemoryType, shardId: string): TreeShard | null {
  const path = shardFilePath(partitionDir(indexDir(memoryDir), project, type), shardId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as TreeShard;
  } catch {
    return null;
  }
}

function selectPartitions(index: TreeIndex, options: TreeSearchOptions): TreePartition[] {
  const result: TreePartition[] = [];
  for (const partition of Object.values(index.partitions)) {
    if (options.project && partition.project !== options.project) continue;
    if (options.type && partition.type !== options.type) continue;
    result.push(partition);
  }
  return result;
}

function scoreNode(node: TreeNode, query: string): number {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return 0;

  const haystack = tokenize(`${node.title} ${node.summary} ${(node.metadata?.tags ?? []).join(" ")}`);
  const hay = new Set(haystack);
  let overlap = 0;
  for (const t of queryTokens) if (hay.has(t)) overlap++;

  const baseScore = overlap / Math.max(1, queryTokens.size);
  const salienceBonus = (node.metadata?.salience ?? 0) * 0.1;
  return baseScore + salienceBonus;
}

function estimateNodeTokens(node: TreeNode, depth: "L1" | "L2" | "L3"): number {
  const base = (node.title?.length ?? 0) + (node.summary?.length ?? 0);
  const contentLen = node.content?.length ?? 0;
  const metaLen = JSON.stringify(node.metadata ?? {}).length;

  switch (depth) {
    case "L1":
      return Math.max(1, Math.ceil(base / 4));
    case "L2":
      return Math.max(1, Math.ceil((base + contentLen) / 4));
    case "L3":
      return Math.max(1, Math.ceil((base + contentLen + metaLen) / 4));
  }
}

function traverseShardBestFirst(
  shard: TreeShard,
  query: string,
  maxDepth: number,
  remainingBudget: number,
  disclosureDepth: "L1" | "L2" | "L3",
): { nodes: ScoredNode[]; tokensUsed: number } {
  if (remainingBudget <= 0) return { nodes: [], tokensUsed: 0 };

  const results: ScoredNode[] = [];
  let tokensUsed = 0;

  const queue: { node: TreeNode; depth: number; score: number }[] = [];
  for (const node of shard.nodes) {
    const score = scoreNode(node, query);
    if (score >= SEARCH_SCORE_THRESHOLD) {
      queue.push({ node, depth: 0, score });
    }
  }
  queue.sort((a, b) => b.score - a.score);

  while (queue.length > 0 && tokensUsed < remainingBudget) {
    const { node, depth, score } = queue.shift()!;
    if (depth > maxDepth) continue;

    const nodeTokens = estimateNodeTokens(node, disclosureDepth);
    if (tokensUsed + nodeTokens > remainingBudget && results.length > 0) break;

    results.push({ node, score });
    tokensUsed += nodeTokens;

    for (const child of node.children) {
      const childScore = scoreNode(child, query);
      if (childScore >= SEARCH_SCORE_THRESHOLD) {
        queue.push({ node: child, depth: depth + 1, score: childScore });
      }
    }
    queue.sort((a, b) => b.score - a.score);
  }

  return { nodes: results, tokensUsed };
}

function paginateResults(results: ScoredNode[], page: number, pageSize: number): ScoredNode[] {
  const start = Math.max(0, (page - 1) * pageSize);
  return results.slice(start, start + pageSize);
}

export function searchTree(
  index: TreeIndex,
  options: TreeSearchOptions,
): TreeSearchResult {
  const tokenBudget = options.tokenBudget ?? 2000;
  const maxDepth = options.maxDepth ?? 5;
  const maxNodes = options.maxNodes ?? 100;
  const disclosureDepth = options.disclosureDepth ?? "L1";
  let tokensUsed = 0;

  const partitions = selectPartitions(index, options);
  const results: ScoredNode[] = [];
  let partitionsSearched = 0;
  let shardsSearched = 0;

  for (const partition of partitions) {
    if (tokensUsed >= tokenBudget || results.length >= maxNodes) break;
    partitionsSearched++;

    for (const shard of partition.shards) {
      if (tokensUsed >= tokenBudget || results.length >= maxNodes) break;
      shardsSearched++;

      const shardResults = traverseShardBestFirst(
        shard,
        options.query,
        maxDepth,
        tokenBudget - tokensUsed,
        disclosureDepth,
      );
      tokensUsed += shardResults.tokensUsed;
      results.push(...shardResults.nodes);

      if (results.length >= maxNodes) break;
    }
  }

  results.sort((a, b) => b.score - a.score);
  const paginated = paginateResults(results, options.page ?? 1, options.pageSize ?? options.maxNodes ?? 10);

  return {
    nodes: paginated,
    memories: [],
    total: results.length,
    tokensUsed,
    partitionsSearched,
    shardsSearched,
  };
}

function buildLeafNode(memory: MemoryEntry): TreeNode {
  return {
    id: `node_${memory.id}`,
    title: memory.title,
    summary: memory.content.replace(/\s+/g, " ").slice(0, 200),
    content: memory.content,
    type: memory.type ?? "discovery",
    status: memory.status,
    project: memory.project,
    children: [],
    memoryIds: [memory.id],
    metadata: {
      createdAt: memory.created_at,
      updatedAt: memory.updated_at,
      salience: memory.salience ?? 0,
      verification: memory.verification?.level ?? "unverified",
      tags: memory.tags ?? [],
    },
  };
}

function findOrCreateClusterInShard(
  shard: TreeShard,
  memory: MemoryEntry,
  config: TreeIndexConfig,
): TreeNode | null {
  const memoryTokens = entryTokens(memory);

  for (const node of shard.nodes) {
    const nodeTokens = tokenBag(`${node.title} ${node.summary} ${(node.metadata?.tags ?? []).join(" ")}`, 1);
    const similarity = cosineSimilarity(memoryTokens, nodeTokens);
    if (similarity >= config.clusteringThreshold) {
      return node;
    }
    for (const child of node.children) {
      const childTokens = tokenBag(`${child.title} ${child.summary} ${(child.metadata?.tags ?? []).join(" ")}`, 1);
      if (cosineSimilarity(memoryTokens, childTokens) >= config.clusteringThreshold) {
        return child;
      }
    }
  }
  return null;
}

function updateClusterHierarchy(cluster: TreeNode, memory: MemoryEntry): void {
  if (!cluster.memoryIds.includes(memory.id)) {
    cluster.memoryIds.push(memory.id);
  }
  if (cluster.content) {
    cluster.content += `\n---\n${memory.content}`;
  } else {
    cluster.content = memory.content;
  }
  cluster.metadata.updatedAt = memory.updated_at;
  if ((memory.salience ?? 0) > (cluster.metadata.salience ?? 0)) {
    cluster.metadata.salience = memory.salience ?? 0;
  }
  for (const tag of memory.tags ?? []) {
    if (!cluster.metadata.tags.includes(tag)) cluster.metadata.tags.push(tag);
  }
}

export async function upsertMemory(
  memory: MemoryEntry,
  memoryDir: string,
  config: Partial<TreeIndexConfig> = {},
): Promise<void> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let index = loadTreeIndex(memoryDir);
  if (!index) {
    index = {
      version: 1,
      partitions: {},
      totalNodes: 0,
      totalMemories: 0,
      builtAt: nowIso(),
    };
  }

  const project = memory.project || "default";
  const type = memory.type ?? "discovery";
  const partitionKey = `${project}|${type}`;
  let partition = index.partitions[partitionKey];

  if (!partition) {
    partition = {
      project,
      type,
      shards: [],
      totalNodes: 0,
      totalMemories: 0,
      updatedAt: nowIso(),
    };
    index.partitions[partitionKey] = partition;
  }

  const medianTime = memory.created_at ? Date.parse(memory.created_at) : Date.now();
  const shardId = makeShardId(project, type, new Date(medianTime));
  let shard = partition.shards.find((s) => s.id === shardId);

  if (!shard) {
    const bucket = formatTimeBucket(new Date(medianTime));
    const { start, end } = parseTimeBucket(bucket);
    shard = {
      id: shardId,
      project,
      type,
      timeRange: { start: start.toISOString(), end: end.toISOString() },
      nodes: [],
      stats: {
        memoryCount: 0,
        nodeCount: 0,
        minScore: 1,
        maxScore: 0,
        builtAt: nowIso(),
      },
    };
    partition.shards.push(shard);
  }

  const cluster = findOrCreateClusterInShard(shard, memory, cfg);
  if (!cluster) {
    const node = buildLeafNode(memory);
    shard.nodes.push(node);
  } else {
    updateClusterHierarchy(cluster, memory);
  }

  shard.stats.nodeCount = shard.nodes.reduce((sum, n) => sum + countNodes(n), 0);
  shard.stats.memoryCount = shard.nodes.reduce((sum, n) => sum + collectMemoryIds(n).length, 0);
  const score = memory.salience ?? 0;
  shard.stats.minScore = Math.min(shard.stats.minScore, score);
  shard.stats.maxScore = Math.max(shard.stats.maxScore, score);
  shard.stats.builtAt = nowIso();

  if (shard.nodes.length > cfg.shardThreshold) {
    const split = splitShard(shard, cfg.shardThreshold);
    const idx = partition.shards.indexOf(shard);
    partition.shards.splice(idx, 1, ...split);
  }

  partition.totalNodes = partition.shards.reduce((sum, s) => sum + s.nodes.length, 0);
  partition.totalMemories = partition.shards.reduce((sum, s) => sum + s.stats.memoryCount, 0);
  partition.updatedAt = nowIso();

  const pDir = partitionDir(indexDir(memoryDir), partition.project, partition.type);
  mkdirSync(pDir, { recursive: true });
  writeFileSync(partitionIndexFilePath(pDir), JSON.stringify(partition, null, 2), "utf8");
  for (const s of partition.shards) {
    writeFileSync(shardFilePath(pDir, s.id), JSON.stringify(s, null, 2), "utf8");
  }

  index.partitions[partitionKey] = partition;
  index.totalNodes = Object.values(index.partitions).reduce((sum, p) => sum + p.totalNodes, 0);
  index.totalMemories = Object.values(index.partitions).reduce((sum, p) => sum + p.totalMemories, 0);
  index.builtAt = nowIso();
  writeFileSync(globalIndexFilePath(indexDir(memoryDir)), JSON.stringify(index, null, 2), "utf8");
}

export function rebuildTreeIndex(
  store: Store,
  memoryDir: string,
  config: Partial<TreeIndexConfig> = {},
): TreeIndex {
  return buildTreeIndex(store, memoryDir, config);
}

export function deleteTreeIndex(memoryDir: string): void {
  const dir = indexDir(memoryDir);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export { DEFAULT_CONFIG, indexDir, partitionDir, shardFilePath };
