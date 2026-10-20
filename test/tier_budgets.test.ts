import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, type Store } from "../src/store.ts";
import {
  TIER_BUDGET_PROVENANCE,
  TIER_0_DEFAULT_BUDGET,
  TIER_0_MAX_BUDGET,
  TIER_1_DEFAULT_BUDGET,
  TIER_1_MAX_BUDGET,
  TIER_2_DEFAULT_BUDGET,
  TIER_2_MAX_BUDGET,
  USER_PROFILE_DEFAULT_BUDGET,
  USER_PROFILE_BUDGET_RATIO,
  resolveTierBudget,
  getTierBudgetProvenance,
  queryTieredContext,
} from "../src/retrieval.ts";
import { resolveMuseContext } from "../src/orchestrator/context.ts";

describe("T-125: Tier budgets as named constants with provenance", () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-tier-budgets-test-"));
    store = openStore(tmpDir);
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe("provenance definitions", () => {
    it("defines authoritative provenance and SLA targets for all tiers", () => {
      // Tier 0
      const t0 = getTierBudgetProvenance(0);
      expect(t0.tier).toBe(0);
      expect(t0.defaultTokens).toBe(TIER_0_DEFAULT_BUDGET);
      expect(t0.maxTokens).toBe(TIER_0_MAX_BUDGET);
      expect(t0.provenance.origin).toContain("ADR-012");
      expect(t0.provenance.rationale).toBeDefined();
      expect(t0.provenance.targetSlaMs).toBe(2);

      // Tier 1
      const t1 = getTierBudgetProvenance(1);
      expect(t1.tier).toBe(1);
      expect(t1.defaultTokens).toBe(TIER_1_DEFAULT_BUDGET);
      expect(t1.maxTokens).toBe(TIER_1_MAX_BUDGET);
      expect(t1.provenance.targetSlaMs).toBe(10);

      // Tier 2
      const t2 = getTierBudgetProvenance(2);
      expect(t2.tier).toBe(2);
      expect(t2.defaultTokens).toBe(TIER_2_DEFAULT_BUDGET);
      expect(t2.maxTokens).toBe(TIER_2_MAX_BUDGET);
      expect(t2.provenance.targetSlaMs).toBe(50);

      // User profile reserved
      const up = TIER_BUDGET_PROVENANCE.USER_PROFILE_RESERVED;
      expect(up.ratio).toBe(USER_PROFILE_BUDGET_RATIO);
      expect(up.defaultTokens).toBe(USER_PROFILE_DEFAULT_BUDGET);
      expect(up.provenance.origin).toContain("T-094");
    });
  });

  describe("resolveTierBudget", () => {
    it("resolves default budget when custom budget is omitted", () => {
      expect(resolveTierBudget(0)).toBe(TIER_0_DEFAULT_BUDGET);
      expect(resolveTierBudget(1)).toBe(TIER_1_DEFAULT_BUDGET);
      expect(resolveTierBudget(2)).toBe(TIER_2_DEFAULT_BUDGET);
    });

    it("respects custom budget within max token limits", () => {
      expect(resolveTierBudget(2, 6000)).toBe(6000);
      expect(resolveTierBudget(1, 600)).toBe(600);
    });

    it("clamps custom budget exceeding maxTokens to tier limit", () => {
      expect(resolveTierBudget(0, 500)).toBe(TIER_0_MAX_BUDGET); // clamped to 200
      expect(resolveTierBudget(1, 2000)).toBe(TIER_1_MAX_BUDGET); // clamped to 1000
    });
  });

  describe("orchestrator and tiered retrieval integration", () => {
    it("uses TIER_2_DEFAULT_BUDGET when token_budget is omitted in resolveMuseContext", async () => {
      propose(store, {
        title: "Distributed Transaction Coordination Pattern",
        content: "Two-phase commit coordinator with timeout-based rollback.",
        project: "test-proj",
        type: "decision",
      });

      const res = await resolveMuseContext(store, tmpDir, {
        query: "transaction coordinator",
        project: "test-proj",
      });

      expect(res.token_budget).toBe(TIER_2_DEFAULT_BUDGET);
      expect(res.tokens_used).toBeGreaterThan(0);
      expect(res.relevant_memories.length).toBe(1);
    });

    it("allocates user profile reservation using USER_PROFILE_BUDGET_RATIO and USER_PROFILE_DEFAULT_BUDGET", async () => {
      // Seed a global project entry to trigger reservation
      propose(store, {
        title: "Global Coding Standard",
        content: "Always write typed code.",
        project: "global",
        type: "constraint",
      });

      const res = await resolveMuseContext(store, tmpDir, {
        query: "coding standard",
        token_budget: 1000,
      });

      // 1000 * 0.20 = 200, bounded by 400
      expect(res.user_profile_reserved_tokens).toBe(200);
    });

    it("executes queryTieredContext with Tier 0 ultra-compact output", () => {
      propose(store, {
        title: "Redis Caching Invariant",
        content: "Cache TTL must be under 3600 seconds.",
        project: "test-proj",
        type: "decision",
      });

      const res = queryTieredContext(store, tmpDir, "Redis caching", { tier: 0 });
      expect(res.markdown).toContain("### Memory Manifest (Tier 0)");
      expect(res.totalTokensUsed).toBeLessThanOrEqual(TIER_0_MAX_BUDGET);
    });
  });
});
