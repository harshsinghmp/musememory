import type { Store } from "../store.ts";
import { list } from "../store.ts";
import type { MemoryEntry } from "../types.ts";
import {
  tokenize,
  computeFactors,
  evaluateQueryRelevance,
  deriveWhyRetrieved,
  isLowDiscrimination,
  conditionalRerank,
  clampLimit,
  matchesWordBoundary,
  evaluateAbstentionGate,
  type AbstentionDecision,
  type ScoreFactors,
  type VeracityClass,
  VERACITY_RANK_WEIGHTS,
  resolveVeracityClass,
  getVeracityWeight,
  type TaskIntent,
  INTENT_BIAS_TABLE,
  detectQueryIntent,
  computeIntentMultiplier,
  computeReinforcementMultiplier,
  computeEffectiveScore,
} from "../retrieval.ts";
import { searchMemoriesFts } from "../sqlite.ts";
import { defaultRegistry } from "../intelligence/registry.ts";
import {
  defaultReinjectionTracker,
  filterSelfEchoes,
  defaultSeenChunkTracker,
} from "./suppression.ts";

export type { ScoreFactors, AbstentionDecision, VeracityClass, TaskIntent };
export {
  isLowDiscrimination,
  conditionalRerank,
  deriveWhyRetrieved,
  matchesWordBoundary,
  evaluateAbstentionGate,
  VERACITY_RANK_WEIGHTS,
  resolveVeracityClass,
  getVeracityWeight,
  INTENT_BIAS_TABLE,
  detectQueryIntent,
  computeIntentMultiplier,
  computeReinforcementMultiplier,
  computeEffectiveScore,
};

/**
 * T-114: Soft-OR evidence fusion formula: P = 1 - (1 - pv) * (1 - pl).
 * Combines independent vector semantic probability (pv) and lexical/BM25 probability (pl)
 * without artificial linear dilution.
 */
export function softOrFusion(pv: number, pl: number): number {
  const clampedV = Math.max(0, Math.min(1, pv));
  const clampedL = Math.max(0, Math.min(1, pl));
  return 1 - (1 - clampedV) * (1 - clampedL);
}

export interface MultiFactorScoreResult {
  entry: MemoryEntry;
  score: number;
  /** T-119: Multiplicative composite score: base × reinforcement × decay. */
  effectiveScore?: number;
  factors: ScoreFactors;
  why_retrieved?: string[];
}

export interface MultiFactorRankingOptions {
  now?: number;
  workspaceRoot?: string;
  activeFilePath?: string;
  targetSymbol?: string;
  ftsMatchIds?: Set<string>;
  blastRadiusFiles?: Set<string>;
  /** R21: precomputed semantic cosine scores by entry id. */
  semanticScores?: Map<string, number>;
  /** T-118: Caller or detected task intent for query-intent bias. */
  taskIntent?: TaskIntent;
  inferIntent?: boolean;
  /** T-119: Use multiplicative effective_score (base × reinforcement × decay) for score. */
  useEffectiveScore?: boolean;
}

/**
 * muse_context's entry point into the one shared scorer (T-308): the same factor set
 * scoreEntry uses, plus the code-context signals only muse_context can supply
 * (active file, target symbol, FTS hits, blast radius).
 */
export function calculateMultiFactorScore(
  entry: MemoryEntry,
  queryTokens: string[],
  options: MultiFactorRankingOptions = {},
): MultiFactorScoreResult {
  const factors = computeFactors(entry, queryTokens, {
    now: options.now ?? Date.now(),
    workspaceRoot: options.workspaceRoot,
    semanticScore: options.semanticScores?.get(entry.id) ?? 0,
    activeFilePath: options.activeFilePath,
    targetSymbol: options.targetSymbol,
    ftsMatchIds: options.ftsMatchIds,
    blastRadiusFiles: options.blastRadiusFiles,
    taskIntent: options.taskIntent,
    inferIntent: options.inferIntent,
  });

  const score = options.useEffectiveScore ? (factors.effectiveScore ?? factors.totalScore) : factors.totalScore;

  return {
    entry,
    score,
    effectiveScore: factors.effectiveScore,
    factors,
    why_retrieved: deriveWhyRetrieved(factors, entry),
  };
}

/**
 * Multi-Factor Ranked Context Retriever (R5).
 * Ranks candidates with the shared scorer (T-308) and packs results within token budgets.
 */
export async function rankAndRetrieveMemories(
  store: Store,
  query: string,
  options: {
    limit?: number;
    project?: string;
    tokenBudget?: number;
    activeFilePath?: string;
    targetSymbol?: string;
    includeSuperseded?: boolean;
    now?: number;
    /** R21: precomputed semantic cosine scores by entry id. */
    semanticScores?: Map<string, number>;
    /** T-108: Session ID for turn-level re-injection suppression. */
    sessionId?: string;
    /** T-108: Session turn number. */
    sessionTurn?: number;
    /** T-108: Suppress memories injected in previous turns (default true if sessionId present). */
    suppressReinjection?: boolean;
    /** T-108: Turn window for suppression (default 6). */
    reinjectionWindow?: number;
    /** T-109: Suppress memories created by caller session/agent within echo horizon (default true). */
    suppressSelfEcho?: boolean;
    /** T-109: Self-echo horizon in milliseconds (default 10 minutes). */
    echoHorizonMs?: number;
    /** T-109: Caller agent name/identifier for provenance checking. */
    agent?: string;
    /** T-111: Suppress chunks/memories already seen within TTL window. */
    suppressSeenChunks?: boolean;
    /** T-111: Seen-chunk TTL in milliseconds (default: 5 minutes / 300,000ms). */
    seenChunkTtlMs?: number;
    /** T-111: Whether to record returned entries into seen-chunk tracker. */
    recordSeenChunks?: boolean;
    /** T-118: Caller or detected task intent for query-intent bias. */
    taskIntent?: TaskIntent;
    inferIntent?: boolean;
    /** T-119: Rank candidates by multiplicative effective_score (base × reinforcement × decay) instead of additive totalScore. */
    useEffectiveScore?: boolean;
  } = {},
): Promise<MultiFactorScoreResult[]> {
  const queryTokens = tokenize(query);
  const now = options.now ?? Date.now();
  const workspaceRoot = store.dir;
  const effectiveTaskIntent =
    options.taskIntent ??
    (options.inferIntent !== false && query.trim().length > 0 ? detectQueryIntent(query) : undefined);

  // 1. T-070 & T-072: FTS5-tokenizer-matched abstention gate before FTS5 search
  const ftsMatchIds = new Set<string>();
  const abstention = evaluateAbstentionGate(query);
  if (store.db && query.trim() && !abstention.abstain) {
    try {
      const ftsResults = searchMemoriesFts(store.db, query);
      if (ftsResults.degraded) {
        console.warn(`[FTS5_DEGRADED] Lexical FTS signal unavailable for ranking query "${query}": ${ftsResults.error}`);
      } else {
        for (const res of ftsResults.slice(0, 15)) {
          ftsMatchIds.add(res.entry.id);
        }
      }
    } catch (err) {
      console.warn(`[FTS5_DEGRADED] FTS exception during ranking: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 1.5. T-307: Hebbian associative candidate expansion from top matches
  if (store.memoryDir && ftsMatchIds.size > 0) {
    try {
      const { getAssociatedMemories } = await import("../plasticity.ts");
      for (const id of Array.from(ftsMatchIds).slice(0, 3)) {
        const associated = getAssociatedMemories(id, store.memoryDir);
        for (const assoc of associated.slice(0, 5)) {
          if (assoc.weight >= 0.2) {
            ftsMatchIds.add(assoc.targetId);
          }
        }
      }
    } catch {}
  }

  // 2. Optional Blast Radius pre-flight via Code Intelligence Provider
  const blastRadiusFiles = new Set<string>();
  if (options.targetSymbol || options.activeFilePath) {
    try {
      const target = options.targetSymbol || options.activeFilePath!;
      const blast = await defaultRegistry.getBlastRadiusWithFallback(target, workspaceRoot);
      for (const f of blast.affectedFiles) {
        blastRadiusFiles.add(f.toLowerCase());
      }
    } catch {}
  }

  // 3. Filter candidates
  let entries = list(store);
  if (options.project) {
    entries = entries.filter((e) => e.project === options.project);
  }
  if (!options.includeSuperseded) {
    entries = entries.filter((e) => e.status !== "superseded" && e.status !== "rejected");
  }
  // T-108: Re-injection suppression per session
  if (options.sessionId && options.suppressReinjection !== false) {
    const filtered = defaultReinjectionTracker.filterSuppressed(options.sessionId, entries, {
      turn: options.sessionTurn,
      window: options.reinjectionWindow,
    });
    entries = filtered.allowed;
  }
  // T-109: Self-echo suppression via capture-side provenance
  if (options.suppressSelfEcho !== false && (options.sessionId || options.agent)) {
    const echoFiltered = filterSelfEchoes(entries, {
      sessionId: options.sessionId,
      agent: options.agent,
      now,
      echoHorizonMs: options.echoHorizonMs,
    });
    entries = echoFiltered.allowed;
  }
  // T-111: Seen-chunk TTL suppression
  if (options.sessionId && (options.suppressSeenChunks || options.seenChunkTtlMs !== undefined)) {
    const seenFiltered = defaultSeenChunkTracker.filterSeen(options.sessionId, entries, {
      now,
      ttlMs: options.seenChunkTtlMs,
    });
    entries = seenFiltered.allowed;
  }

  // T-137: Vector-upgrade degradation path — resolve semantic scores if embedder configured
  let semanticScores = options.semanticScores;
  if (!semanticScores && store.db && query.trim()) {
    try {
      const { semanticScoresFor } = await import("./embed-store.ts");
      semanticScores = (await semanticScoresFor(store, query)) ?? undefined;
    } catch {
      // Cleanly degrade to FTS5 floor without throwing
      semanticScores = undefined;
    }
  }

  // 4. Score candidates
  const scored = entries.map((entry) =>
    calculateMultiFactorScore(entry, queryTokens, {
      now,
      workspaceRoot,
      activeFilePath: options.activeFilePath,
      targetSymbol: options.targetSymbol,
      ftsMatchIds,
      blastRadiusFiles,
      semanticScores,
      taskIntent: effectiveTaskIntent,
      useEffectiveScore: options.useEffectiveScore,
    }),
  );

  // 5. Sort descending by score (or effectiveScore if useEffectiveScore is true) and apply conditional rerank (T-115)
  scored.sort((a, b) => {
    const valA = options.useEffectiveScore ? (a.effectiveScore ?? a.score) : a.score;
    const valB = options.useEffectiveScore ? (b.effectiveScore ?? b.score) : b.score;
    if (valB !== valA) return valB - valA;
    const bU = Date.parse(b.entry.updated_at);
    const aU = Date.parse(a.entry.updated_at);
    return (Number.isNaN(bU) ? 0 : bU) - (Number.isNaN(aU) ? 0 : aU);
  });
  const ranked = conditionalRerank(scored);

  const limit = options.limit !== undefined ? clampLimit(options.limit, 10, 200, 1) : 10;

  // 6. Token Budget Knapsack Packing: Critical constraints fit first
  if (options.tokenBudget && options.tokenBudget > 0) {
    const packed: MultiFactorScoreResult[] = [];
    let tokensUsed = 0;

    // First pass: pack high-scoring critical constraints / timeless rules / negative lessons
    const isPriorityGuardrail = (e: MemoryEntry) =>
      e.type === "constraint" ||
      e.temporal_mode === "timeless" ||
      e.type === "negative" ||
      e.tags?.includes("anti-pattern") ||
      e.negative;

    const priorityGuardrails = ranked.filter(
      (s) => isPriorityGuardrail(s.entry) && s.score > 0.4,
    );

    for (const item of priorityGuardrails) {
      if (packed.length >= limit) break;
      const tokens = Math.ceil((item.entry.title.length + item.entry.content.length) / 4);
      if (tokensUsed + tokens <= options.tokenBudget) {
        packed.push(item);
        tokensUsed += tokens;
      }
    }

    // Second pass: pack remaining highest-scoring entries
    const packedIds = new Set(packed.map((p) => p.entry.id));
    for (const item of ranked) {
      if (packed.length >= limit) break;
      if (packedIds.has(item.entry.id)) continue;
      const tokens = Math.ceil((item.entry.title.length + item.entry.content.length) / 4);
      if (tokensUsed + tokens <= options.tokenBudget) {
        packed.push(item);
        tokensUsed += tokens;
      }
    }

    const results = packed;
    if (options.sessionId && (options.recordSeenChunks || options.suppressSeenChunks || options.seenChunkTtlMs !== undefined)) {
      defaultSeenChunkTracker.recordSeen(
        options.sessionId,
        results.map((r) => r.entry),
        { now, ttlMs: options.seenChunkTtlMs }
      );
    }
    return results;
  }

  const results = ranked.slice(0, limit);
  if (options.sessionId && (options.recordSeenChunks || options.suppressSeenChunks || options.seenChunkTtlMs !== undefined)) {
    defaultSeenChunkTracker.recordSeen(
      options.sessionId,
      results.map((r) => r.entry),
      { now, ttlMs: options.seenChunkTtlMs }
    );
  }
  return results;
}
