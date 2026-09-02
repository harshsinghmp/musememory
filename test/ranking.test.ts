import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, confirm } from "../src/store.ts";
import {
  calculateMultiFactorScore,
  rankAndRetrieveMemories,
} from "../src/retrieval/ranking.ts";
import { recordNegativeLesson } from "../src/learning/negative.ts";
import { recordApplicationOutcome } from "../src/quality/utility.ts";

describe("R5 Multi-Factor Ranking Engine", () => {
  let testDir: string;
  let memoryDir: string;
  let store: ReturnType<typeof openStore>;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "musememory-ranking-test-"));
    memoryDir = join(testDir, ".memory");
    store = openStore(memoryDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("Scoring Dimension Unit Tests", () => {
    it("awards +1.0 for exact symbol match", () => {
      const entry = propose(store, {
        title: "OrderProcessor Concurrency Handling",
        content: "The `OrderProcessor` acquires a distributed Redis lock before mutating state.",
        project: "orders",
        tags: ["OrderProcessor", "concurrency"],
        confirmed: true,
      });

      const res = calculateMultiFactorScore(entry, ["OrderProcessor"]);
      expect(res.factors.exactSymbolMatch).toBe(1.0);
      expect(res.score).toBeGreaterThan(1.0);
    });

    it("awards +0.4 for path/directory match", () => {
      const entry = propose(store, {
        title: "Database Migration Guide",
        content: "Run knex migrate:latest from database module.",
        project: "core",
        confirmed: true,
        evidence: [
          {
            id: "ev1",
            type: "code",
            source: "src/database/knexfile.ts",
            timestamp: new Date().toISOString(),
          },
        ],
      });

      const res = calculateMultiFactorScore(entry, ["migration"], {
        activeFilePath: "src/database/knexfile.ts",
      });
      expect(res.factors.pathMatch).toBe(0.4);
    });

    it("applies recency decay for standard memories but keeps timeless constraints immune", () => {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

      // 1. Standard memory untouched for 90 days
      const standard = propose(store, {
        title: "Old Operational Note",
        content: "Temporary workaround for Node 18 build.",
        project: "ops",
        confirmed: true,
      });
      standard.updated_at = ninetyDaysAgo;
      standard.valid_from = ninetyDaysAgo;

      const standardScore = calculateMultiFactorScore(standard, ["build"]);
      expect(standardScore.factors.recencyDecay).toBeLessThanOrEqual(-0.15); // -0.05 * 3

      // 2. Timeless Constraint untouched for 90 days
      const timeless = propose(store, {
        title: "Secret Invariant",
        content: "Never log raw authentication tokens.",
        project: "security",
        type: "constraint",
        temporal_mode: "timeless",
        confirmed: true,
      });
      timeless.updated_at = ninetyDaysAgo;
      timeless.valid_from = ninetyDaysAgo;

      const timelessScore = calculateMultiFactorScore(timeless, ["tokens"]);
      expect(timelessScore.factors.recencyDecay).toBe(0);
      expect(timelessScore.factors.timelessBoost).toBe(0.2);
    });

    it("awards +0.25 bonus for high reuse success and penalizes regressions", () => {
      const goodMem = propose(store, {
        title: "Reliable Cache Invalidation",
        content: "Purge cache keys using tag prefix pattern.",
        project: "cache",
        confirmed: true,
      });
      recordApplicationOutcome(store, { memoryId: goodMem.id, success: true });
      recordApplicationOutcome(store, { memoryId: goodMem.id, success: true });

      const goodScore = calculateMultiFactorScore(goodMem, ["cache"]);
      expect(goodScore.factors.utilityBonus).toBe(0.25);

      const badMem = propose(store, {
        title: "Flaky Fix",
        content: "Ignore timeout errors.",
        project: "cache",
        confirmed: true,
      });
      recordApplicationOutcome(store, { memoryId: badMem.id, success: false, regression: true });
      recordApplicationOutcome(store, { memoryId: badMem.id, success: false, regression: true });

      const badScore = calculateMultiFactorScore(badMem, ["timeout"]);
      expect(badScore.factors.utilityBonus).toBe(-0.25);
    });

    it("awards +0.3 warning bonus for negative anti-pattern memories", () => {
      const negative = recordNegativeLesson(store, {
        project: "security",
        title: "Do not disable CORS in production",
        failed_approach: "Setting Access-Control-Allow-Origin: * on authenticated endpoints",
        failure_reason: "Permits cross-origin credential extraction",
        alternative_recommended: "Specify explicit whitelist of origins",
      });

      const score = calculateMultiFactorScore(negative, ["CORS", "authenticated"]);
      expect(score.factors.negativeWarningBonus).toBe(0.3);
    });

    it("applies severe -0.8 penalty to conflicted memories", () => {
      const conflicted = propose(store, {
        title: "Database Choice",
        content: "The backend uses Cassandra.",
        project: "core",
      });
      conflicted.status = "conflicted";

      const score = calculateMultiFactorScore(conflicted, ["database", "backend"]);
      expect(score.factors.statusPenalty).toBe(-0.8);
    });
  });

  describe("Ranked Retrieval & Token Budget Knapsack Packing", () => {
    it("packs critical constraints first when token budget is restricted", async () => {
      // 1. Propose general background memories
      for (let i = 0; i < 5; i++) {
        propose(store, {
          title: `General Architecture Feature ${i}`,
          content: `Detailed documentation for feature ${i} with extensive architectural explanation and long verbose instructions.`.repeat(3),
          project: "app",
          confirmed: true,
        });
      }

      // 2. Propose a critical security constraint
      propose(store, {
        title: "Security Invariant: SQL Parameterization",
        content: "Always use parameterized queries for SQL execution.",
        project: "app",
        type: "constraint",
        temporal_mode: "timeless",
        confirmed: true,
      });

      // Small budget ~ 60 tokens
      const results = await rankAndRetrieveMemories(store, "architecture security", {
        project: "app",
        tokenBudget: 60,
      });

      expect(results.length).toBeGreaterThan(0);
      // The constraint should fit first in the knapsack
      const hasConstraint = results.some((r) => r.entry.type === "constraint");
      expect(hasConstraint).toBe(true);
    });

    it("executes multi-factor ranked retrieval within latency budget (<15ms)", async () => {
      for (let i = 0; i < 40; i++) {
        propose(store, {
          title: `Service Component ${i}`,
          content: `Implements high throughput async messaging queue worker for task pipeline ${i}.`,
          project: "pipeline",
          confirmed: true,
        });
      }

      const start = performance.now();
      const results = await rankAndRetrieveMemories(store, "pipeline worker queue", {
        project: "pipeline",
        limit: 5,
      });
      const duration = performance.now() - start;

      expect(results.length).toBe(5);
      expect(duration).toBeLessThan(15); // Under 15ms
    });
  });
});
