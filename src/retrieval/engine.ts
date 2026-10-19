import type { Store } from "../store.ts";
import { list, countMemories } from "../store.ts";
import {
  queryContext,
  searchTemporal,
  formatPromptContext,
  clampLimit,
  type ContextQueryOptions,
  type FormattedContext,
  type ScoredEntry,
} from "../retrieval.ts";
import { searchTree, buildTreeIndex, loadTreeIndex, type TreeSearchResult, type TreeIndex } from "./tree-index.ts";
import { hybridSearch, rebuildIndex, saveIndex, indexFilePath, loadIndex } from "../vector.ts";
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
  stale?: boolean;
  fromCache?: boolean;
  confidence_mode?: "confident_match" | "no_confident_match";
  no_confident_match?: boolean;
  /** T-083: Point-in-time timestamp if as_of evaluation was requested */
  as_of?: string;
  /** T-083: Memories whose validity is undetermined at as_of */
  undetermined?: ScoredEntry[];
  /** T-089: Memories withheld by provenance veracity or trust filters */
  withheld?: Array<{ id: string; reason: string }>;
  /** T-096: Count of superseded or inactive memories filtered out during retrieval */
  hidden_count?: number;
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
    const isDegraded = store.circuit?.isDegraded() ?? false;
    let fallbackStale = false;
    let fallbackExplanation: string | undefined;

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
          const minScore = options.minScoreThreshold ?? 0.45;
          const hasConfidentMatch =
            mapped.length > 0 && (!query.trim() || mapped.some((r) => r.score >= minScore));
          return {
            mode: "pageindex",
            results: mapped,
            totalTokensUsed: pageResults.tokensUsed,
            explanation: pageResults.reasoning,
            stale: isDegraded,
            fromCache: false,
            confidence_mode: hasConfidentMatch ? "confident_match" : "no_confident_match",
            no_confident_match: !hasConfidentMatch,
          };
        } else if (mode === "pageindex") {
          fallbackStale = true;
          fallbackExplanation = "Degraded read: requested pageindex search has no index; fell back to exact search";
        }
      } catch (err: unknown) {
        if (mode === "pageindex") {
          fallbackStale = true;
          fallbackExplanation = `Degraded read: pageindex search failed (${err instanceof Error ? err.message : String(err)}); fell back to exact search`;
        }
      }
    }

    // 2. Partitioned Tree Index Search
    const treeDir = join(memoryDir, "tree");
    const hasTree = existsSync(treeDir);
    const memCount = countMemories(store);

    if (mode === "tree" || (mode === "auto" && hasTree && memCount >= 500)) {
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

            const minScore = options.minScoreThreshold ?? 0.45;
            const hasConfidentMatch =
              mapped.length > 0 && (!query.trim() || mapped.some((r) => r.score >= minScore));
            return {
              mode: "tree",
              results: mapped,
              totalTokensUsed: treeRes.tokensUsed,
              explanation: `Tree search evaluated ${treeRes.shardsSearched} shards with progressive disclosure ${options.depth ?? "L2"}`,
              stale: isDegraded,
              fromCache: false,
              confidence_mode: hasConfidentMatch ? "confident_match" : "no_confident_match",
              no_confident_match: !hasConfidentMatch,
            };
          }
        }
        if (mode === "tree") {
          fallbackStale = true;
          fallbackExplanation = "Degraded read: requested tree search found no index or matches; fell back to exact search";
        }
      } catch (err: unknown) {
        if (mode === "tree") {
          fallbackStale = true;
          fallbackExplanation = `Degraded read: tree search failed (${err instanceof Error ? err.message : String(err)}); fell back to exact search`;
        }
      }
    }

    // 3. Fused Hybrid Vector Search
    const vecPath = indexFilePath(memoryDir);
    const hasVec = existsSync(vecPath);

    if (mode === "hybrid" || (mode === "auto" && hasVec && memCount > 100)) {
      try {
        const hybridResults = hybridSearch(store, memoryDir, query, {
          limit: options.limit !== undefined ? clampLimit(options.limit, 10, 200, 1) : 10,
          // T-303: hybrid is scale-gated, so it must apply the same lifecycle/project
          // row filter as the exact path or stale/cross-project rows leak into context.
          project: options.project,
          includeSuperseded: options.includeSuperseded,
          includeArchived: options.includeArchived,
          includeExpired: options.includeExpired,
          now: options.now,
        });

        if (hybridResults && hybridResults.length > 0) {
          const mapped: ScoredEntry[] = hybridResults.map((r) => ({
            entry: r.entry,
            score: r.score,
          }));

          // T-064 / T-304: check if vector index is stale compared to store memory count
          let isVectorStale = false;
          try {
            const idx = loadIndex(memoryDir);
            if (idx && Object.keys(idx.entries).length !== memCount) {
              isVectorStale = true;
            }
          } catch {}

          const minScore = options.minScoreThreshold ?? 0.45;
          const hasConfidentMatch =
            mapped.length > 0 && (!query.trim() || mapped.some((r) => r.score >= minScore));

          return {
            mode: "hybrid",
            results: mapped,
            totalTokensUsed: Math.ceil(mapped.reduce((acc, r) => acc + r.entry.content.length, 0) / 4),
            explanation: isVectorStale
              ? `Degraded read: Hybrid BM25 + Vector search retrieved ${mapped.length} entries (vector index is stale)`
              : `Hybrid BM25 + Vector search retrieved ${mapped.length} entries`,
            stale: isDegraded || isVectorStale,
            fromCache: false,
            confidence_mode: hasConfidentMatch ? "confident_match" : "no_confident_match",
            no_confident_match: !hasConfidentMatch,
          };
        }
        if (mode === "hybrid") {
          fallbackStale = true;
          fallbackExplanation = "Degraded read: requested hybrid vector index missing or returned no results; fell back to exact search";
        }
      } catch (err: unknown) {
        if (mode === "hybrid") {
          fallbackStale = true;
          fallbackExplanation = `Degraded read: hybrid vector search failed (${err instanceof Error ? err.message : String(err)}); fell back to exact search`;
        }
      }
    }

    // 4. Default / Exact Bi-Temporal Knapsack Search
    const exact = queryContext(store, query, options);
    return {
      mode: "exact",
      results: exact.results,
      totalTokensUsed: exact.totalTokensUsed ?? 0,
      stale: isDegraded || fallbackStale || exact.stale,
      fromCache: exact.fromCache ?? false,
      explanation: fallbackExplanation ?? (isDegraded ? "Degraded read: circuit breaker is open" : undefined),
      confidence_mode: exact.mode,
      no_confident_match: exact.no_confident_match,
      as_of: exact.as_of,
      undetermined: exact.undetermined,
      withheld: exact.withheld,
      hidden_count: exact.hidden_count,
    };
  }

  /**
   * T-083: Bi-temporal point-in-time search returning results and undetermined candidates.
   */
  static searchAsOf(
    store: Store,
    memoryDir: string,
    query: string,
    asOfTime: string | number,
    options: UnifiedSearchOptions = {},
  ): UnifiedSearchResult {
    return RetrievalEngine.search(store, memoryDir, query, {
      ...options,
      as_of: asOfTime,
      mode: "exact",
    });
  }

  /**
   * T-085: Point-in-time temporal search default-excluding superseded entries.
   */
  static searchTemporal(
    store: Store,
    _memoryDir: string,
    query: string,
    atTime: string | number,
    options: UnifiedSearchOptions & { includeSuperseded?: boolean } = {},
  ): UnifiedSearchResult {
    const res = searchTemporal(store, query, atTime, {
      ...options,
      includeSuperseded: options.includeSuperseded === true,
    });
    return {
      mode: "exact",
      results: res.results,
      totalTokensUsed: res.totalTokensUsed ?? 0,
      stale: res.stale ?? false,
      fromCache: res.fromCache ?? false,
      confidence_mode: res.mode,
      no_confident_match: res.no_confident_match,
      as_of: res.as_of,
      undetermined: res.undetermined,
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
