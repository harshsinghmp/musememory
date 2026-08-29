import type { Store } from "../store.ts";
import { list } from "../store.ts";
import { queryContext, formatPromptContext, type ContextQueryOptions, type FormattedContext, type ScoredEntry } from "../retrieval.ts";
import { searchTree, buildTreeIndex, loadTreeIndex, type TreeSearchResult, type TreeIndex } from "./tree-index.ts";
import { hybridSearch, rebuildIndex, saveIndex, indexFilePath } from "../vector.ts";
import { searchPageIndex, listPageIndexes } from "../pageindex/engine.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface UnifiedSearchOptions extends ContextQueryOptions {
  /** Search execution strategy: 'auto' (default), 'exact', 'hybrid', 'tree', or 'pageindex' */
  mode?: "auto" | "exact" | "hybrid" | "tree" | "pageindex";
  /** Optional document index path for pageindex searches */
  docPath?: string;
}

export interface UnifiedSearchResult {
  mode: "exact" | "hybrid" | "tree" | "pageindex";
  results: ScoredEntry[];
  totalTokensUsed: number;
  explanation?: string;
}

export interface ReindexReport {
  vectorEntries: number;
  treeShards: number;
  timestamp: string;
}

/**
 * Adaptive Query Planner & Unified Retrieval Engine:
 * Intelligently routes queries across Exact Bi-Temporal Knapsack, Fused Trigram Hybrid,
 * Partitioned Hierarchical Tree Index, or PageIndex Document Tree based on store characteristics.
 */
export class RetrievalEngine {
  /**
   * Unified search across all indexed memories and documents.
   */
  static search(
    store: Store,
    memoryDir: string,
    query: string,
    options: UnifiedSearchOptions = {},
  ): UnifiedSearchResult {
    const mode = options.mode ?? "auto";

    // 1. PageIndex Document Search
    if (mode === "pageindex" || (options.docPath && existsSync(options.docPath))) {
      try {
        const docs = listPageIndexes(memoryDir, options.project);
        if (docs.length > 0) {
          const pageResults = searchPageIndex(docs[0], { query, tokenBudget: options.tokenBudget });
          const mapped: ScoredEntry[] = pageResults.results.map((r) => ({
            entry: {
              id: r.nodeId,
              title: r.title,
              content: r.summary,
              project: options.project ?? "doc",
              status: "active" as const,
              type: "discovery" as const,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            score: r.score,
          }));
          return {
            mode: "pageindex",
            results: mapped,
            totalTokensUsed: pageResults.tokensUsed,
            explanation: pageResults.reasoning,
          };
        }
      } catch {
        // Fallback to exact if pageindex evaluation fails
      }
    }

    // 2. Partitioned Tree Index Search
    const treeDir = join(memoryDir, "tree");
    const hasTree = existsSync(treeDir);
    const allEntries = list(store);

    if (mode === "tree" || (mode === "auto" && hasTree && allEntries.length >= 500)) {
      try {
        const treeIndex = loadTreeIndex(memoryDir);
        if (treeIndex) {
          const treeRes: TreeSearchResult = searchTree(treeIndex, {
            query,
            project: options.project,
            type: options.type as any,
            tokenBudget: options.tokenBudget,
            disclosureDepth: options.depth ?? "L2",
          });

          if (treeRes.nodes.length > 0) {
            const mapped: ScoredEntry[] = treeRes.nodes.map((sn) => ({
              entry: {
                id: sn.node.id,
                title: sn.node.title,
                content: sn.node.content ?? sn.node.summary,
                project: sn.node.project,
                status: (sn.node.status as any) ?? "active",
                type: sn.node.type,
                created_at: sn.node.metadata.createdAt,
                updated_at: sn.node.metadata.updatedAt,
              },
              score: sn.score,
            }));

            return {
              mode: "tree",
              results: mapped,
              totalTokensUsed: treeRes.tokensUsed,
              explanation: `Tree search evaluated ${treeRes.shardsSearched} shards with progressive disclosure ${options.depth ?? "L2"}`,
            };
          }
        }
      } catch {
        // Fallback to exact
      }
    }

    // 3. Fused Hybrid Vector Search
    const vecPath = indexFilePath(memoryDir);
    const hasVec = existsSync(vecPath);

    if (mode === "hybrid" || (mode === "auto" && hasVec && allEntries.length > 100)) {
      try {
        const hybridResults = hybridSearch(store, memoryDir, query, {
          limit: options.limit ?? 10,
        });

        if (hybridResults && hybridResults.length > 0) {
          const mapped: ScoredEntry[] = hybridResults.map((r) => ({
            entry: r.entry,
            score: r.score,
          }));
          return {
            mode: "hybrid",
            results: mapped,
            totalTokensUsed: Math.ceil(mapped.reduce((acc, r) => acc + r.entry.content.length, 0) / 4),
            explanation: `Hybrid BM25 + Vector search retrieved ${mapped.length} entries`,
          };
        }
      } catch {
        // Fallback to exact
      }
    }

    // 4. Default / Exact Bi-Temporal Knapsack Search
    const exact = queryContext(store, query, options);
    return {
      mode: "exact",
      results: exact.results,
      totalTokensUsed: exact.totalTokensUsed ?? 0,
    };
  }

  /**
   * High-leverage prompt context builder (USER.md + CURRENT.md + Ranked Memories + Wiki).
   */
  static formatPromptContext(
    store: Store,
    memoryDir?: string,
    query: string = "",
    options: ContextQueryOptions = {},
  ): FormattedContext {
    return formatPromptContext(store, memoryDir, query, options);
  }

  /**
   * Re-index all backends (vector, tree shards) in a single coordinated pass.
   */
  static reindexAll(store: Store, memoryDir: string): ReindexReport {
    // 1. Rebuild Vector BM25 + Trigram Index
    const vecIndex = rebuildIndex(store);
    saveIndex(vecIndex, memoryDir);

    // 2. Rebuild Hierarchical Sharded Tree Index
    const treeReport = buildTreeIndex(store, memoryDir);

    return {
      vectorEntries: Object.keys(vecIndex.entries).length,
      treeShards: treeReport.totalNodes,
      timestamp: new Date().toISOString(),
    };
  }
}
