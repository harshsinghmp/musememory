import { describe, expect, test } from "bun:test";
import { evaluateQueryRelevance } from "../src/retrieval.ts";
import { softOrFusion } from "../src/retrieval/ranking.ts";

describe("Wave 3 - Task 3: Relevance Gating & Soft-OR Evidence Fusion", () => {
  describe("T-070: IDF-weighted relevance gate (0.3 threshold, identifier-decisive, greeting short-circuit)", () => {
    test("rejects trivial conversational greetings and pleasantries", () => {
      const greetings = ["hello", "hi", "hey there", "good morning", "thank you", "thanks", "ok", "okay"];
      for (const g of greetings) {
        const evalRes = evaluateQueryRelevance(g);
        expect(evalRes.relevant).toBe(false);
        expect(evalRes.score).toBeLessThan(0.3);
        expect(evalRes.reason).toBeDefined();
      }
    });

    test("accepts substantive technical queries above 0.3 threshold", () => {
      const queries = [
        "sqlite database corruption recovery",
        "JWT authentication refresh token rotation",
        "React state management hook useEffect memory leak",
      ];
      for (const q of queries) {
        const evalRes = evaluateQueryRelevance(q);
        expect(evalRes.relevant).toBe(true);
        expect(evalRes.score).toBeGreaterThanOrEqual(0.3);
      }
    });

    test("is identifier-decisive: short technical symbols and backticked identifiers pass gate", () => {
      // Even though "getUser" or "`db`" is short, code identifiers are decisive
      const eval1 = evaluateQueryRelevance("getUserProfile");
      expect(eval1.relevant).toBe(true);
      expect(eval1.score).toBeGreaterThanOrEqual(0.3);

      const eval2 = evaluateQueryRelevance("fix `auth` crash");
      expect(eval2.relevant).toBe(true);

      const eval3 = evaluateQueryRelevance("src/sqlite.ts");
      expect(eval3.relevant).toBe(true);
    });
  });

  describe("T-114: Soft-OR evidence fusion formula P = 1 - (1 - pv)(1 - pl)", () => {
    test("combines independent probabilities correctly according to De Morgan Soft-OR", () => {
      // P = 1 - (1 - pv)(1 - pl)
      expect(softOrFusion(0, 0)).toBe(0);
      expect(softOrFusion(0.5, 0)).toBe(0.5);
      expect(softOrFusion(0, 0.7)).toBe(0.7);

      // Both 0.8 -> 1 - (0.2 * 0.2) = 0.96
      expect(softOrFusion(0.8, 0.8)).toBeCloseTo(0.96, 5);

      // Both 1.0 -> 1.0
      expect(softOrFusion(1.0, 1.0)).toBe(1.0);

      // Clamps inputs outside [0, 1]
      expect(softOrFusion(-0.2, 0.5)).toBe(0.5);
      expect(softOrFusion(1.5, 0.5)).toBe(1.0);
    });

    test("preserves single-channel signal without artificial linear dilution", () => {
      // In linear average 0.5 * pv + 0.5 * pl, a strong lexical match (pl = 0.9) with zero vector match (pv = 0)
      // would get cut in half to 0.45. Soft-OR preserves the full 0.9!
      const fused = softOrFusion(0, 0.9);
      expect(fused).toBe(0.9);
    });

    test("hybridSearch supports fusion: 'soft_or' strategy", () => {
      const { openStore, propose } = require("../src/store.ts");
      const { rebuildIndex, saveIndex, hybridSearch } = require("../src/vector.ts");
      const { mkdtempSync, rmSync } = require("node:fs");
      const { tmpdir } = require("node:os");
      const { join } = require("node:path");

      const testDir = mkdtempSync(join(tmpdir(), "muse-softor-"));
      const memoryDir = join(testDir, ".memory");
      const store = openStore(memoryDir);

      try {
        propose(store, {
          title: "Memory Store Architecture",
          content: "Persistent SQLite storage with soft-OR vector fusion",
          project: "test",
          confirmed: true,
        });
        const index = rebuildIndex(store);
        saveIndex(index, memoryDir);

        const results = hybridSearch(store, memoryDir, "SQLite storage fusion", {
          fusion: "soft_or",
        });
        expect(results).not.toBeNull();
        expect(results!.length).toBeGreaterThan(0);
        expect(results![0].score).toBeGreaterThan(0);
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });
});
