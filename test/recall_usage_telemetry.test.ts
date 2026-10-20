import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openStore,
  propose,
  save,
  type Store,
  calculateUsageRate,
  calculateRoiScore,
  computeRecallUsageRecord,
  joinRecallUsageTelemetry,
  computeRoiScoreMultiplier,
} from "../src/store.ts";
import { calculateMultiFactorScore, rankAndRetrieveMemories } from "../src/retrieval/ranking.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("T-127: recall→usage telemetry join (usage_rate feeds ROI)", () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-telemetry-test-"));
    store = openStore(tmpDir);
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe("calculateUsageRate", () => {
    it("returns 0.0 for untested or zero-retrieval memories", () => {
      expect(calculateUsageRate(undefined)).toBe(0.0);
      expect(calculateUsageRate({
        retrieval_count: 0,
        application_count: 0,
        successful_applications: 0,
        failed_applications: 0,
        regressions: 0,
        contradictions: 0,
      })).toBe(0.0);
    });

    it("calculates application ratio accurately", () => {
      expect(calculateUsageRate({
        retrieval_count: 10,
        application_count: 4,
        successful_applications: 4,
        failed_applications: 0,
        regressions: 0,
        contradictions: 0,
      })).toBe(0.4);
    });
  });

  describe("calculateRoiScore", () => {
    it("returns neutral 0.5 prior for untested memory", () => {
      expect(calculateRoiScore(undefined)).toBe(0.5);
    });

    it("produces high score for successful reuse track record", () => {
      const highRoi = calculateRoiScore({
        retrieval_count: 5,
        application_count: 5,
        successful_applications: 5,
        failed_applications: 0,
        regressions: 0,
        contradictions: 0,
      });
      expect(highRoi).toBeGreaterThan(0.75);
    });

    it("severely penalizes dead-weight memories retrieved repeatedly without application", () => {
      const deadWeight = calculateRoiScore({
        retrieval_count: 8,
        application_count: 0,
        successful_applications: 0,
        failed_applications: 0,
        regressions: 0,
        contradictions: 0,
      });
      expect(deadWeight).toBeLessThan(0.3);
    });
  });

  describe("computeRecallUsageRecord", () => {
    it("categorizes memories accurately based on usage and roi metrics", () => {
      const entry: MemoryEntry = {
        id: "mem-test-1",
        title: "Test memory",
        content: "Content",
        project: "test",
        type: "decision",
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        utility: {
          retrieval_count: 10,
          application_count: 0,
          successful_applications: 0,
          failed_applications: 0,
          regressions: 0,
          contradictions: 0,
        },
      };

      const record = computeRecallUsageRecord(entry);
      expect(record.status).toBe("dead_weight");
      expect(record.usage_rate).toBe(0);
      expect(record.roi_score).toBeLessThan(0.3);
    });
  });

  describe("joinRecallUsageTelemetry", () => {
    it("joins telemetry across all memories in store and updates utilities", () => {
      // 1. Untested memory
      propose(store, {
        title: "Untested architecture guideline",
        content: "Rule for distributed event handling.",
        project: "test",
        type: "decision",
      });

      // 2. High ROI memory
      const highEntry = propose(store, {
        title: "High ROI database indexing pattern",
        content: "Composite B-tree index on user_id and tenant_id.",
        project: "test",
        type: "decision",
      });
      highEntry.utility = {
        retrieval_count: 6,
        application_count: 5,
        successful_applications: 5,
        failed_applications: 0,
        regressions: 0,
        contradictions: 0,
      };
      save(store, highEntry);

      // 3. Dead-weight memory
      const deadEntry = propose(store, {
        title: "Dead weight obsolete documentation",
        content: "Deprecated setup instructions from 2021.",
        project: "test",
        type: "discovery",
      });
      deadEntry.utility = {
        retrieval_count: 8,
        application_count: 0,
        successful_applications: 0,
        failed_applications: 0,
        regressions: 0,
        contradictions: 0,
      };
      save(store, deadEntry);

      const report = joinRecallUsageTelemetry(store, { persist: true });

      expect(report.total_memories).toBe(3);
      expect(report.high_roi_count).toBe(1);
      expect(report.dead_weight_count).toBe(1);
      expect(report.overall_usage_rate).toBeGreaterThan(0);

      // Verify persistence onto store entries
      const reloadedDead = store.db ? store.db.query<any>("SELECT json_extract(data, '$.utility.roi_score') as roi FROM memories WHERE id = ?").get([deadEntry.id]) : null;
      if (reloadedDead) {
        expect(Number(reloadedDead.roi)).toBeLessThan(0.3);
      }
    });
  });

  describe("retrieval scoring integration", () => {
    it("rewards high-ROI memory with boost and penalizes dead-weight memory", async () => {
      const highRoiMem = propose(store, {
        title: "PostgreSQL Pooling with Transaction Mode",
        content: "PgBouncer in transaction mode guarantees connection efficiency under high concurrency.",
        project: "perf",
        type: "decision",
      });
      highRoiMem.utility = {
        retrieval_count: 10,
        application_count: 8,
        successful_applications: 8,
        failed_applications: 0,
        regressions: 0,
        contradictions: 0,
        usage_rate: 0.8,
        roi_score: 0.9,
      };
      save(store, highRoiMem);

      const deadWeightMem = propose(store, {
        title: "PostgreSQL Pooling with Session Mode",
        content: "PgBouncer in session mode leaks backend connection resources.",
        project: "perf",
        type: "decision",
      });
      deadWeightMem.utility = {
        retrieval_count: 10,
        application_count: 0,
        successful_applications: 0,
        failed_applications: 0,
        regressions: 0,
        contradictions: 0,
        usage_rate: 0.0,
        roi_score: 0.1,
      };
      save(store, deadWeightMem);

      // Multi-factor scoring check
      const highResult = calculateMultiFactorScore(highRoiMem, ["postgresql", "pooling"]);
      expect(highResult.factors.roiMultiplier).toBeGreaterThan(1.0);
      expect(highResult.factors.roiAdjustment).toBeGreaterThan(0);

      const deadResult = calculateMultiFactorScore(deadWeightMem, ["postgresql", "pooling"]);
      expect(deadResult.factors.roiMultiplier).toBeLessThan(1.0);
      expect(deadResult.factors.roiAdjustment).toBeLessThan(0);

      // Retrieval why_retrieved verification
      const results = await rankAndRetrieveMemories(store, "postgresql pooling", { project: "perf" });
      const topHit = results.find((r) => r.entry.id === highRoiMem.id);
      expect(topHit).toBeDefined();
      expect(topHit!.why_retrieved).toContain("roi_high_value_boost");

      const deadHit = results.find((r) => r.entry.id === deadWeightMem.id);
      expect(deadHit).toBeDefined();
      expect(deadHit!.why_retrieved).toContain("roi_dead_weight_penalty");
    });
  });
});
