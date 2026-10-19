import type { MemoryEntry } from "../types.ts";
import type { ScoreFactors } from "../retrieval.ts";

export type CandidateKeepReason =
  | "kept:high_relevance"
  | "kept:exact_symbol_match"
  | "kept:bm25_fts_hit"
  | "kept:semantic_vector_match"
  | "kept:active_constraint"
  | "kept:timeless_rule"
  | "kept:negative_pattern_warning"
  | "kept:verified_memory"
  | "kept:high_utility"
  | "kept:intent_bias"
  | "kept:rrf_top_rank"
  | "kept:within_budget";

export type CandidateDropReason =
  | "dropped:below_min_threshold"
  | "dropped:token_budget_exceeded"
  | "dropped:limit_exceeded"
  | "dropped:superseded_or_rejected"
  | "dropped:reinjection_suppressed"
  | "dropped:self_echo_suppressed"
  | "dropped:seen_chunk_suppressed"
  | "dropped:untrusted_tier"
  | "dropped:drifted_anchor"
  | "dropped:dedup_prefer_observation";

export interface CandidateEvaluation {
  id: string;
  title: string;
  decision: "keep" | "drop";
  reasons: Array<CandidateKeepReason | CandidateDropReason | string>;
  score?: number;
}

/**
 * T-121: Derives deterministic typed keep reasons for a candidate memory.
 */
export function deriveCandidateKeepReasons(
  entry: MemoryEntry,
  factors?: ScoreFactors,
): CandidateKeepReason[] {
  const reasons: CandidateKeepReason[] = [];

  if (factors) {
    if (factors.exactSymbolMatch > 0) reasons.push("kept:exact_symbol_match");
    if (factors.bm25Match > 0) reasons.push("kept:bm25_fts_hit");
    if (factors.semanticMatch > 0) reasons.push("kept:semantic_vector_match");
    if (factors.intentBias && factors.intentBias > 0) reasons.push("kept:intent_bias");
    if (factors.utilityBonus > 0 || (factors.reinforcementMultiplier && factors.reinforcementMultiplier > 1.0)) {
      reasons.push("kept:high_utility");
    }
    if (factors.totalScore >= 0.5 || (factors.effectiveScore && factors.effectiveScore >= 0.5)) {
      reasons.push("kept:high_relevance");
    }
  }

  if (entry.type === "constraint") reasons.push("kept:active_constraint");
  if (entry.temporal_mode === "timeless") reasons.push("kept:timeless_rule");
  if (
    entry.type === "negative" ||
    entry.tags?.includes("anti-pattern") ||
    entry.negative ||
    (factors && factors.negativeWarningBonus > 0)
  ) {
    reasons.push("kept:negative_pattern_warning");
  }
  if (entry.verification?.level && entry.verification.level !== "unverified") {
    reasons.push("kept:verified_memory");
  }

  reasons.push("kept:within_budget");

  return Array.from(new Set(reasons));
}

/**
 * T-121: Derives deterministic typed drop reason for a candidate memory.
 */
export function deriveCandidateDropReason(
  reasonKeyword: string,
): CandidateDropReason {
  const lower = reasonKeyword.toLowerCase();
  if (lower.includes("reinjection")) return "dropped:reinjection_suppressed";
  if (lower.includes("self_echo") || lower.includes("echo")) return "dropped:self_echo_suppressed";
  if (lower.includes("seen_chunk") || lower.includes("seen")) return "dropped:seen_chunk_suppressed";
  if (lower.includes("budget") || lower.includes("token")) return "dropped:token_budget_exceeded";
  if (lower.includes("threshold") || lower.includes("low_relevance")) return "dropped:below_min_threshold";
  if (lower.includes("limit")) return "dropped:limit_exceeded";
  if (lower.includes("supersede") || lower.includes("reject")) return "dropped:superseded_or_rejected";
  if (lower.includes("untrusted")) return "dropped:untrusted_tier";
  if (lower.includes("drift")) return "dropped:drifted_anchor";
  if (lower.includes("dedup") || lower.includes("observation")) return "dropped:dedup_prefer_observation";

  return "dropped:below_min_threshold";
}

/**
 * T-121: Evaluates keep/drop decisions and attaches structured typed reasons for an array of candidates.
 */
export function evaluateCandidateDecisions(
  candidates: Array<{ entry: MemoryEntry; score?: number; factors?: ScoreFactors; drop_reason?: string }>,
  selectedIds: Set<string>,
): CandidateEvaluation[] {
  return candidates.map((c) => {
    const isKept = selectedIds.has(c.entry.id);
    if (isKept) {
      return {
        id: c.entry.id,
        title: c.entry.title,
        decision: "keep" as const,
        reasons: deriveCandidateKeepReasons(c.entry, c.factors),
        score: c.score,
      };
    } else {
      const dropReason = c.drop_reason ? deriveCandidateDropReason(c.drop_reason) : "dropped:limit_exceeded";
      return {
        id: c.entry.id,
        title: c.entry.title,
        decision: "drop" as const,
        reasons: [dropReason],
        score: c.score,
      };
    }
  });
}
