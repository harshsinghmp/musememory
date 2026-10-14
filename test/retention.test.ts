import { test, describe, expect } from "bun:test";
import {
  computeHalfLife,
  computeStaleness,
  isStale,
  defaultHalfLifeDays,
  stalePolicyDays,
  stalenessDaysRemaining,
  DECAY_POLICIES,
  DEFAULT_HALF_LIFE_DAYS,
  DEFAULT_STALENESS_THRESHOLD,
  VERIFICATION_STABILITY,
} from "../src/retention.ts";
import { stalePolicyDays as retrievalStalePolicyDays } from "../src/retrieval.ts";
import { DEFAULT_STALE_DAYS } from "../src/types.ts";

describe("defaultHalfLifeDays", () => {
  test("returns type-specific half-lives", () => {
    expect(defaultHalfLifeDays("fix")).toBe(120);
    expect(defaultHalfLifeDays("architecture")).toBe(365);
    expect(defaultHalfLifeDays("discovery")).toBe(45);
    expect(defaultHalfLifeDays("adr")).toBe(365);
    expect(defaultHalfLifeDays("constraint")).toBe(365);
    expect(defaultHalfLifeDays("negative")).toBe(180);
  });

  test("preference types never decay", () => {
    expect(defaultHalfLifeDays("preference")).toBe(null);
  });

  test("unknown types use default", () => {
    expect(defaultHalfLifeDays("unknown")).toBe(90);
    expect(defaultHalfLifeDays(undefined)).toBe(90);
  });
});

describe("computeHalfLife", () => {
  test("base half-life with no access", () => {
    const hl = computeHalfLife("fix", { accessCount: 0, verificationLevel: "unverified" });
    expect(hl).toBe(60); // 120 * 0.5
  });

  test("access frequency extends half-life (A15)", () => {
    const base = computeHalfLife("discovery", { accessCount: 0, verificationLevel: "unverified" }) ?? 0;
    const withAccess = computeHalfLife("discovery", { accessCount: 16, verificationLevel: "unverified" });
    expect(withAccess!).toBeGreaterThan(base! ?? 0);
  });

  test("access extension has diminishing returns and caps at 30", () => {
    const low = computeHalfLife("fix", { accessCount: 1, verificationLevel: "unverified" });
    const high = computeHalfLife("fix", { accessCount: 10000, verificationLevel: "unverified" });
    const accessDiff = high! - low!;
    expect(accessDiff).toBeLessThanOrEqual(30);
  });

  test("higher verification level gives longer half-life (A18)", () => {
    const unverified = computeHalfLife("discovery", { accessCount: 0, verificationLevel: "unverified" }) ?? 0;
    const verified = computeHalfLife("discovery", { accessCount: 0, verificationLevel: "independently-verified" }) ?? 0;
    expect(verified!).toBeGreaterThan(unverified!);
  });

  test("reinforcement boosts half-life", () => {
    const base = computeHalfLife("fix", { accessCount: 0, verificationLevel: "unverified", reinforcement: 0 }) ?? 0;
    const boosted = computeHalfLife("fix", { accessCount: 0, verificationLevel: "unverified", reinforcement: 5 }) ?? 0;
    expect(boosted).toBeGreaterThan(base);
  });

  test("preference type returns null (never decays)", () => {
    const hl = computeHalfLife("preference", { accessCount: 5, verificationLevel: "verified" });
    expect(hl).toBe(null);
  });
});

describe("computeStaleness", () => {
  test("fresh entry has low staleness", () => {
    const entry = {
      type: "fix",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(computeStaleness(entry)).toBeLessThan(0.1);
  });

  test("old entry has high staleness", () => {
    const entry = {
      type: "fix",
      created_at: new Date(Date.now() - 400 * 86_400_000).toISOString(), // 400 days ago
      updated_at: new Date(Date.now() - 400 * 86_400_000).toISOString(),
    };
    expect(computeStaleness(entry)).toBeGreaterThan(0.7);
  });

  test("preference type never becomes stale", () => {
    const entry = {
      type: "preference",
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    };
    expect(computeStaleness(entry)).toBe(0);
  });

  test("uses last_accessed_at when available", () => {
    const entry = {
      type: "discovery",
      created_at: new Date(Date.now() - 200 * 86_400_000).toISOString(), // old creation
      updated_at: new Date(Date.now() - 200 * 86_400_000).toISOString(),
      last_accessed_at: new Date().toISOString(), // but recently accessed
      access_count: 10,
    };
    const staleness = computeStaleness(entry);
    expect(staleness).toBeLessThan(0.3);
  });
});

describe("isStale", () => {
  test("returns true for old entries", () => {
    const entry = {
      type: "fix",
      created_at: new Date(Date.now() - 400 * 86_400_000).toISOString(),
      updated_at: new Date(Date.now() - 400 * 86_400_000).toISOString(),
    };
    expect(isStale(entry)).toBe(true);
  });

  test("returns false for fresh entries", () => {
    const entry = {
      type: "fix",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(isStale(entry)).toBe(false);
  });

  test("respects custom threshold", () => {
    const entry = {
      type: "discovery",
      created_at: new Date(Date.now() - 80 * 86_400_000).toISOString(),
      updated_at: new Date(Date.now() - 80 * 86_400_180_000).toISOString(),
    };
    expect(isStale(entry, Date.now(), 0.5)).toBe(true);
    expect(isStale(entry, Date.now(), 0.99)).toBe(false);
  });
});

describe("stalenessDaysRemaining", () => {
  test("returns Infinity for preference type", () => {
    const entry = {
      type: "preference",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(stalenessDaysRemaining(entry)).toBe(Infinity);
  });

  test("returns positive days for fresh entry", () => {
    const entry = {
      type: "fix",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const days = stalenessDaysRemaining(entry);
    expect(days).toBeGreaterThan(0);
  });

  test("returns negative for already-stale entry", () => {
    const entry = {
      type: "fix",
      created_at: new Date(Date.now() - 400 * 86_400_000).toISOString(),
      updated_at: new Date(Date.now() - 400 * 86_400_000).toISOString(),
    };
    const days = stalenessDaysRemaining(entry);
    expect(days).toBeLessThan(0);
  });
});

describe("VERIFICATION_STABILITY", () => {
  test("contains all expected levels", () => {
    expect(VERIFICATION_STABILITY["unverified"]).toBe(0.5);
    expect(VERIFICATION_STABILITY["observed"]).toBe(0.8);
    expect(VERIFICATION_STABILITY["reproducible"]).toBe(1.0);
    expect(VERIFICATION_STABILITY["user-confirmed"]).toBe(1.2);
    expect(VERIFICATION_STABILITY["authoritative"]).toBe(1.5);
    expect(VERIFICATION_STABILITY["independently-verified"]).toBe(2.0);
  });
});

describe("decay policy single source of truth (drift guard)", () => {
  test("retrieval.ts re-exports the same function, not a second table", () => {
    expect(retrievalStalePolicyDays).toBe(stalePolicyDays);
  });

  test("stalePolicyDays serves legacy TTL values from DECAY_POLICIES", () => {
    expect(stalePolicyDays("fix")).toBe(90);
    expect(stalePolicyDays("operation")).toBe(180);
    expect(stalePolicyDays("architecture")).toBe(365);
    expect(stalePolicyDays("discovery")).toBe(30);
    expect(stalePolicyDays("preference")).toBeNull();
  });

  test("unlisted types fall back to the shared defaults", () => {
    expect(stalePolicyDays("not-a-real-type")).toBe(DEFAULT_STALE_DAYS);
    expect(stalePolicyDays(undefined)).toBe(DEFAULT_STALE_DAYS);
    expect(defaultHalfLifeDays("not-a-real-type")).toBe(DEFAULT_HALF_LIFE_DAYS);
  });

  test("both accessors agree with the table for every listed type", () => {
    for (const [type, policy] of Object.entries(DECAY_POLICIES)) {
      expect(defaultHalfLifeDays(type)).toBe(policy.half_life_days);
      expect(stalePolicyDays(type)).toBe(policy.stale_after_days);
    }
  });

  test("halflife and TTL are independent horizons, never silently coupled", () => {
    // fix: soft decay outlives the hard TTL. If a future edit collapses these
    // into one number, `memory stale` and `memory blame` start contradicting.
    expect(DECAY_POLICIES.fix.half_life_days).not.toBe(DECAY_POLICIES.fix.stale_after_days);
    expect(DECAY_POLICIES.discovery.half_life_days).not.toBe(DECAY_POLICIES.discovery.stale_after_days);
  });

  test("isStale defaults to the shared threshold constant", () => {
    // Build entries whose staleness straddles the threshold, then assert the
    // no-arg default agrees with the constant on both sides of the boundary.
    const now = Date.now();
    const at = (staleness: number) => {
      const halfLife = computeHalfLife("fix", { accessCount: 0, verificationLevel: "unverified" })!;
      const days = -halfLife * Math.log(1 - staleness);
      const iso = new Date(now - days * 86_400_000).toISOString();
      return { type: "fix", created_at: iso, updated_at: iso };
    };

    const justUnder = at(DEFAULT_STALENESS_THRESHOLD - 0.01);
    const justOver = at(DEFAULT_STALENESS_THRESHOLD + 0.01);

    expect(isStale(justUnder, now)).toBe(false);
    expect(isStale(justOver, now)).toBe(true);
    // Explicit threshold must match the implicit default.
    expect(isStale(justUnder, now, DEFAULT_STALENESS_THRESHOLD)).toBe(false);
    expect(isStale(justOver, now, DEFAULT_STALENESS_THRESHOLD)).toBe(true);
  });
});
