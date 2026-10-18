import { describe, test, expect } from "bun:test";
import {
  computeWeibullDecay,
  weibullParametersForType,
  WEIBULL_TYPE_PROFILES,
  computeDecayScore,
} from "../src/retention.ts";

describe("T-081: Optional Weibull Per-Type Decay Curves", () => {
  test("computeWeibullDecay always preserves R(halfLife) = 0.5 across all shape k values", () => {
    const halfLife = 90;

    // Test a wide spectrum of shape parameters:
    const kValues = [0.5, 0.7, 0.8, 1.0, 1.5, 1.6, 2.0, 2.5];

    for (const k of kValues) {
      const scoreAtHalfLife = computeWeibullDecay(halfLife, halfLife, k);
      expect(scoreAtHalfLife).toBe(0.5);
    }

    // At t = 0, score is 1.0
    for (const k of kValues) {
      expect(computeWeibullDecay(0, halfLife, k)).toBe(1.0);
    }
  });

  test("computeWeibullDecay with k = 1.0 matches exponential decay identically", () => {
    const halfLife = 60;
    const daysList = [5, 15, 30, 45, 60, 90, 120];

    for (const days of daysList) {
      const weibullScore = computeWeibullDecay(days, halfLife, 1.0);
      const exponentialScore = Number(Math.exp((-Math.LN2 * days) / halfLife).toFixed(4));
      expect(weibullScore).toBe(exponentialScore);
    }
  });

  test("weibullParametersForType provides domain-calibrated k per memory type", () => {
    expect(WEIBULL_TYPE_PROFILES.architecture.k).toBe(0.7);
    expect(WEIBULL_TYPE_PROFILES.adr.k).toBe(0.7);
    expect(WEIBULL_TYPE_PROFILES.fix.k).toBe(1.6);
    expect(WEIBULL_TYPE_PROFILES.discovery.k).toBe(1.5);
    expect(WEIBULL_TYPE_PROFILES.operation.k).toBe(1.0);

    expect(weibullParametersForType("architecture").k).toBe(0.7);
    expect(weibullParametersForType("fix").k).toBe(1.6);
    expect(weibullParametersForType("unknown_custom").k).toBe(1.0);
  });

  test("wear-out cliff curves (k > 1) plateau early then decay rapidly past half-life", () => {
    const halfLife = 100;
    const k = 1.6; // fix profile

    const earlyDays = 30; // before half-life
    const lateDays = 180; // well past half-life

    const weibullEarly = computeWeibullDecay(earlyDays, halfLife, k);
    const exponentialEarly = Number(Math.exp((-Math.LN2 * earlyDays) / halfLife).toFixed(4));

    // Freshness plateau: retention is higher before half-life
    expect(weibullEarly).toBeGreaterThan(exponentialEarly);

    const weibullLate = computeWeibullDecay(lateDays, halfLife, k);
    const exponentialLate = Number(Math.exp((-Math.LN2 * lateDays) / halfLife).toFixed(4));

    // Obsolescence cliff: retention drops faster after half-life
    expect(weibullLate).toBeLessThan(exponentialLate);
  });

  test("heavy-tail durable curves (k < 1) exhibit infant mortality with long-term retention", () => {
    const halfLife = 100;
    const k = 0.7; // architecture / adr profile

    const lateDays = 250; // 2.5x half-life

    const weibullLate = computeWeibullDecay(lateDays, halfLife, k);
    const exponentialLate = Number(Math.exp((-Math.LN2 * lateDays) / halfLife).toFixed(4));

    // Heavy tail: surviving entries retain significantly higher value than exponential
    expect(weibullLate).toBeGreaterThan(exponentialLate);
  });

  test("computeDecayScore integrates optional Weibull model seamlessly", () => {
    const now = Date.now();
    const fortyDaysAgo = new Date(now - 40 * 86_400_000).toISOString();

    const entry = {
      type: "fix",
      created_at: fortyDaysAgo,
      updated_at: fortyDaysAgo,
      verification: { level: "reproducible" },
    };

    // Standard exponential
    const exponentialScore = computeDecayScore(entry, now, { decayModel: "exponential" });

    // Explicit Weibull option
    const weibullScore = computeDecayScore(entry, now, { decayModel: "weibull" });

    expect(typeof exponentialScore).toBe("number");
    expect(typeof weibullScore).toBe("number");
    // With k=1.6 at 40 days (< halfLife ~60d), Weibull retention is higher (plateau)
    expect(weibullScore).toBeGreaterThan(exponentialScore);

    // Stamped on entry
    const entryWithWeibull = {
      ...entry,
      decay_model: "weibull" as const,
    };
    const autoWeibull = computeDecayScore(entryWithWeibull, now);
    expect(autoWeibull).toBe(weibullScore);
  });
});
