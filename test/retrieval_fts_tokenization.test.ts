import { describe, expect, test } from "bun:test";
import { tokenize, splitCompoundToken } from "../src/retrieval.ts";
import { escapeFtsToken, buildSafeFtsQuery, searchMemoriesFts, openDatabase, insertOrReplaceMemory } from "../src/sqlite.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("Wave 3 - Task 2: FTS5 Query Injection Safety & Compound Token Splitting", () => {
  describe("T-061: Compound-token expansion (camelCase & snake_case splitting)", () => {
    test("splitCompoundToken breaks camelCase and PascalCase into sub-tokens plus original", () => {
      const camel = splitCompoundToken("getUserProfile");
      expect(camel).toContain("get");
      expect(camel).toContain("user");
      expect(camel).toContain("profile");
      expect(camel).toContain("getuserprofile");

      const pascal = splitCompoundToken("MemoryStoreEngine");
      expect(pascal).toContain("memory");
      expect(pascal).toContain("store");
      expect(pascal).toContain("engine");
      expect(pascal).toContain("memorystoreengine");
    });

    test("splitCompoundToken breaks snake_case and kebab-case", () => {
      const snake = splitCompoundToken("auth_token_secret");
      expect(snake).toContain("auth");
      expect(snake).toContain("token");
      expect(snake).toContain("secret");

      const kebab = splitCompoundToken("rate-limiter-middleware");
      expect(kebab).toContain("rate");
      expect(kebab).toContain("limiter");
      expect(kebab).toContain("middleware");
    });

    test("tokenize includes both compound tokens and decomposed sub-tokens", () => {
      const tokens = tokenize("Call getUserProfile with auth_token in TypeScript");
      expect(tokens).toContain("getuserprofile");
      expect(tokens).toContain("get");
      expect(tokens).toContain("user");
      expect(tokens).toContain("profile");
      expect(tokens).toContain("auth");
      expect(tokens).toContain("token");
      expect(tokens).toContain("typescript");
    });

    test("preserves unicode scripts and accented characters (T-311)", () => {
      const tokens = tokenize("東京 Tokyo résumé Über");
      expect(tokens).toContain("東京");
      expect(tokens).toContain("tokyo");
      expect(tokens).toContain("résumé");
      expect(tokens).toContain("über");
    });
  });

  describe("T-060 & T-312: Safe FTS5 query token escaping and error handling", () => {
    test("escapeFtsToken escapes internal quotes and syntax operators safely", () => {
      expect(escapeFtsToken(`foo"bar`)).toBe(`"foo""bar"*`);
      expect(escapeFtsToken(`normal`)).toBe(`"normal"*`);
      expect(escapeFtsToken(``)).toBe(``);
    });

    test("buildSafeFtsQuery handles hostile characters, operators, and mismatched quotes without throwing syntax error", () => {
      const hostileQueries = [
        `"unclosed quote`,
        `NEAR(foo bar, 5)`,
        `NOT (column:value)`,
        `* AND OR ^ : { } ( ) [ ]`,
        `--comment injection ' " ;`,
        `SELECT * FROM memories`,
        `hello:world*foo^bar`,
      ];

      for (const q of hostileQueries) {
        expect(() => buildSafeFtsQuery(q)).not.toThrow();
        const safe = buildSafeFtsQuery(q);
        expect(typeof safe).toBe("string");
      }
    });

    test("searchMemoriesFts safely executes hostile queries on real SQLite FTS5 database", () => {
      const db = openDatabase(":memory:");

      const sample: MemoryEntry = {
        id: "mem-test-fts-1",
        title: "UserProfile Authentication Flow",
        content: "Handles auth_token validation, jwt parsing, and getUserProfile calls.",
        project: "test-proj",
        status: "confirmed",
        type: "architecture",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      insertOrReplaceMemory(db, sample);

      // Normal query works
      const res1 = searchMemoriesFts(db, "UserProfile auth_token");
      expect(res1.length).toBeGreaterThan(0);
      expect(res1[0].entry.id).toBe("mem-test-fts-1");

      // Hostile FTS injection queries do not throw or crash
      const resHostile1 = searchMemoriesFts(db, `NOT AND OR * " ' ( ) ^ : { }`);
      expect(Array.isArray(resHostile1)).toBe(true);

      const resHostile2 = searchMemoriesFts(db, `NEAR(getUserProfile auth_token, 10)`);
      expect(Array.isArray(resHostile2)).toBe(true);

      const resHostile3 = searchMemoriesFts(db, `"unclosed quote with * wildcard`);
      expect(Array.isArray(resHostile3)).toBe(true);
    });
  });
});
