import type { Store } from "../store.ts";
import { list } from "../store.ts";
import type { MemoryEntry } from "../types.ts";
import { STATUS_PENALTY } from "../types.ts";
import { tokenize, daysSince } from "../retrieval.ts";
import { searchMemoriesFts } from "../sqlite.ts";
import { defaultRegistry } from "../intelligence/registry.ts";

export interface ScoreFactors {
  exactSymbolMatch: number;
  pathMatch: number;
  bm25Match: number;
  graphOverlap: number;
  blastRadius: number;
  recencyDecay: number;
  utilityBonus: number;
  negativeWarningBonus: number;
  timelessBoost: number;
  statusPenalty: number;
  baseApplicability: number;
  totalScore: number;
}

export interface MultiFactorScoreResult {
  entry: MemoryEntry;
  score: number;
  factors: ScoreFactors;
}

export interface MultiFactorRankingOptions {
  now?: number;
  workspaceRoot?: string;
  activeFilePath?: string;
  targetSymbol?: string;
  ftsMatchIds?: Set<string>;
  blastRadiusFiles?: Set<string>;
}

/**
 * Multi-Factor Ranking Engine for MuseMemory (R5):
 * - Exact symbol match: +1.0
 * - Path / directory match: +0.4
 * - Lexical BM25 match (SQLite FTS5): +0.3
 * - Graph / call-graph overlap: +0.3 (if provider available)
 * - Blast-radius relevance: +0.25 (if provider available)
 * - Recency decay: -0.05 per 30 days untouched (0 for timeless)
 * - Utility / success-rate bonus: +0.25 for high reuse success
 * - Negative lesson warning bonus: +0.3 for anti-patterns matching query/files
 * - Invariant / timeless boost: +0.2 for constraint/timeless entries
 * - Status penalties: -0.8 conflicted, -0.5 stale/superseded
 */
export function calculateMultiFactorScore(
  entry: MemoryEntry,
  queryTokens: string[],
  options: MultiFactorRankingOptions = {},
): MultiFactorScoreResult {
  const now = options.now ?? Date.now();
  const lowerQueryTokens = queryTokens.map((t) => t.toLowerCase());
  const entryText = `${entry.title} ${entry.content}`.toLowerCase();

  // 1. Base applicability
  let matchedTokens = 0;
  for (const token of lowerQueryTokens) {
    if (entryText.includes(token)) matchedTokens++;
  }
  const baseApplicability = queryTokens.length > 0 ? (matchedTokens / queryTokens.length) * 0.5 : 0;

  // 2. Exact Symbol Match (+1.0)
  let exactSymbolMatch = 0;
  const entrySymbols = new Set<string>();
  if (entry.graph?.symbol_names) {
    for (const s of entry.graph.symbol_names) entrySymbols.add(s.toLowerCase());
  }
  for (const tag of entry.tags ?? []) {
    if (tag.length > 3 && !tag.includes("-") && !tag.includes(" ")) {
      entrySymbols.add(tag.toLowerCase());
    }
  }
  // Backtick symbol extractor from markdown
  const backtickMatches = entryText.match(/`([a-zA-Z0-9_$]+)`/g);
  if (backtickMatches) {
    for (const m of backtickMatches) {
      entrySymbols.add(m.replace(/`/g, "").toLowerCase());
    }
  }

  if (options.targetSymbol && entrySymbols.has(options.targetSymbol.toLowerCase())) {
    exactSymbolMatch = 1.0;
  } else {
    for (const token of lowerQueryTokens) {
      if (entrySymbols.has(token)) {
        exactSymbolMatch = 1.0;
        break;
      }
    }
  }

  // 3. Path / Directory Match (+0.4)
  let pathMatch = 0;
  const pathsInEntry = new Set<string>();
  if (entry.graph?.affected_paths) {
    for (const p of entry.graph.affected_paths) pathsInEntry.add(p.toLowerCase());
  }
  for (const ev of entry.evidence ?? []) {
    if (ev.source) pathsInEntry.add(ev.source.toLowerCase());
  }

  if (options.activeFilePath) {
    const lowerActive = options.activeFilePath.toLowerCase();
    for (const p of pathsInEntry) {
      if (lowerActive.includes(p) || p.includes(lowerActive)) {
        pathMatch = 0.4;
        break;
      }
    }
  }
  if (pathMatch === 0) {
    for (const token of lowerQueryTokens) {
      if (token.includes("/") || token.endsWith(".ts") || token.endsWith(".js") || token.endsWith(".py")) {
        for (const p of pathsInEntry) {
          if (p.includes(token)) {
            pathMatch = 0.4;
            break;
          }
        }
      }
    }
  }

  // 4. Lexical BM25 match (+0.3)
  const bm25Match = options.ftsMatchIds && options.ftsMatchIds.has(entry.id) ? 0.3 : 0;

  // 5. Graph / Call-Graph overlap (+0.3)
  let graphOverlap = 0;
  if (entry.graph?.symbol_names && entry.graph.symbol_names.length > 0 && queryTokens.length > 0) {
    const symMatches = queryTokens.filter((t) => entrySymbols.has(t.toLowerCase())).length;
    if (symMatches > 0) graphOverlap = 0.3;
  }

  // 6. Blast-Radius relevance (+0.25)
  let blastRadius = 0;
  if (options.blastRadiusFiles && options.blastRadiusFiles.size > 0) {
    for (const p of pathsInEntry) {
      if (options.blastRadiusFiles.has(p)) {
        blastRadius = 0.25;
        break;
      }
    }
  }

  // 7. Recency decay (-0.05 per 30 days untouched, 0 if timeless)
  let recencyDecay = 0;
  if (entry.temporal_mode !== "timeless" && entry.type !== "constraint") {
    const decayBase = entry.valid_from ?? entry.updated_at;
    const days = daysSince(decayBase, now);
    const monthsUntouched = Math.floor(days / 30);
    recencyDecay = -0.05 * Math.min(monthsUntouched, 6); // Cap decay at -0.30
  }

  // 8. Utility / success-rate bonus (+0.25)
  let utilityBonus = 0;
  if (entry.utility && entry.utility.application_count >= 1) {
    const successRate = entry.utility.reuse_success_rate ?? 1.0;
    if (successRate >= 0.75) {
      utilityBonus = 0.25;
    } else if (successRate < 0.4) {
      utilityBonus = -0.25;
    }
  }

  // 9. Negative lesson warning bonus (+0.3)
  let negativeWarningBonus = 0;
  if (entry.type === "negative" || entry.tags?.includes("anti-pattern") || entry.negative) {
    // If the negative lesson matches the query or path context, boost so agents are warned
    if (baseApplicability > 0 || exactSymbolMatch > 0 || pathMatch > 0) {
      negativeWarningBonus = 0.3;
    }
  }

  // 10. Invariant / Timeless Boost (+0.2)
  let timelessBoost = 0;
  if (entry.temporal_mode === "timeless" || entry.type === "constraint") {
    timelessBoost = 0.2;
  }

  // 11. Status Penalty (-0.8 conflicted, -0.5 stale/superseded)
  const statusPenalty = STATUS_PENALTY[entry.status] ?? 0;

  const totalScore =
    baseApplicability +
    exactSymbolMatch +
    pathMatch +
    bm25Match +
    graphOverlap +
    blastRadius +
    recencyDecay +
    utilityBonus +
    negativeWarningBonus +
    timelessBoost +
    statusPenalty;

  const factors: ScoreFactors = {
    baseApplicability,
    exactSymbolMatch,
    pathMatch,
    bm25Match,
    graphOverlap,
    blastRadius,
    recencyDecay,
    utilityBonus,
    negativeWarningBonus,
    timelessBoost,
    statusPenalty,
    totalScore,
  };

  return {
    entry,
    score: totalScore,
    factors,
  };
}

/**
 * Multi-Factor Ranked Context Retriever (R5).
 * Ranks candidates across all 11 factors and packs results within token budgets.
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
  } = {},
): Promise<MultiFactorScoreResult[]> {
  const queryTokens = tokenize(query);
  const now = options.now ?? Date.now();
  const workspaceRoot = store.dir;

  // 1. Optional FTS5 BM25 match pre-flight
  const ftsMatchIds = new Set<string>();
  if (store.db && query.trim()) {
    try {
      const ftsResults = searchMemoriesFts(store.db, query);
      for (const res of ftsResults.slice(0, 15)) {
        ftsMatchIds.add(res.entry.id);
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

  // 4. Score candidates
  const scored = entries.map((entry) =>
    calculateMultiFactorScore(entry, queryTokens, {
      now,
      workspaceRoot,
      activeFilePath: options.activeFilePath,
      targetSymbol: options.targetSymbol,
      ftsMatchIds,
      blastRadiusFiles,
    }),
  );

  // 5. Sort descending by totalScore
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const bU = Date.parse(b.entry.updated_at);
    const aU = Date.parse(a.entry.updated_at);
    return (Number.isNaN(bU) ? 0 : bU) - (Number.isNaN(aU) ? 0 : aU);
  });

  const limit = options.limit ?? 10;

  // 6. Token Budget Knapsack Packing: Critical constraints fit first
  if (options.tokenBudget && options.tokenBudget > 0) {
    const packed: MultiFactorScoreResult[] = [];
    let tokensUsed = 0;

    // First pass: pack high-scoring critical constraints / timeless rules
    const criticalConstraints = scored.filter(
      (s) => (s.entry.type === "constraint" || s.entry.temporal_mode === "timeless") && s.score > 0.5,
    );

    for (const item of criticalConstraints) {
      if (packed.length >= limit) break;
      const tokens = Math.ceil((item.entry.title.length + item.entry.content.length) / 4);
      if (tokensUsed + tokens <= options.tokenBudget) {
        packed.push(item);
        tokensUsed += tokens;
      }
    }

    // Second pass: pack remaining highest-scoring entries
    const packedIds = new Set(packed.map((p) => p.entry.id));
    for (const item of scored) {
      if (packed.length >= limit) break;
      if (packedIds.has(item.entry.id)) continue;
      const tokens = Math.ceil((item.entry.title.length + item.entry.content.length) / 4);
      if (tokensUsed + tokens <= options.tokenBudget) {
        packed.push(item);
        tokensUsed += tokens;
      }
    }

    return packed;
  }

  return scored.slice(0, limit);
}
