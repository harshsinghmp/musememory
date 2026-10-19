import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, list, type Store } from "../src/store.ts";
import {
  detectQueryIntent,
  computeIntentMultiplier,
  INTENT_BIAS_TABLE,
  type TaskIntent,
} from "../src/retrieval/intent_bias.ts";
import {
  computeFactors,
  deriveWhyRetrieved,
} from "../src/retrieval.ts";
import {
  calculateMultiFactorScore,
  rankAndRetrieveMemories,
} from "../src/retrieval/ranking.ts";
import { resolveMuseContext } from "../src/orchestrator/context.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("T-118: Query-intent bias multipliers in retrieval", () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-intent-test-"));
    store = openStore(tmpDir);
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe("detectQueryIntent", () => {
    it("detects architecture intent from architectural queries", () => {
      expect(detectQueryIntent("why did we switch to sqlite?")).toBe("architecture");
      expect(detectQueryIntent("review architecture decision record for auth")).toBe("architecture");
      expect(detectQueryIntent("tradeoff between rest and graphql")).toBe("architecture");
      expect(detectQueryIntent("system design patterns")).toBe("architecture");
    });

    it("detects bugfix intent from error and debugging queries", () => {
      expect(detectQueryIntent("fix memory leak in worker thread")).toBe("bugfix");
      expect(detectQueryIntent("unhandled exception crash on startup")).toBe("bugfix");
      expect(detectQueryIntent("broken token refresh regression")).toBe("bugfix");
      expect(detectQueryIntent("tests failing in pipeline")).toBe("bugfix");
    });

    it("detects refactor intent from code reorganization queries", () => {
      expect(detectQueryIntent("refactor database connection pool")).toBe("refactor");
      expect(detectQueryIntent("cleanup legacy handlers and deprecate v1")).toBe("refactor");
      expect(detectQueryIntent("modernize async queue dispatch")).toBe("refactor");
    });

    it("detects review intent from security and audit queries", () => {
      expect(detectQueryIntent("security review of oauth callback")).toBe("review");
      expect(detectQueryIntent("audit sanitize html inputs")).toBe("review");
      expect(detectQueryIntent("check cve vulnerability in deps")).toBe("review");
    });

    it("detects feature intent from implementation queries", () => {
      expect(detectQueryIntent("implement webhook retry logic")).toBe("feature");
      expect(detectQueryIntent("add support for webauthn passkeys")).toBe("feature");
      expect(detectQueryIntent("create new billing export endpoint")).toBe("feature");
    });

    it("returns general for conversational or unrecognized queries", () => {
      expect(detectQueryIntent("status update")).toBe("general");
      expect(detectQueryIntent("what is today's schedule")).toBe("general");
      expect(detectQueryIntent("")).toBe("general");
    });
  });

  describe("computeIntentMultiplier", () => {
    const baseEntry: MemoryEntry = {
      id: "mem-test-1",
      title: "Test entry",
      content: "Test content details",
      type: "decision",
      status: "active",
      confidence: 0.9,
      project: "test",
      tags: ["adr", "database"],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    it("returns 1.25 for architecture intent matching decision type and adr tag", () => {
      const mult = computeIntentMultiplier("architecture", baseEntry);
      expect(mult).toBe(1.25);
    });

    it("returns 1.25 for bugfix intent matching fix type or gotcha tag", () => {
      const fixEntry: MemoryEntry = {
        ...baseEntry,
        type: "fix",
        tags: ["gotcha"],
      };
      const mult = computeIntentMultiplier("bugfix", fixEntry);
      expect(mult).toBe(1.25);
    });

    it("returns 1.25 for bugfix intent matching negative warning entries", () => {
      const negEntry: MemoryEntry = {
        ...baseEntry,
        type: "negative",
        tags: ["anti-pattern"],
      };
      const mult = computeIntentMultiplier("bugfix", negEntry);
      expect(mult).toBe(1.25);
    });

    it("returns 1.20 for refactor intent matching operation type", () => {
      const opEntry: MemoryEntry = {
        ...baseEntry,
        type: "operation",
        tags: ["standards"],
      };
      const mult = computeIntentMultiplier("refactor", opEntry);
      expect(mult).toBe(1.20);
    });

    it("returns 1.25 for review intent matching constraint type", () => {
      const constraintEntry: MemoryEntry = {
        ...baseEntry,
        type: "constraint",
        tags: ["security"],
      };
      const mult = computeIntentMultiplier("review", constraintEntry);
      expect(mult).toBe(1.25);
    });

    it("returns 1.0 for general intent or unmatched types", () => {
      expect(computeIntentMultiplier("general", baseEntry)).toBe(1.0);
      expect(computeIntentMultiplier(undefined, baseEntry)).toBe(1.0);
    });
  });

  describe("computeFactors & calculateMultiFactorScore integration", () => {
    it("computes intent bias and adds intent_bias_boost to why_retrieved", () => {
      const entry: MemoryEntry = {
        id: "mem-arch-1",
        title: "SQLite storage decision",
        content: "We use SQLite for local zero-daemon storage",
        type: "decision",
        status: "active",
        confidence: 0.95,
        project: "test",
        tags: ["adr", "sqlite"],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const result = calculateMultiFactorScore(entry, ["sqlite", "storage"], {
        taskIntent: "architecture",
      });

      expect(result.factors.intentMultiplier).toBe(1.25);
      expect(result.factors.intentBias).toBeGreaterThan(0);
      expect(result.why_retrieved).toContain("intent_bias_boost");
    });
  });

  describe("rankAndRetrieveMemories ranking behavior", async () => {
    it("ranks intent-aligned memory higher than non-aligned memory with identical text overlap", async () => {
      // Memory A: a decision matching "sqlite"
      const entryA = propose(store, {
        title: "SQLite architecture choice",
        content: "Database persistence layer evaluation and SQLite decision",
        type: "decision",
        project: "test",
        tags: ["adr"],
      });

      // Memory B: a routine scratch note matching "sqlite"
      const entryB = propose(store, {
        title: "SQLite daily scratch note",
        content: "Database persistence layer evaluation and temporary notes",
        type: "note" as any,
        project: "test",
        tags: ["scratch"],
      });

      // Rank under architecture intent
      const results = await rankAndRetrieveMemories(store, "sqlite database persistence evaluation", {
        taskIntent: "architecture",
      });

      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results[0].entry.id).toBe(entryA.id);
      expect(results[0].score).toBeGreaterThan(results[1].score);
      expect(results[0].why_retrieved).toContain("intent_bias_boost");
    });

    it("heuristically infers intent from query when taskIntent is not provided", async () => {
      const fixEntry = propose(store, {
        title: "Fix for deadlock crash",
        content: "Deadlock error resolution in thread pool queue",
        type: "fix",
        project: "test",
        tags: ["bug"],
      });

      const noteEntry = propose(store, {
        title: "Deadlock queue documentation",
        content: "Deadlock error resolution in thread pool queue docs",
        type: "note" as any,
        project: "test",
      });

      const results = await rankAndRetrieveMemories(store, "fix crash in thread pool deadlock queue");
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results[0].entry.id).toBe(fixEntry.id);
      expect(results[0].factors.intentMultiplier).toBe(1.25);
      expect(results[0].why_retrieved).toContain("intent_bias_boost");
    });
  });

  describe("resolveMuseContext integration", async () => {
    it("propagates task_intent to ranking in resolveMuseContext", async () => {
      propose(store, {
        title: "Security constraint on auth token headers",
        content: "Never log auth token authorization headers in production",
        type: "constraint",
        project: "test",
        tags: ["security"],
      });

      const result = await resolveMuseContext(store, tmpDir, {
        project: "test",
        query: "auth token authorization headers",
        task_intent: "review",
      });

      expect(result.active_constraints.length).toBeGreaterThan(0);
      const topConstraint = result.active_constraints[0];
      expect(topConstraint.title).toContain("Security constraint");
    });
  });
});
