import { describe, test, expect } from "bun:test";
import {
  validateMemorySyntax,
  checkCorroboration,
  evaluatePromotion,
} from "../src/promotion/engine.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("T-105 & T-105b: Corroboration & Syntax Promotion Gates", () => {
  describe("T-105b: Syntax-Only Promotion Rule", () => {
    test("rejects malformed JSON code blocks", () => {
      const entry: MemoryEntry = {
        id: "m_syn_bad_json",
        title: "Database schema migration",
        content: "Here is the new config:\n```json\n{ key: 'unquoted_and_invalid' }\n```",
        project: "app",
        status: "candidate",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        source: "manual",
        tags: ["db"],
      };

      const res = validateMemorySyntax(entry);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain("malformed JSON code block");

      const evalRes = evaluatePromotion(entry);
      expect(evalRes.eligible).toBe(false);
      expect(evalRes.reasons.some((r) => r.includes("malformed JSON"))).toBe(true);
    });

    test("accepts valid JSON code blocks", () => {
      const entry: MemoryEntry = {
        id: "m_syn_good_json",
        title: "Database schema migration",
        content: 'Here is the valid config:\n```json\n{\n  "version": 2,\n  "enabled": true\n}\n```',
        project: "app",
        status: "candidate",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        source: "manual",
        tags: ["db"],
      };

      const res = validateMemorySyntax(entry);
      expect(res.valid).toBe(true);
    });

    test("rejects unbalanced quotes and parentheses in test_command", () => {
      const badQuotes: MemoryEntry = {
        id: "m_syn_cmd_quotes",
        title: "Test rule",
        content: "Run test suite",
        test_command: 'bun test --filter "unclosed quote',
        project: "app",
        status: "candidate",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        source: "manual",
        tags: ["test"],
      };
      expect(validateMemorySyntax(badQuotes).valid).toBe(false);
      expect(validateMemorySyntax(badQuotes).reason).toContain("unbalanced quotes");

      const badParens: MemoryEntry = {
        id: "m_syn_cmd_parens",
        title: "Test rule",
        content: "Run test suite",
        test_command: "bun run (subshell && exit",
        project: "app",
        status: "candidate",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        source: "manual",
        tags: ["test"],
      };
      expect(validateMemorySyntax(badParens).valid).toBe(false);
      expect(validateMemorySyntax(badParens).reason).toContain("unbalanced parentheses");
    });
  });

  describe("T-105: Corroboration-Gated Promotion", () => {
    test("fails if evidence spans < 2 independent calendar days", () => {
      const entry: MemoryEntry = {
        id: "m_corrob_single_day",
        title: "Architecture pattern",
        content: "Always use connection pooling for SQLite in microservices.",
        project: "core",
        status: "confirmed",
        scope: "project",
        created_at: "2026-10-15T10:00:00.000Z",
        updated_at: "2026-10-15T11:00:00.000Z",
        source: "human",
        evidence: [
          {
            id: "ev_1",
            type: "test",
            source: "local-tests",
            timestamp: "2026-10-15T10:30:00.000Z",
          },
        ],
        tags: ["sqlite"],
      };

      const res = checkCorroboration(entry);
      expect(res.corroborated).toBe(false);
      expect(res.distinctDays).toBe(1);
      expect(res.reason).toContain(">= 2 independent calendar days");
    });

    test("fails if all sources are synthetic/agent generated", () => {
      const entry: MemoryEntry = {
        id: "m_corrob_all_synthetic",
        title: "Agent observation",
        content: "The agent noticed an edge case during autonomous run.",
        project: "core",
        status: "confirmed",
        scope: "project",
        created_at: "2026-10-14T10:00:00.000Z",
        updated_at: "2026-10-14T10:00:00.000Z",
        last_confirmed_at: "2026-10-15T10:00:00.000Z",
        source: "agent",
        evidence: [
          {
            id: "ev_1",
            type: "infer",
            source: "transcript",
            timestamp: "2026-10-14T10:00:00.000Z",
          },
          {
            id: "ev_2",
            type: "infer",
            source: "assistant",
            timestamp: "2026-10-15T10:00:00.000Z",
          },
        ],
        tags: ["agent"],
      };

      const res = checkCorroboration(entry);
      expect(res.corroborated).toBe(false);
      expect(res.distinctDays).toBe(2);
      expect(res.reason).toContain("non-synthetic source");
    });

    test("passes when spanning >= 2 calendar days with non-synthetic sources", () => {
      const entry: MemoryEntry = {
        id: "m_corrob_valid",
        title: "Production database rule",
        content: "Always run PRAGMA wal_checkpoint before shutting down store.",
        project: "core",
        status: "confirmed",
        scope: "project",
        created_at: "2026-10-12T10:00:00.000Z",
        updated_at: "2026-10-12T10:00:00.000Z",
        last_confirmed_at: "2026-10-15T10:00:00.000Z",
        source: "human",
        evidence: [
          {
            id: "ev_1",
            type: "code",
            source: "src/store.ts",
            timestamp: "2026-10-12T10:00:00.000Z",
          },
          {
            id: "ev_2",
            type: "test",
            source: "test/store.test.ts",
            timestamp: "2026-10-15T10:00:00.000Z",
          },
        ],
        tags: ["sqlite", "wal"],
      };

      const res = checkCorroboration(entry);
      expect(res.corroborated).toBe(true);
      expect(res.distinctDays).toBeGreaterThanOrEqual(2);
      expect(res.nonSyntheticSources.length).toBeGreaterThanOrEqual(1);
    });

    test("evaluatePromotion enforces corroboration gate when evidence is present", () => {
      const singleDayEntry: MemoryEntry = {
        id: "m_eval_single_day",
        title: "Caching strategy",
        content: "Always invalidate cache before updating DB.",
        project: "core",
        status: "confirmed",
        scope: "project",
        created_at: "2026-10-15T10:00:00.000Z",
        updated_at: "2026-10-15T11:00:00.000Z",
        source: "human",
        verification: { level: "authoritative" },
        utility: {
          retrieval_count: 10,
          application_count: 5,
          successful_applications: 5,
          failed_applications: 0,
          regressions: 0,
          contradictions: 0,
          reuse_success_rate: 1.0,
        },
        evidence: [
          {
            id: "ev_1",
            type: "doc",
            source: "README.md",
            timestamp: "2026-10-15T10:00:00.000Z",
          },
        ],
        tags: ["cache"],
      };

      const evalResult = evaluatePromotion(singleDayEntry);
      expect(evalResult.eligible).toBe(false);
      expect(evalResult.reasons.some((r) => r.includes("Corroboration gate failed"))).toBe(true);
    });
  });
});
