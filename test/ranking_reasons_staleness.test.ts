import { describe, expect, test } from "bun:test";
import {
  isLowDiscrimination,
  conditionalRerank,
  deriveWhyRetrieved,
} from "../src/retrieval/ranking.ts";
import { getStoreWatermark } from "../src/retrieval.ts";
import { openStore, propose } from "../src/store.ts";
import type { MemoryEntry } from "../src/types.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Wave 3 - Task 4: Conditional Reranking, Watermark Staleness & Reason Tokens", () => {
  describe("T-115: low_discrimination() conditional rerank", () => {
    test("detects low discrimination when top candidates are tightly clustered", () => {
      // Scores separated by <= 0.04
      expect(isLowDiscrimination([0.82, 0.81, 0.80])).toBe(true);
      expect(isLowDiscrimination([0.85, 0.84])).toBe(true);

      // Distinctly separated scores should return false
      expect(isLowDiscrimination([0.95, 0.60, 0.40])).toBe(false);
      expect(isLowDiscrimination([0.85, 0.70])).toBe(false);
      expect(isLowDiscrimination([0.85])).toBe(false);
    });

    test("conditionalRerank breaks ties using verification level, trust, and recency", () => {
      const entryUnverified: MemoryEntry = {
        id: "m-unverified",
        title: "Unverified Pattern",
        content: "Draft architecture idea",
        project: "test",
        status: "candidate",
        created_at: "2026-10-10T10:00:00.000Z",
        updated_at: "2026-10-10T10:00:00.000Z",
      };

      const entryVerified: MemoryEntry = {
        id: "m-verified",
        title: "Verified Pattern",
        content: "Verified production architecture",
        project: "test",
        status: "confirmed",
        verification: { level: "independently-verified", method: "code_review" },
        created_at: "2026-10-12T10:00:00.000Z",
        updated_at: "2026-10-12T10:00:00.000Z",
      };

      // Both candidates have identical base score of 0.80
      const candidates = [
        { entry: entryUnverified, score: 0.80, factors: {} as any },
        { entry: entryVerified, score: 0.80, factors: {} as any },
      ];

      const reranked = conditionalRerank(candidates);
      expect(reranked[0].entry.id).toBe("m-verified");
      expect(reranked[0].score).toBeGreaterThan(reranked[1].score);
    });
  });

  describe("T-117: Watermark staleness tracking from last_memory_seen_at", () => {
    test("getStoreWatermark returns highest memory timestamp in store", () => {
      const testDir = mkdtempSync(join(tmpdir(), "muse-watermark-"));
      const memoryDir = join(testDir, ".memory");
      const store = openStore(memoryDir);

      try {
        const e1 = propose(store, {
          title: "First entry",
          content: "Initial setup",
          project: "test",
          confirmed: true,
        });

        const e2 = propose(store, {
          title: "Second entry",
          content: "Updated config",
          project: "test",
          confirmed: true,
        });

        const watermark = getStoreWatermark(store);
        expect(watermark).toBe(e2.updated_at);
        expect(watermark >= e1.updated_at).toBe(true);
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("T-126: Deterministic why_retrieved reason tokens", () => {
    test("derives deterministic reason tokens from contributing factors and metadata", () => {
      const entry: MemoryEntry = {
        id: "m-tokens",
        title: "Negative Warning Guard",
        content: "Do not use raw Math.max spread",
        project: "test",
        type: "negative",
        status: "confirmed",
        verification: { level: "reproducible" },
        temporal_mode: "timeless",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const factors = {
        baseApplicability: 0.5,
        exactSymbolMatch: 1.0,
        graphOverlap: 0,
        pathMatch: 0.4,
        bm25Match: 0.3,
        blastRadius: 0,
        statusPenalty: 0,
        verificationBonus: 0.1,
        salienceBonus: 0,
        reinforcementBonus: 0,
        dueBonus: 0,
        utilityBonus: 0,
        negativeWarningBonus: 0.3,
        timelessBoost: 0.2,
        recencyDecay: 0,
        trustAdjustment: 0,
        accessBoost: 0,
        recentAccessBoost: 0,
        zeroMatchPenalty: 0,
        semanticMatch: 0,
        totalScore: 2.8,
      };

      const reasons = deriveWhyRetrieved(factors, entry);
      expect(reasons).toContain("exact_symbol_match");
      expect(reasons).toContain("bm25_fts_hit");
      expect(reasons).toContain("path_proximity");
      expect(reasons).toContain("verified_memory");
      expect(reasons).toContain("negative_pattern_warning");
      expect(reasons).toContain("timeless_rule");
      expect(reasons).toContain("lexical_overlap");

      // Sorted deterministically
      const sorted = [...reasons].sort();
      expect(reasons).toEqual(sorted);
    });
  });
});
