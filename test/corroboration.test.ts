import { describe, it, expect } from "bun:test";
import {
  computeBayesianConfidence,
  evaluateCorroboration,
  DEFAULT_CORROBORATION_DISCOUNT,
} from "../src/quality/corroboration.ts";
import { checkCorroboration } from "../src/promotion/engine.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("T-076: Bayesian confidence 1 - 0.7^n per corroboration", () => {
  it("computes accurate Bayesian confidence across corroboration steps", () => {
    expect(computeBayesianConfidence(0)).toBe(0);
    expect(computeBayesianConfidence(1)).toBe(0.3); // 1 - 0.7^1 = 0.3
    expect(computeBayesianConfidence(2)).toBe(0.51); // 1 - 0.7^2 = 0.51
    expect(computeBayesianConfidence(3)).toBe(0.657); // 1 - 0.7^3 = 0.657
    expect(computeBayesianConfidence(4)).toBe(0.7599); // 1 - 0.7^4 = 0.7599
    expect(computeBayesianConfidence(5)).toBe(0.8319); // 1 - 0.7^5 = 0.8319

    // Asymptotic bound: large n approaches 1.0 and never exceeds 1.0
    const highConfidence = computeBayesianConfidence(25);
    expect(highConfidence).toBeGreaterThan(0.999);
    expect(highConfidence).toBeLessThanOrEqual(1.0);

    // Negative, zero, or non-finite inputs return 0
    expect(computeBayesianConfidence(-3)).toBe(0);
    expect(computeBayesianConfidence(NaN)).toBe(0);
    expect(computeBayesianConfidence(Infinity)).toBe(0);
  });

  it("supports custom prior discount factors", () => {
    // With discount = 0.5, each corroboration halves uncertainty: 1 - 0.5^1 = 0.5, 1 - 0.5^2 = 0.75
    expect(computeBayesianConfidence(1, 0.5)).toBe(0.5);
    expect(computeBayesianConfidence(2, 0.5)).toBe(0.75);
    expect(computeBayesianConfidence(3, 0.5)).toBe(0.875);
  });

  it("evaluates memory corroboration and derives Bayesian confidence", () => {
    // 1. Synthetic uncorroborated candidate
    const syntheticEntry: MemoryEntry = {
      id: "mem_synth",
      title: "Generated Note",
      content: "Auto-extracted summary.",
      project: "billing",
      status: "candidate",
      source: "agent",
      type: "discovery",
      created_at: "2026-03-01T10:00:00.000Z",
      updated_at: "2026-03-01T10:00:00.000Z",
    };

    const synthEval = evaluateCorroboration(syntheticEntry);
    expect(synthEval.n).toBe(0);
    expect(synthEval.confidence).toBe(0);
    expect(synthEval.isCorroborated).toBe(false);

    // 2. Multi-day corroborated entry with independent evidence and user confirmation
    const corroboratedEntry: MemoryEntry = {
      id: "mem_corroborated",
      title: "PostgreSQL Deadlock Invariant",
      content: "Acquire locks in alphabetical order by table name to prevent deadlocks.",
      project: "database",
      status: "confirmed",
      source: "engineer",
      type: "constraint",
      created_at: "2026-03-01T10:00:00.000Z",
      last_confirmed_at: "2026-03-05T12:00:00.000Z",
      updated_at: "2026-03-05T12:00:00.000Z",
      verification: { level: "user-confirmed", verified_at: "2026-03-05T12:00:00.000Z" },
      reinforcement: 2,
      evidence: [
        {
          id: "ev1",
          type: "code",
          source: "src/db/pool.ts",
          timestamp: "2026-03-03T15:00:00.000Z",
        },
        {
          id: "ev2",
          type: "test",
          source: "test/deadlock.test.ts",
          timestamp: "2026-03-05T09:00:00.000Z",
        },
      ],
    };

    const corrEval = evaluateCorroboration(corroboratedEntry);
    expect(corrEval.n).toBeGreaterThanOrEqual(4);
    expect(corrEval.confidence).toBeGreaterThanOrEqual(0.7599); // >= 1 - 0.7^4
    expect(corrEval.isCorroborated).toBe(true);
    expect(corrEval.reasons.length).toBeGreaterThan(0);
  });

  it("surfaces confidence on checkCorroboration in promotion engine", () => {
    const entry: MemoryEntry = {
      id: "mem_promo",
      title: "Idempotent Retry Policy",
      content: "Use exponential backoff with full jitter.",
      project: "network",
      status: "confirmed",
      source: "dev-ops",
      type: "operation",
      created_at: "2026-02-10T10:00:00.000Z",
      last_confirmed_at: "2026-02-15T10:00:00.000Z",
      updated_at: "2026-02-15T10:00:00.000Z",
      verification: { level: "authoritative" },
    };

    const res = checkCorroboration(entry);
    expect(res.corroborated).toBe(true);
    expect(typeof res.confidence).toBe("number");
    expect(res.confidence).toBeGreaterThan(0);
    expect(typeof res.corroborationCount).toBe("number");
  });
});
