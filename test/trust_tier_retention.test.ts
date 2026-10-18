import { describe, test, expect } from "bun:test";
import {
  TRUST_TIER_HALF_LIVES,
  trustTierHalfLife,
  computeHalfLife,
  computeDecayScore,
  computeStaleness,
  stalenessDaysRemaining,
} from "../src/retention.ts";

describe("T-077: Trust-Tier-Keyed Half-Life (T1 365d → T4 30d)", () => {
  test("TRUST_TIER_HALF_LIVES defines base days across tiers and aliases", () => {
    expect(TRUST_TIER_HALF_LIVES["T1"]).toBe(365);
    expect(TRUST_TIER_HALF_LIVES["trusted"]).toBe(365);
    expect(TRUST_TIER_HALF_LIVES["T2"]).toBe(180);
    expect(TRUST_TIER_HALF_LIVES["verified"]).toBe(180);
    expect(TRUST_TIER_HALF_LIVES["T3"]).toBe(90);
    expect(TRUST_TIER_HALF_LIVES["candidate"]).toBe(90);
    expect(TRUST_TIER_HALF_LIVES["T4"]).toBe(30);
    expect(TRUST_TIER_HALF_LIVES["untrusted"]).toBe(30);

    expect(trustTierHalfLife("T1")).toBe(365);
    expect(trustTierHalfLife("t1")).toBe(365);
    expect(trustTierHalfLife("trusted")).toBe(365);
    expect(trustTierHalfLife("T4")).toBe(30);
    expect(trustTierHalfLife("untrusted")).toBe(30);
    expect(trustTierHalfLife(undefined)).toBeUndefined();
  });

  test("computeHalfLife keys half-life off trust tiers for default base types", () => {
    // Default base is 90 days. With reproducible (multiplier 1.0) and 0 accesses:
    const t1 = computeHalfLife(undefined, {
      accessCount: 0,
      verificationLevel: "reproducible",
      trust: "T1",
    });
    expect(t1).toBe(365);

    const t2 = computeHalfLife(undefined, {
      accessCount: 0,
      verificationLevel: "reproducible",
      trust: "T2",
    });
    expect(t2).toBe(180);

    const t3 = computeHalfLife(undefined, {
      accessCount: 0,
      verificationLevel: "reproducible",
      trust: "T3",
    });
    expect(t3).toBe(90);

    const t4 = computeHalfLife(undefined, {
      accessCount: 0,
      verificationLevel: "reproducible",
      trust: "T4",
    });
    expect(t4).toBe(30);
  });

  test("computeHalfLife supports named trust tiers (trusted, candidate, untrusted)", () => {
    const trusted = computeHalfLife(undefined, {
      accessCount: 0,
      verificationLevel: "reproducible",
      trust: "trusted",
    });
    expect(trusted).toBe(365);

    const candidate = computeHalfLife(undefined, {
      accessCount: 0,
      verificationLevel: "reproducible",
      trust: "candidate",
    });
    expect(candidate).toBe(90);

    const untrusted = computeHalfLife(undefined, {
      accessCount: 0,
      verificationLevel: "reproducible",
      trust: "untrusted",
    });
    expect(untrusted).toBe(30);
  });

  test("computeHalfLife scales typed memory half-life by trust tier", () => {
    // "fix" has base half-life of 120 days.
    // Unverified has multiplier 0.5 (standard 60 days).
    const standardFix = computeHalfLife("fix", {
      accessCount: 0,
      verificationLevel: "unverified",
    });
    expect(standardFix).toBe(60);

    // Untrusted (T4) fix: base scales down by 30/90 (1/3) -> 40 days * 0.5 = 20 days
    const untrustedFix = computeHalfLife("fix", {
      accessCount: 0,
      verificationLevel: "unverified",
      trust: "untrusted",
    });
    expect(untrustedFix).toBe(20);

    // Trusted (T1) fix: base scales up by 365/90 (~4.055) -> 487 days * 0.5 = 243 days
    const trustedFix = computeHalfLife("fix", {
      accessCount: 0,
      verificationLevel: "unverified",
      trust: "trusted",
    });
    expect(trustedFix).toBe(243);
  });

  test("computeDecayScore reflects trust-tier accelerated decay for untrusted sources", () => {
    const now = Date.now();
    const thirtyDaysAgo = new Date(now - 30 * 86_400_000).toISOString();

    const trustedEntry = {
      type: "fix",
      created_at: thirtyDaysAgo,
      updated_at: thirtyDaysAgo,
      verification: { level: "reproducible" },
      trust: "trusted",
    };

    const untrustedEntry = {
      type: "fix",
      created_at: thirtyDaysAgo,
      updated_at: thirtyDaysAgo,
      verification: { level: "reproducible" },
      trust: "untrusted",
    };

    const trustedScore = computeDecayScore(trustedEntry, now);
    const untrustedScore = computeDecayScore(untrustedEntry, now);

    // Untrusted fix half-life is 120 * (30/90) = 40 days, so after 30 days decay is significant
    // Trusted fix half-life is 120 * (365/90) = 487 days, so after 30 days decay is minimal
    expect(trustedScore).toBeGreaterThan(untrustedScore);
    expect(trustedScore).toBeGreaterThan(0.9);
    expect(untrustedScore).toBeLessThan(0.65);
  });

  test("computeStaleness and stalenessDaysRemaining reflect trust tiers", () => {
    const now = Date.now();
    const fortyDaysAgo = new Date(now - 40 * 86_400_000).toISOString();

    const trustedEntry = {
      type: "operation",
      created_at: fortyDaysAgo,
      updated_at: fortyDaysAgo,
      verification: { level: "reproducible" },
      trust: "trusted",
    };

    const untrustedEntry = {
      type: "operation",
      created_at: fortyDaysAgo,
      updated_at: fortyDaysAgo,
      verification: { level: "reproducible" },
      trust: "untrusted",
    };

    const trustedStaleness = computeStaleness(trustedEntry, now);
    const untrustedStaleness = computeStaleness(untrustedEntry, now);

    expect(untrustedStaleness).toBeGreaterThan(trustedStaleness);

    const trustedRemaining = stalenessDaysRemaining(trustedEntry, now);
    const untrustedRemaining = stalenessDaysRemaining(untrustedEntry, now);

    expect(trustedRemaining).toBeGreaterThan(untrustedRemaining);
  });
});
