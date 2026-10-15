import { describe, expect, test } from "bun:test";
import { safeMax, safeMin } from "../src/retrieval.ts";
import { inverseDocumentFrequencies, type VectorIndex } from "../src/vector.ts";
import { countMemories, openStore } from "../src/store.ts";
import { rmSync } from "node:fs";

describe("Wave 3 - Task 1: Scale Safety & Performance Core", () => {
  describe("T-035: safeMax & safeMin iterative scale safety", () => {
    test("handles empty arrays with default fallback", () => {
      expect(safeMax([], 42)).toBe(42);
      expect(safeMin([], -1)).toBe(-1);
      expect(safeMax([])).toBe(0);
      expect(safeMin([])).toBe(0);
    });

    test("computes correct min and max for small arrays", () => {
      const numbers = [3.5, -2, 10, 0, 7.2];
      expect(safeMax(numbers)).toBe(10);
      expect(safeMin(numbers)).toBe(-2);
    });

    test("survives 150,000 elements without RangeError call stack overflow", () => {
      // 150k numbers would throw "Maximum call stack size exceeded" with Math.max(...arr)
      const largeArray = new Array(150_000);
      for (let i = 0; i < 150_000; i++) {
        largeArray[i] = i * 0.1;
      }
      largeArray[123_456] = 999_999;
      largeArray[10] = -500;

      expect(() => safeMax(largeArray)).not.toThrow();
      expect(() => safeMin(largeArray)).not.toThrow();
      expect(safeMax(largeArray)).toBe(999_999);
      expect(safeMin(largeArray)).toBe(-500);
    });
  });

  describe("T-036: In-memory IDF caching across queries", () => {
    test("caches computed IDF and reuses it on subsequent calls with unchanged index", () => {
      const mockIndex: VectorIndex = {
        version: 1,
        updated_at: "2026-10-15T12:00:00.000Z",
        dimension: 128,
        entries: {
          "mem-1": {
            vector: [0.1, 0.2],
            magnitude: 0.22,
            tokens: ["authentication", "token", "jwt"],
            tf: { authentication: 1, token: 2, jwt: 1 },
          },
          "mem-2": {
            vector: [0.2, 0.3],
            magnitude: 0.36,
            tokens: ["database", "sqlite", "query"],
            tf: { database: 1, sqlite: 1, query: 3 },
          },
        },
      };

      const firstPass = inverseDocumentFrequencies(mockIndex);
      const secondPass = inverseDocumentFrequencies(mockIndex);

      expect(firstPass).toBeDefined();
      expect(firstPass.idf["authentication"]).toBeGreaterThan(0);
      // Object reference should be strictly equal due to caching
      expect(secondPass).toBe(firstPass);

      // Updating index timestamp invalidates cache
      const updatedIndex: VectorIndex = {
        ...mockIndex,
        updated_at: "2026-10-15T12:05:00.000Z",
      };
      const thirdPass = inverseDocumentFrequencies(updatedIndex);
      expect(thirdPass).not.toBe(firstPass);
    });
  });

  describe("T-037: Drop redundant full-list scan via countMemories", () => {
    test("countMemories returns fast integer count without loading all entries", () => {
      const testDir = `.memory/test-scale-p0-${Date.now()}`;
      try {
        const store = openStore(testDir);
        expect(countMemories(store)).toBe(0);
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });
});
