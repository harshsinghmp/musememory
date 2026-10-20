import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { openStore } from "../src/store.ts";
import {
  gradeRecallSet,
  verifyCorpusIntegrity,
  validateFixturePromotion,
  RECALL5_FLOOR,
  P50_BUDGET_MS,
  P95_BUDGET_MS,
  P99_BUDGET_MS,
  MIN_PROMOTION_USAGE,
  type GoldenQuery,
} from "../src/quality/eval.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";

/**
 * R27 & Wave 6: recall quality gate & eval harness.
 * T-140: Recall-set grading (must-return, must-not-return, abstention, noise-as-failure).
 * T-141: Frozen benchmark corpus drift discipline.
 * T-142: p50/p95/p99 latency reported beside recall scores.
 * T-143: Fixture promotion requires usage telemetry.
 */
describe("recall eval harness (R27 & Wave 6: T-140, T-141, T-142, T-143)", () => {
  test("T-140 & T-142: golden fixture recall@5 meets floor, discriminates distractors, and measures latency", () => {
    const { root, memoryDir } = setupFixtureRoot();
    try {
      const store = openStore(memoryDir);
      const fixture = require("./fixtures/recall-golden.json") as { queries: GoldenQuery[] };

      const result = gradeRecallSet(store, fixture.queries, {
        k: 5,
        recallFloor: RECALL5_FLOOR,
        distractorTolerance: 10,
        p50BudgetMs: P50_BUDGET_MS,
      });

      console.log(
        `[recall-eval] queries=${result.totalQueries} recall@5=${result.recallAtK.toFixed(3)} ` +
          `floor=${RECALL5_FLOOR} distractor_violations=${result.distractorViolations} ` +
          `abstention_acc=${(result.abstentionAccuracy * 100).toFixed(1)}% ` +
          `p50=${result.latency.p50}ms (budget ${P50_BUDGET_MS}ms) ` +
          `p95=${result.latency.p95}ms (budget ${P95_BUDGET_MS}ms) ` +
          `p99=${result.latency.p99}ms (budget ${P99_BUDGET_MS}ms)`,
      );

      // Must meet recall@5 floor
      expect(result.recallAtK).toBeGreaterThanOrEqual(RECALL5_FLOOR);

      // Distractor violations must not regress beyond baseline tolerance
      expect(result.distractorViolations).toBeLessThanOrEqual(10);

      // Abstention queries must correctly reject irrelevant distractors (zero noise)
      expect(result.totalAbstentionQueries).toBeGreaterThan(0);
      expect(result.abstentionAccuracy).toBe(1.0);

      // Latency budgets must be respected
      expect(result.latency.p50).toBeLessThanOrEqual(P50_BUDGET_MS);
      expect(result.latency.p95).toBeLessThanOrEqual(P95_BUDGET_MS);
      expect(result.latency.p99).toBeLessThanOrEqual(P99_BUDGET_MS);

      expect(result.passed).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  test("T-141: frozen benchmark corpus integrity passes drift discipline", () => {
    const fixturesDir = join(import.meta.dir, "fixtures");
    const check = verifyCorpusIntegrity(fixturesDir);

    expect(check.valid).toBe(true);
    expect(check.hash).toBe(check.expected);
  });

  test("T-143: fixture promotion enforces usage telemetry validation", () => {
    // 1. Rejects missing telemetry
    const untelemetried = validateFixturePromotion({
      query: "invented synthetic test query",
      relevant: ["m_1"],
      distractors: [],
    });
    expect(untelemetried.eligible).toBe(false);
    expect(untelemetried.reason).toContain("telemetry");

    // 2. Rejects sub-threshold usage frequency
    const underused = validateFixturePromotion({
      query: "rare single-use test query",
      relevant: ["m_1"],
      distractors: [],
      telemetry: {
        query_count: MIN_PROMOTION_USAGE - 1,
        source: "agent_session",
      },
    });
    expect(underused.eligible).toBe(false);
    expect(underused.reason).toContain("promotion usage threshold");

    // 3. Rejects missing source
    const missingSource = validateFixturePromotion({
      query: "frequent query with missing provenance",
      relevant: ["m_1"],
      distractors: [],
      telemetry: {
        query_count: 10,
        source: "",
      },
    });
    expect(missingSource.eligible).toBe(false);
    expect(missingSource.reason).toContain("source");

    // 4. Accepts valid query with sufficient usage telemetry
    const validCandidate = validateFixturePromotion({
      query: "production recurring issue with connection limits",
      relevant: ["m_1700000000000_pool"],
      distractors: ["m_1700000001000_auth"],
      telemetry: {
        query_count: 15,
        source: "production_audit_log",
        last_seen_at: new Date().toISOString(),
      },
    });
    expect(validCandidate.eligible).toBe(true);
    expect(validCandidate.reason).toBeUndefined();
  });
});
