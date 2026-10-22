import type { MemoryEntry } from "../types.ts";

/**
 * T-076: Default Bayesian prior discount factor.
 * Each independent corroboration reduces uncertainty by 30% (retaining 70% of residual doubt).
 */
export const DEFAULT_CORROBORATION_DISCOUNT = 0.7;

/**
 * T-076: Compute Bayesian confidence score from n independent corroborations:
 * C(n) = 1 - discount^n
 *
 * Standard curve with discount = 0.7:
 * - n = 0: 0.0000 (0% confidence)
 * - n = 1: 0.3000 (30% confidence)
 * - n = 2: 0.5100 (51% confidence)
 * - n = 3: 0.6570 (~66% confidence)
 * - n = 4: 0.7599 (~76% confidence)
 * - n = 5: 0.8319 (~83% confidence)
 * - n -> inf: approaches 1.0 asymptotically
 */
export function computeBayesianConfidence(
  n: number,
  discount: number = DEFAULT_CORROBORATION_DISCOUNT,
): number {
  if (n <= 0 || !Number.isFinite(n)) return 0;
  const clampedDiscount = Math.max(0.01, Math.min(0.99, discount));
  const rawConfidence = 1 - Math.pow(clampedDiscount, n);
  return Number(Math.max(0, Math.min(1.0, rawConfidence)).toFixed(4));
}

export interface CorroborationEvaluation {
  n: number;
  confidence: number;
  isCorroborated: boolean;
  distinctDays: number;
  distinctSources: string[];
  reasons: string[];
}

/**
 * Whether an observation came from a machine rather than a human.
 *
 * This predicate was duplicated verbatim in `src/promotion/engine.ts`, which
 * is how the two "is this corroborated?" definitions drifted apart: one
 * counted evidence items, the other counted distinct calendar days. The
 * *predicate* must have exactly one implementation even when the two callers
 * apply different thresholds to it.
 */
export function isSyntheticSource(source?: string, type?: string): boolean {
  const s = (source ?? "").toLowerCase();
  const t = (type ?? "").toLowerCase();
  return (
    s === "agent" ||
    s === "transcript" ||
    s === "assistant" ||
    s === "inference" ||
    s === "distillation" ||
    s === "machine" ||
    s === "synthetic" ||
    t === "synthetic" ||
    t === "infer"
  );
}

/**
 * Evaluates independent corroboration count and Bayesian confidence for a memory entry.
 *
 * Corroboration signals include:
 * 1. Independent supporting evidence items (evidence.length)
 * 2. Multi-day temporal observation (distinct calendar days >= 2)
 * 3. Independent non-synthetic sources
 * 4. Positive user/authoritative reinforcement
 * 5. Authoritative or user-confirmed verification boost
 *
 * `isCorroborated` here is the CONFIDENCE bar (n >= 2 signals and at least
 * one non-synthetic source). The PROMOTION bar in
 * `src/promotion/engine.ts::checkCorroboration` is deliberately stricter —
 * it additionally requires evidence spanning two distinct calendar days. The
 * two are different gates and are named as such; the underlying predicate is
 * shared.
 */
export function evaluateCorroboration(entry: MemoryEntry): CorroborationEvaluation {
  const dates = new Set<string>();
  const sources = new Set<string>();
  const reasons: string[] = [];

  const isSynthetic = isSyntheticSource;

  if (entry.created_at) dates.add(entry.created_at.slice(0, 10));
  if (entry.last_confirmed_at) dates.add(entry.last_confirmed_at.slice(0, 10));
  if (entry.updated_at) dates.add(entry.updated_at.slice(0, 10));

  if (!isSynthetic(entry.source, entry.type)) {
    sources.add(entry.source ?? "human");
  }

  let evidenceCount = 0;
  if (entry.evidence && entry.evidence.length > 0) {
    for (const ev of entry.evidence) {
      if (ev.timestamp) dates.add(ev.timestamp.slice(0, 10));
      if (!isSynthetic(ev.source, ev.type)) {
        sources.add(ev.source || ev.type);
      }
      evidenceCount++;
    }
  }

  let n = 0;

  // 1. Independent evidence items
  if (evidenceCount > 0) {
    n += evidenceCount;
    reasons.push(`${evidenceCount} supporting evidence item(s)`);
  }

  // 2. Multi-day temporal corroboration
  if (dates.size >= 2) {
    n += dates.size - 1;
    reasons.push(`observed across ${dates.size} distinct calendar days`);
  }

  // 3. Independent non-synthetic sources
  if (sources.size > 1) {
    n += sources.size - 1;
    reasons.push(`corroborated by ${sources.size} distinct sources (${Array.from(sources).join(", ")})`);
  }

  // 4. Positive user/authoritative reinforcement
  if ((entry.reinforcement ?? 0) > 0) {
    n += Math.min(3, entry.reinforcement!);
    reasons.push(`reinforced ${entry.reinforcement} time(s)`);
  }

  // 5. Authoritative or user-confirmed verification boost
  if (
    entry.verification?.level === "authoritative" ||
    entry.verification?.level === "user-confirmed" ||
    entry.verification?.level === "independently-verified"
  ) {
    n += 1;
    reasons.push(`verified at level '${entry.verification.level}'`);
  }

  const confidence = computeBayesianConfidence(n);

  return {
    n,
    confidence,
    isCorroborated: n >= 2 && sources.size >= 1,
    distinctDays: dates.size,
    distinctSources: Array.from(sources),
    reasons,
  };
}
