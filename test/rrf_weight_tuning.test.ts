import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, type Store } from "../src/store.ts";
import {
  calculateRrfItemScore,
  resolveRrfConfig,
  reciprocalRankFusion,
  RRF_PRESETS,
} from "../src/retrieval/rrf.ts";
import { rankAndRetrieveMemories } from "../src/retrieval/ranking.ts";
import { hybridSearch, rebuildIndex, saveIndex } from "../src/vector.ts";

describe("T-120: RRF weight tuning + A/B in retrieval", () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-rrf-test-"));
    store = openStore(tmpDir);
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe("resolveRrfConfig", () => {
    it("resolves default control/A variant parameters", () => {
      const config = resolveRrfConfig();
      expect(config.k).toBe(60);
      expect(config.weights.lexical).toBe(1.0);
      expect(config.weights.semantic).toBe(1.0);
      expect(config.weights.graph).toBe(0.8);
      expect(config.weights.recency).toBe(0.5);
    });

    it("resolves treatment/B variant with boosted semantic and graph weights", () => {
      const config = resolveRrfConfig({ variant: "B" });
      expect(config.k).toBe(60);
      expect(config.weights.lexical).toBe(0.8);
      expect(config.weights.semantic).toBe(1.2);
      expect(config.weights.graph).toBe(1.0);
      expect(config.weights.recency).toBe(0.6);
    });

    it("allows custom k constant and weight overrides", () => {
      const config = resolveRrfConfig({
        k: 40,
        weights: { lexical: 1.5, semantic: 2.0 },
      });
      expect(config.k).toBe(40);
      expect(config.weights.lexical).toBe(1.5);
      expect(config.weights.semantic).toBe(2.0);
      expect(config.weights.graph).toBe(0.8); // inherited from default
    });
  });

  describe("calculateRrfItemScore", () => {
    it("computes weighted reciprocal rank fusion formula correctly", () => {
      // rank 1 with weight 1.0 (k=60): 1 / 61 = 0.016393
      // rank 2 with weight 0.8 (k=60): 0.8 / 62 = 0.012903
      // total = 0.029296
      const score = calculateRrfItemScore(
        [
          { rank: 1, weight: 1.0 },
          { rank: 2, weight: 0.8 },
        ],
        60,
      );
      expect(score).toBeCloseTo(0.029296, 5);
    });

    it("ignores non-positive rank entries", () => {
      const score = calculateRrfItemScore(
        [
          { rank: 1, weight: 1.0 },
          { rank: 0, weight: 1.0 },
        ],
        60,
      );
      expect(score).toBeCloseTo(1 / 61, 5);
    });
  });

  describe("reciprocalRankFusion multi-list fusion", () => {
    it("fuses lexical and semantic signal lists into unified ranking", () => {
      const lexicalList = [{ id: "mem-1" }, { id: "mem-2" }, { id: "mem-3" }];
      const semanticList = [{ id: "mem-2" }, { id: "mem-1" }, { id: "mem-3" }];

      const lists = new Map<string, Array<{ id: string }>>();
      lists.set("lexical", lexicalList);
      lists.set("semantic", semanticList);

      const fused = reciprocalRankFusion(lists, { k: 60 });
      expect(fused.length).toBe(3);
      // Both mem-1 and mem-2 have ranks 1 & 2 across lexical/semantic (identical RRF score)
      expect(fused[0].rrfScore).toBeGreaterThan(fused[2].rrfScore);
      expect(fused[2].item.id).toBe("mem-3");
    });
  });

  describe("hybridSearch vector fusion integration", () => {
    it("executes RRF fusion when fusion is 'rrf' in hybridSearch", () => {
      propose(store, {
        title: "Database connection pool",
        content: "Configure PostgreSQL connection pool limits and timeouts",
        type: "decision",
        project: "test",
      });
      propose(store, {
        title: "Session token validation",
        content: "JWT auth token verification in authentication middleware",
        type: "decision",
        project: "test",
      });

      const index = rebuildIndex(store);
      saveIndex(index, tmpDir);

      const controlResults = hybridSearch(store, tmpDir, "database connection pool", {
        fusion: "rrf",
        rrfVariant: "A",
      });

      expect(controlResults).not.toBeNull();
      expect(controlResults!.length).toBeGreaterThan(0);
      expect(controlResults![0].entry.title).toContain("Database connection pool");

      const treatmentResults = hybridSearch(store, tmpDir, "database connection pool", {
        fusion: "rrf",
        rrfVariant: "B",
      });

      expect(treatmentResults).not.toBeNull();
      expect(treatmentResults!.length).toBeGreaterThan(0);
      expect(treatmentResults![0].score).toBeGreaterThan(0);
    });
  });

  describe("rankAndRetrieveMemories RRF integration", async () => {
    it("calculates RRF score and tags why_retrieved with rrf_fused and rrf_variant", async () => {
      propose(store, {
        title: "Architecture pattern: event sourcing",
        content: "Event stream persistence and replay for state reconstruction",
        type: "decision",
        project: "test",
        tags: ["architecture"],
      });

      propose(store, {
        title: "Event broker configuration",
        content: "Kafka cluster cluster consumer group settings and retries",
        type: "operation",
        project: "test",
      });

      const results = await rankAndRetrieveMemories(store, "event sourcing persistence state", {
        useRrf: true,
        rrfVariant: "B",
      });

      expect(results.length).toBeGreaterThan(0);
      const top = results[0];
      expect(top.rrfScore).toBeDefined();
      expect(top.rrfScore).toBeGreaterThan(0);
      expect(top.why_retrieved).toContain("rrf_fused");
      expect(top.why_retrieved).toContain("rrf_variant:B");
    });
  });
});
