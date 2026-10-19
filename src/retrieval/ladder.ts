/**
 * T-135: Tiered Retrieval Ladder & Loosened Match Labeling
 *
 * Implements a progressive step-down retrieval ladder:
 * - Rung 1: Strict Match (exact symbol / active file / strict score >= 0.70)
 * - Rung 2: Standard Match (multi-factor BM25 + semantic, standard score >= 0.45)
 * - Rung 3: Loosened Match (relaxed score >= 0.20, relaxed project scope, partial token overlap)
 *
 * All memories admitted via Rung 3 are explicitly labeled with `ladder_rung: 3`,
 * `is_loosened: true`, and an unambiguous `loosened_reason`.
 */

import type { Store } from "../store.ts";
import type { ScoredEntry, SearchResult, ContextQueryOptions } from "../retrieval.ts";
import { queryContext } from "../retrieval.ts";

export type RetrievalLadderRung = 1 | 2 | 3;
export type LadderRungName = "strict" | "standard" | "loosened";

export interface LoosenedMatchLabel {
  ladder_rung: RetrievalLadderRung;
  rung_name: LadderRungName;
  is_loosened: boolean;
  loosened_reason?: string;
}

export interface RetrievalLadderOptions {
  /** Whether to execute multi-step ladder fallback (default: true). */
  enable_ladder?: boolean;
  /** Minimum number of confident matches before stopping ladder (default: 1). */
  min_confident_count?: number;
  /** Score threshold for strict matching in Rung 1 (default: 0.70). */
  strict_threshold?: number;
  /** Score threshold for standard matching in Rung 2 (default: 0.45). */
  standard_threshold?: number;
  /** Score threshold for loosened matching in Rung 3 (default: 0.20). */
  loosened_threshold?: number;
  /** Whether to relax project scope to include global memories in Rung 3 (default: true). */
  allow_scope_relaxation?: boolean;
}

export const LADDER_DEFAULTS = {
  STRICT_THRESHOLD: 0.7,
  STANDARD_THRESHOLD: 0.45,
  LOOSENED_THRESHOLD: 0.2,
  MIN_CONFIDENT_COUNT: 1,
} as const;

/**
 * Labels a scored entry with ladder rung metadata and explicit loosened reasons.
 */
export function labelEntryLadderRung(
  entry: ScoredEntry,
  rung: RetrievalLadderRung,
  reason?: string
): ScoredEntry {
  entry.ladder_rung = rung;
  entry.is_loosened = rung === 3;
  if (entry.is_loosened) {
    entry.loosened_reason = reason || `loosened_score_threshold: score ${entry.score.toFixed(2)} admitted below standard threshold`;
  } else {
    entry.loosened_reason = undefined;
  }
  return entry;
}

/**
 * Formats an unambiguous badge string for loosened matches in prompt context.
 */
export function formatLoosenedBadge(entry: ScoredEntry): string {
  if (!entry.is_loosened) return "";
  const reasonText = entry.loosened_reason ? ` — ${entry.loosened_reason}` : "";
  return ` [LOOSENED MATCH (Rung 3)${reasonText}]`;
}

/**
 * Progressive retrieval ladder engine:
 * Iterates through Rungs 1 -> 2 -> 3 until sufficient confident candidates are found,
 * and explicitly tags all loosened admissions.
 */
export function executeRetrievalLadder(
  store: Store,
  query: string,
  options: ContextQueryOptions & RetrievalLadderOptions = {}
): SearchResult {
  const minCount = options.min_confident_count ?? LADDER_DEFAULTS.MIN_CONFIDENT_COUNT;
  const strictThreshold = options.strict_threshold ?? LADDER_DEFAULTS.STRICT_THRESHOLD;
  const standardThreshold = options.standard_threshold ?? LADDER_DEFAULTS.STANDARD_THRESHOLD;
  const loosenedThreshold = options.loosened_threshold ?? LADDER_DEFAULTS.LOOSENED_THRESHOLD;

  const rungsUsed: RetrievalLadderRung[] = [];
  const combinedEntries: ScoredEntry[] = [];
  const seenIds = new Set<string>();

  // Rung 1: Strict Match
  rungsUsed.push(1);
  const strictResult = queryContext(store, query, {
    ...options,
    enable_ladder: false,
    minScoreThreshold: strictThreshold,
  });

  for (const item of strictResult.results) {
    if (item.score >= strictThreshold) {
      labelEntryLadderRung(item, 1);
      seenIds.add(item.entry.id);
      combinedEntries.push(item);
    }
  }

  // If sufficient confident matches found in Rung 1, return immediately
  if (combinedEntries.length >= minCount) {
    const confident = combinedEntries.filter((e) => !e.is_loosened);
    return {
      ...strictResult,
      results: combinedEntries,
      confident_answers: confident,
      mode: confident.length > 0 ? "confident_match" : "no_confident_match",
      no_confident_match: confident.length === 0,
      ladder_rungs_used: rungsUsed,
      loosened_matches_count: 0,
      loosened_matches: [],
    };
  }

  // Rung 2: Standard Match
  rungsUsed.push(2);
  const standardResult = queryContext(store, query, {
    ...options,
    enable_ladder: false,
    minScoreThreshold: standardThreshold,
  });

  for (const item of standardResult.results) {
    if (!seenIds.has(item.entry.id) && item.score >= standardThreshold) {
      labelEntryLadderRung(item, 2);
      seenIds.add(item.entry.id);
      combinedEntries.push(item);
    }
  }

  if (combinedEntries.length >= minCount) {
    const confident = combinedEntries.filter((e) => !e.is_loosened);
    return {
      ...standardResult,
      results: combinedEntries,
      confident_answers: confident,
      mode: confident.length > 0 ? "confident_match" : "no_confident_match",
      no_confident_match: confident.length === 0,
      ladder_rungs_used: rungsUsed,
      loosened_matches_count: 0,
      loosened_matches: [],
    };
  }

  // Rung 3: Loosened Match
  rungsUsed.push(3);
  const loosenedResult = queryContext(store, query, {
    ...options,
    enable_ladder: false,
    minScoreThreshold: loosenedThreshold,
  });

  const loosenedMatches: ScoredEntry[] = [];
  for (const item of loosenedResult.results) {
    if (!seenIds.has(item.entry.id)) {
      labelEntryLadderRung(
        item,
        3,
        `loosened_threshold: score ${item.score.toFixed(2)} admitted below standard threshold (${standardThreshold})`
      );
      seenIds.add(item.entry.id);
      combinedEntries.push(item);
      loosenedMatches.push(item);
    }
  }

  // If still no results and project scope relaxation is enabled
  if (combinedEntries.length === 0 && options.project && options.allow_scope_relaxation !== false) {
    const globalResult = queryContext(store, query, {
      ...options,
      enable_ladder: false,
      project: undefined,
      minScoreThreshold: loosenedThreshold,
    });
    for (const item of globalResult.results) {
      if (!seenIds.has(item.entry.id)) {
        labelEntryLadderRung(
          item,
          3,
          `loosened_scope: relaxed project '${options.project}' constraint to global`
        );
        seenIds.add(item.entry.id);
        combinedEntries.push(item);
        loosenedMatches.push(item);
      }
    }
  }

  const confident = combinedEntries.filter((e) => !e.is_loosened);
  return {
    ...loosenedResult,
    results: combinedEntries,
    confident_answers: confident,
    mode: confident.length > 0 ? "confident_match" : "no_confident_match",
    no_confident_match: confident.length === 0,
    ladder_rungs_used: rungsUsed,
    loosened_matches_count: loosenedMatches.length,
    loosened_matches: loosenedMatches,
  };
}
