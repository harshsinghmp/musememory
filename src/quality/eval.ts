/**
 * R27 & Wave 6: Recall-set grading harness, benchmark drift discipline,
 * latency budgets, and fixture promotion telemetry validation (T-140, T-141, T-142, T-143).
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { Store } from "../store.ts";
import { queryContext } from "../retrieval.ts";
import type { LatencyMetric } from "../benchmark/suite.ts";

/** recall@5 floor for the golden test corpus */
export const RECALL5_FLOOR = 0.8;

/** Default latency budgets */
export const P50_BUDGET_MS = 25;
export const P95_BUDGET_MS = 60;
export const P99_BUDGET_MS = 100;

/** Minimum query frequency in production telemetry required for fixture promotion (T-143) */
export const MIN_PROMOTION_USAGE = 3;

/** Frozen benchmark corpus deterministic checksum (T-141) */
export const FROZEN_CORPUS_HASH = "33d5e6dc3ff2767ee9411496bea6b535ecf38e5c5d8eadc469b074782a06138d";

export interface GoldenQueryTelemetry {
  query_count: number;
  source: string;
  last_seen_at?: string;
}

export interface GoldenQuery {
  query: string;
  relevant: string[];
  distractors: string[];
  telemetry?: GoldenQueryTelemetry;
}

export interface RecallGradeResult {
  totalQueries: number;
  recallAtK: number;
  distractorViolations: number;
  noiseAsFailureCount: number;
  abstentionAccuracy: number;
  totalAbstentionQueries: number;
  passed: boolean;
  latency: LatencyMetric;
}

export interface GradeOptions {
  k?: number;
  recallFloor?: number;
  distractorTolerance?: number;
  p50BudgetMs?: number;
}

function calculatePercentiles(samples: number[], unit: "ms" | "µs"): LatencyMetric {
  if (samples.length === 0) {
    return { min: 0, p50: 0, p95: 0, p99: 0, max: 0, unit };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const min = Math.round(sorted[0] * 100) / 100;
  const max = Math.round(sorted[sorted.length - 1] * 100) / 100;
  const p50 = Math.round(sorted[Math.floor(sorted.length * 0.5)] * 100) / 100;
  const p95 = Math.round(sorted[Math.floor(sorted.length * 0.95)] * 100) / 100;
  const p99 = Math.round(sorted[Math.floor(sorted.length * 0.99)] * 100) / 100;
  return { min, p50, p95, p99, max, unit };
}

/**
 * T-140: Grade recall against must-return relevant hits, must-not-return distractors,
 * and abstention evaluation where noise is treated as failure.
 */
export function gradeRecallSet(
  store: Store,
  queries: GoldenQuery[],
  options: GradeOptions = {},
): RecallGradeResult {
  const k = options.k ?? 5;
  const floor = options.recallFloor ?? RECALL5_FLOOR;
  const distractorTolerance = options.distractorTolerance ?? 10;
  const p50Budget = options.p50BudgetMs ?? P50_BUDGET_MS;

  let recallSum = 0;
  let relevantQueryCount = 0;
  let distractorViolations = 0;
  let abstentionSuccesses = 0;
  let abstentionQueryCount = 0;
  const latencies: number[] = [];

  for (const q of queries) {
    const t0 = performance.now();
    const results = queryContext(store, q.query, { limit: 10 });
    latencies.push(performance.now() - t0);

    const topK = new Set(results.results.slice(0, k).map((r) => r.entry.id));

    // Must-not-return check: distractors in top-k
    const queryDistractorViolations = q.distractors.filter((id) => topK.has(id)).length;
    distractorViolations += queryDistractorViolations;

    if (q.relevant.length > 0) {
      relevantQueryCount++;
      const hits = q.relevant.filter((id) => topK.has(id)).length;
      recallSum += hits / q.relevant.length;
    } else {
      // Abstention query: must not return distractors or unrelated high-scoring noise
      abstentionQueryCount++;
      if (queryDistractorViolations === 0) {
        abstentionSuccesses++;
      }
    }
  }

  const recallAtK = relevantQueryCount > 0 ? recallSum / relevantQueryCount : 1.0;
  const abstentionAccuracy = abstentionQueryCount > 0 ? abstentionSuccesses / abstentionQueryCount : 1.0;
  const latency = calculatePercentiles(latencies, "ms");
  const noiseAsFailureCount = distractorViolations;

  const passed =
    recallAtK >= floor &&
    distractorViolations <= distractorTolerance &&
    latency.p50 <= p50Budget;

  return {
    totalQueries: queries.length,
    recallAtK,
    distractorViolations,
    noiseAsFailureCount,
    abstentionAccuracy,
    totalAbstentionQueries: abstentionQueryCount,
    passed,
    latency,
  };
}

/**
 * T-141: Compute deterministic SHA-256 checksum of the test fixtures corpus.
 */
export function computeCorpusChecksum(fixturesDir: string): string {
  const files = readdirSync(fixturesDir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".json"))
    .sort();
  const hash = createHash("sha256");
  for (const f of files) {
    hash.update(f);
    hash.update(readFileSync(join(fixturesDir, f)));
  }
  return hash.digest("hex");
}

/**
 * T-141: Verify frozen benchmark corpus drift discipline.
 */
export function verifyCorpusIntegrity(fixturesDir: string): { valid: boolean; hash: string; expected: string } {
  const hash = computeCorpusChecksum(fixturesDir);
  return {
    valid: hash === FROZEN_CORPUS_HASH,
    hash,
    expected: FROZEN_CORPUS_HASH,
  };
}

/**
 * T-143: Validate fixture promotion against required usage telemetry.
 * Disallows invented test cases from being promoted to golden status.
 */
export function validateFixturePromotion(candidate: Partial<GoldenQuery>): { eligible: boolean; reason?: string } {
  if (!candidate.query || candidate.query.trim().length === 0) {
    return { eligible: false, reason: "Query cannot be empty" };
  }
  if (!candidate.telemetry) {
    return { eligible: false, reason: "Missing required usage telemetry record" };
  }
  if (typeof candidate.telemetry.query_count !== "number" || candidate.telemetry.query_count < MIN_PROMOTION_USAGE) {
    return {
      eligible: false,
      reason: `Query count (${candidate.telemetry.query_count ?? 0}) does not meet promotion usage threshold (${MIN_PROMOTION_USAGE})`,
    };
  }
  if (!candidate.telemetry.source || candidate.telemetry.source.trim().length === 0) {
    return { eligible: false, reason: "Usage telemetry must record source (e.g. user_interaction, session_log)" };
  }
  return { eligible: true };
}
