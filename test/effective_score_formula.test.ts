import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, list, type Store } from "../src/store.ts";
import {
  computeReinforcementMultiplier,
  computeEffectiveScore,
} from "../src/retrieval/effective_score.ts";
import {
  computeFactors,
  deriveWhyRetrieved,
} from "../src/retrieval.ts";
import {
  calculateMultiFactorScore,
  rankAndRetrieveMemories,
} from "../src/retrieval/ranking.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("T-119: effective_score = base × reinforcement × decay formula", () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-effective-score-test-"));
    store = openStore(tmpDir);
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe("computeReinforcementMultiplier", () => {
    const baseEntry: MemoryEntry = {
      id: "mem-test-1",
      title: "Test entry",
      content: "Test content details",
      type: "decision",
      status: "active",
      confidence: 0.9,
      project: "test",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    it("returns 1.0 baseline for neutral entry", () => {
      expect(computeReinforcementMultiplier(baseEntry)).toBe(1.0);
    });

    it("adds +0.05 per reinforcement up to +0.25", () => {
      expect(computeReinforcementMultiplier({ ...baseEntry, reinforcement: 2 })).toBe(1.10);
      expect(computeReinforcementMultiplier({ ...baseEntry, reinforcement: 5 })).toBe(1.25);
      expect(computeReinforcementMultiplier({ ...baseEntry, reinforcement: 10 })).toBe(1.25);
    });

    it("subtracts -0.05 per negative reinforcement", () => {
      expect(computeReinforcementMultiplier({ ...baseEntry, reinforcement: -3 })).toBe(0.85);
    });

    it("applies application utility bonus or penalty based on reuse success rate", () => {
      const highUtilityEntry: MemoryEntry = {
        ...baseEntry,
        utility: {
          retrieval_count: 5,
          application_count: 5,
          successful_applications: 4,
          failed_applications: 1,
          regressions: 0,
          contradictions: 0,
          reuse_success_rate: 0.8,
        },
      };
      expect(computeReinforcementMultiplier(highUtilityEntry)).toBe(1.20);

      const lowUtilityEntry: MemoryEntry = {
        ...baseEntry,
        utility: {
          retrieval_count: 5,
          application_count: 5,
          successful_applications: 1,
          failed_applications: 4,
          regressions: 0,
          contradictions: 0,
          reuse_success_rate: 0.2,
        },
      };
      expect(computeReinforcementMultiplier(lowUtilityEntry)).toBe(0.80);
    });

    it("clamps multiplier within bounds [0.2, 2.0]", () => {
      const hugeNegative: MemoryEntry = {
        ...baseEntry,
        reinforcement: -20,
        utility: {
          retrieval_count: 10,
          application_count: 10,
          successful_applications: 0,
          failed_applications: 10,
          regressions: 0,
          contradictions: 0,
          reuse_success_rate: 0.0,
        },
      };
      expect(computeReinforcementMultiplier(hugeNegative)).toBeGreaterThanOrEqual(0.2);
    });
  });

  describe("computeEffectiveScore formula", () => {
    it("multiplies base × reinforcement × decay correctly", () => {
      // 0.8 * 1.25 * 1.0 = 1.0
      expect(computeEffectiveScore(0.8, 1.25, 1.0)).toBe(1.0);
      // 0.8 * 1.0 * 0.5 = 0.4
      expect(computeEffectiveScore(0.8, 1.0, 0.5)).toBe(0.4);
      // 1.5 * 1.2 * 0.8 = 1.44
      expect(computeEffectiveScore(1.5, 1.2, 0.8)).toBe(1.44);
    });

    it("enforces non-negative base and minimum decay floor", () => {
      expect(computeEffectiveScore(-0.5, 1.0, 1.0)).toBe(0);
      // minimum decay floor is 0.05
      expect(computeEffectiveScore(1.0, 1.0, 0.0)).toBe(0.05);
    });
  });

  describe("computeFactors & calculateMultiFactorScore integration", () => {
    it("computes all effective score components and exports them on factors", () => {
      const entry: MemoryEntry = {
        id: "mem-eff-1",
        title: "Database connection pool",
        content: "Configure PostgreSQL connection pool limits and timeouts",
        type: "decision",
        status: "active",
        confidence: 0.95,
        project: "test",
        reinforcement: 3,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const result = calculateMultiFactorScore(entry, ["database", "connection", "pool"]);

      expect(result.factors.baseRelevanceScore).toBeDefined();
      expect(result.factors.baseRelevanceScore).toBeGreaterThan(0);
      expect(result.factors.reinforcementMultiplier).toBe(1.15);
      expect(result.factors.decayFactor).toBe(1.0); // timeless/fresh
      expect(result.factors.effectiveScore).toBeDefined();
      expect(result.effectiveScore).toBe(result.factors.effectiveScore);
      expect(result.why_retrieved).toContain("reinforcement_multiplier_boost");
    });
  });

  describe("rankAndRetrieveMemories ranking behavior", async () => {
    it("ranks reinforced memory higher when useEffectiveScore is enabled", async () => {
      // Memory A: highly reinforced memory
      const entryA = propose(store, {
        title: "Cache eviction policy",
        content: "Eviction strategy LRU for cache storage and Redis connection",
        type: "decision",
        project: "test",
        reinforcement: 5,
      });

      // Memory B: unreinforced memory
      const entryB = propose(store, {
        title: "Cache eviction strategy",
        content: "Eviction strategy LRU for cache storage and Redis connection",
        type: "decision",
        project: "test",
        reinforcement: 0,
      });

      const results = await rankAndRetrieveMemories(store, "cache eviction LRU storage Redis connection", {
        useEffectiveScore: true,
      });

      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results[0].entry.id).toBe(entryA.id);
      expect(results[0].effectiveScore).toBeGreaterThan(results[1].effectiveScore!);
      expect(results[0].why_retrieved).toContain("reinforcement_multiplier_boost");
    });
  });
});
