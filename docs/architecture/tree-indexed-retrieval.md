# Tree-Indexed Retrieval Architecture Design

## Overview
Replace/augment `vector.ts` hashed trigram + BM25 with PageIndex-style tree-indexed reasoning retrieval. Native TypeScript implementation, no external dependencies.

## Goals
- Semantic reasoning over hierarchical structure (not just lexical overlap)
- Explainable/citable results (traceable to tree nodes)
- Scale to millions of memories (O(log n) traversal vs O(n) scan)
- `vector.ts` remains as fallback

## Tree Index Structure

```typescript
interface TreeNode {
  id: string;
  title: string;
  summary: string;           // L1 disclosure: title + summary only
  content?: string;          // L2/L3 disclosure: full content
  type: MemoryType;
  status: MemoryStatus;
  project: string;
  children: TreeNode[];
  memoryIds: string[];       // Leaf nodes point to actual memory entries
  metadata: {
    createdAt: string;
    updatedAt: string;
    salience: number;
    verification: VerificationLevel;
    tags: string[];
  };
  // Scaling: partition metadata
  partition?: {
    shardId: string;         // e.g., "2026-08" for monthly shards
    nodeCount: number;
    minScore: number;
    maxScore: number;
  };
}

interface TreeShard {
  id: string;                // e.g., "musememory_fix_2026-08"
  project: string;
  type: MemoryType;
  timeRange: { start: string; end: string };
  nodes: TreeNode[];
  stats: {
    nodeCount: number;
    minScore: number;
    maxScore: number;
    builtAt: string;
  };
}

interface TreeIndex {
  version: number;
  shards: TreeShard[];       // Partitioned by project/type/time
  totalNodes: number;
  totalMemories: number;
  builtAt: string;
}
```

## Partitioning Strategy (Million-Scale)

### Two-Level Partitioning
1. **Primary**: By project + type (e.g., `musememory/fix/`, `musememory/architecture/`)
2. **Secondary (sharding)**: By time buckets when partition exceeds threshold
   - Threshold: 10,000 nodes per shard
   - Bucket: Monthly (configurable: daily/weekly/monthly)
   - Shard ID format: `{project}_{type}_{YYYY-MM}`

### File Layout
```
.memory/
  tree-index/
    musememory/
      fix/
        2026-06.json      # Shard for June 2026
        2026-07.json
        2026-08.json
        index.json        # Partition metadata + stats
      architecture/
        2026-08.json
        index.json
      index.json          # Project metadata
    index.json            # Global index metadata
```

### Partition Metadata (`index.json` per partition)
```json
{
  "project": "musememory",
  "type": "fix",
  "shards": [
    { "id": "musememory_fix_2026-06", "nodeCount": 8432, "minScore": 0.12, "maxScore": 0.98, "timeRange": { "start": "2026-06-01", "end": "2026-06-30" } },
    { "id": "musememory_fix_2026-07", "nodeCount": 9156, "minScore": 0.15, "maxScore": 0.97, "timeRange": { "start": "2026-07-01", "end": "2026-07-31" } }
  ],
  "totalNodes": 17588,
  "updatedAt": "2026-08-28T10:30:00Z"
}
```

## Building the Tree Index

### Step 1: Cluster Memories (reuse `consolidate.ts` logic)
- Input: All confirmed memories from store
- Group by project + type
- Cluster by token overlap (cosine similarity on token bags)
- Threshold: 0.5 (configurable)

### Step 2: Build Hierarchy per Cluster
- For each cluster, create tree structure:
  - Root: Topic summary (from dominant tokens)
  - Intermediate: Sub-topics (recursive clustering if cluster > 50)
  - Leaves: Individual memory entries
- Use LLM only for summary generation (optional, async)
- Deterministic structure from token analysis (PageIndex Flash style)

### Step 3: Shard by Time
- Assign each cluster to shard based on `created_at` (median of cluster)
- If shard exceeds 10k nodes, split into monthly buckets
- Build shard files with stats

### Step 4: Persist
- Write shard files
- Write partition `index.json` with stats
- Write project `index.json`
- Write global `index.json`

## Incremental Index Updates (Upsert)

### Trigger
- On memory `confirm` / `supersede` / `markStale` / `delete`
- Batch updates every 60 seconds (configurable)
- Background worker, non-blocking

### Algorithm
```typescript
async function upsertMemory(memory: MemoryEntry, index: TreeIndex): Promise<TreeIndex> {
  // 1. Determine target partition + shard
  const partition = index.getPartition(memory.project, memory.type);
  const shard = partition.getShardForTime(memory.created_at);
  
  // 2. Find or create cluster in shard
  const cluster = findOrCreateCluster(shard, memory);
  
  // 3. Update cluster hierarchy
  updateClusterHierarchy(cluster, memory);
  
  // 4. Update shard stats
  shard.stats.nodeCount++;
  shard.stats.minScore = Math.min(shard.stats.minScore, memory.salience ?? 0);
  shard.stats.maxScore = Math.max(shard.stats.maxScore, memory.salience ?? 0);
  shard.stats.builtAt = nowIso();
  
  // 5. Check shard size threshold
  if (shard.nodes.length > SHARD_THRESHOLD) {
    await splitShard(shard);
  }
  
  // 6. Persist only affected shard + partition metadata
  await persistShard(shard);
  await persistPartitionMetadata(partition);
  
  return index;
}
```

### Shard Splitting
- When shard > 10k nodes, split by time (monthly buckets)
- Redistribute nodes to new shards
- Update partition `index.json`

## Retrieval Algorithm with Token Budget Pruning

```typescript
interface TreeSearchOptions {
  query: string;
  project?: string;
  type?: MemoryType;
  maxDepth?: number;         // Default: 5
  maxNodes?: number;         // Default: 100
  pageSize?: number;         // Default: 10
  page?: number;             // Default: 1
  disclosureDepth?: 'L1' | 'L2' | 'L3';
  tokenBudget?: number;      // Hard cap on tokens returned
}

function searchTree(index: TreeIndex, options: TreeSearchOptions): TreeSearchResult {
  const tokenBudget = options.tokenBudget ?? 2000;
  let tokensUsed = 0;
  
  // 1. Select relevant partitions (by project/type filter)
  const partitions = selectPartitions(index, options);
  
  // 2. For each partition, traverse shards with pruning
  const results: ScoredNode[] = [];
  for (const partition of partitions) {
    // Skip partitions outside token budget (using stats)
    if (tokensUsed >= tokenBudget) break;
    
    for (const shard of partition.shards) {
      // Prune entire shard if minScore too low
      if (shard.stats.minScore < 0.1) continue;
      if (tokensUsed >= tokenBudget) break;
      
      const shardResults = traverseShard(shard, options, tokenBudget - tokensUsed);
      tokensUsed += shardResults.tokensUsed;
      results.push(...shardResults.nodes);
      
      if (results.length >= (options.maxNodes ?? 100)) break;
    }
  }
  
  // 3. Sort by score, paginate
  results.sort((a, b) => b.score - a.score);
  const paginated = paginate(results, options);
  
  // 4. Fetch full memory entries for leaf nodes
  const memories = fetchMemories(paginated.map(n => n.memoryIds).flat());
  
  return { nodes: paginated, memories, total: results.length, tokensUsed };
}

function traverseShard(
  shard: TreeShard, 
  options: TreeSearchOptions, 
  remainingBudget: number,
  depth = 0
): { nodes: ScoredNode[]; tokensUsed: number } {
  if (depth > (options.maxDepth ?? 5)) return { nodes: [], tokensUsed: 0 };
  if (remainingBudget <= 0) return { nodes: [], tokensUsed: 0 };
  
  const results: ScoredNode[] = [];
  let tokensUsed = 0;
  
  // Best-first traversal using priority queue
  const queue: { node: TreeNode; depth: number; score: number }[] = [
    ...shard.nodes.map(n => ({ node: n, depth: 0, score: scoreNode(n, options.query) }))
  ].filter(x => x.score > 0.3).sort((a, b) => b.score - a.score);
  
  while (queue.length > 0 && tokensUsed < remainingBudget) {
    const { node, depth, score } = queue.shift()!;
    
    // Estimate tokens for this node at requested disclosure depth
    const nodeTokens = estimateNodeTokens(node, options.disclosureDepth ?? 'L2');
    if (tokensUsed + nodeTokens > remainingBudget) break;
    
    results.push({ ...node, score });
    tokensUsed += nodeTokens;
    
    // Add children to queue (depth-first but score-ordered)
    for (const child of node.children) {
      const childScore = scoreNode(child, options.query);
      if (childScore > 0.3) {
        queue.push({ node: child, depth: depth + 1, score: childScore });
      }
    }
    queue.sort((a, b) => b.score - a.score);
  }
  
  return { nodes: results, tokensUsed };
}

function estimateNodeTokens(node: TreeNode, depth: 'L1' | 'L2' | 'L3'): number {
  switch (depth) {
    case 'L1': return Math.ceil((node.title.length + node.summary.length) / 4);
    case 'L2': return Math.ceil((node.title.length + node.summary.length + (node.content?.length ?? 0)) / 4);
    case 'L3': return Math.ceil((node.title.length + node.summary.length + (node.content?.length ?? 0) + JSON.stringify(node.metadata).length) / 4);
  }
}
```

## Reasoning Layer (Phase 2+ Enhancement)
- Initial implementation: token-based scoring on node summary/title
- Future: LLM reasoning over tree structure (async, optional)
- LLM receives: query + relevant subtree → returns ranked node IDs with reasoning

## Integration Points
- `retrieval.ts`: Add `treeSearch` function alongside `queryContext`
- `vector.ts`: Keep as fallback when tree index unavailable
- CLI: `memory search --tree`, `memory index-build`
- MCP: New tool `memory_tree_search`

## File Layout
```
src/
  retrieval/
    tree-index.ts      # Core tree index + search + upsert
    tree-index.test.ts
    index.ts           # Export treeSearch, upsertMemory
```

## Configuration
```typescript
interface TreeIndexConfig {
  maxDepth: number;              // Default: 5
  maxNodesPerQuery: number;      // Default: 100
  clusteringThreshold: number;   // Default: 0.5
  minClusterSize: number;        // Default: 3
  shardThreshold: number;        // Default: 10000
  shardTimeBucket: 'daily' | 'weekly' | 'monthly'; // Default: 'monthly'
  enableLLMReasoning: boolean;   // Default: false (async opt-in)
  summaryModel?: string;         // LLM for summaries (optional)
  upsertIntervalMs: number;      // Default: 60000
}
```

## Performance Targets
- Build time: < 30s for 100k memories
- Query latency: < 50ms (p95) for 1M memories (partitioned + sharded)
- Memory overhead: < 50MB for 1M memories
- Token reduction: 70-90% vs full scan
- Incremental upsert: < 10ms per memory