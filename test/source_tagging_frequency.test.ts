import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openStore, propose, confirm, type Store } from "../src/store.ts";
import { compileHotCache, getHotCandidateIds } from "../src/compounding/temporal.ts";
import { computeFactors, type ScoreContext } from "../src/retrieval.ts";
import { rankAndRetrieveMemories, calculateMultiFactorScore } from "../src/retrieval/ranking.ts";

describe("T-314: Source-Tagged Recall Hits & HOT.md", () => {
  const testDir = join(import.meta.dir, ".tmp-source-tagging-test");
  let store: Store;

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    store = openStore(testDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("extracts hot candidate IDs from compiled HOT.md and memoizes them", () => {
    const entry = propose(store, {
      title: "Core Architecture Principle",
      content: "State machines must be deterministic",
      project: "test-proj",
      type: "architecture",
    });
    confirm(store, entry.id);

    // Compile hot cache
    compileHotCache(store, testDir);

    const hotIds = getHotCandidateIds(store, testDir);
    expect(hotIds.has(entry.id)).toBe(true);

    // Calling again returns the memoized set
    const hotIds2 = getHotCandidateIds(store, testDir);
    expect(hotIds2).toBe(hotIds);
  });

  it("applies relevance-gated sourceBonus (+0.20) when candidate is in HOT.md and relevant to query", () => {
    const entry = propose(store, {
      title: "PostgreSQL Connection Pooling",
      content: "Configure max 20 connections in pool for PostgreSQL",
      project: "test-proj",
      type: "architecture",
    });
    confirm(store, entry.id);

    compileHotCache(store, testDir);

    const ctx: ScoreContext = {
      now: Date.now(),
      workspaceRoot: testDir,
      sourceChannels: new Map([[entry.id, new Set(["hot"])]]),
    };

    // Query is relevant to postgres pool
    const factors = computeFactors(entry, ["postgresql", "pool"], ctx);

    expect(factors.source_channels).toContain("hot");
    expect(factors.sourceBonus).toBe(0.20);
    expect(factors.totalScore).toBeGreaterThan(0.20);
  });

  it("relevance gate zeroes out sourceBonus when candidate in HOT.md is completely irrelevant to query", () => {
    const entry = propose(store, {
      title: "PostgreSQL Connection Pooling",
      content: "Configure max 20 connections in pool for PostgreSQL",
      project: "test-proj",
      type: "architecture",
    });
    confirm(store, entry.id);

    compileHotCache(store, testDir);

    const ctx: ScoreContext = {
      now: Date.now(),
      workspaceRoot: testDir,
      sourceChannels: new Map([[entry.id, new Set(["hot"])]]),
    };

    // Completely irrelevant query tokens (e.g. CSS animation layout)
    const factors = computeFactors(entry, ["banana", "zebra", "spaceship"], ctx);

    // Because applicability is zero and there is zero symbol/fts/semantic match,
    // relevance gate suppresses source bonus to prevent zombie distraction!
    expect(factors.sourceBonus).toBe(0);
  });

  it("outputs source:hot and source:fts tokens in why_retrieved", async () => {
    const entry = propose(store, {
      title: "JWT Token Expiration Invariant",
      content: "JWT tokens must expire in 15 minutes",
      project: "test-proj",
      type: "architecture",
    });
    confirm(store, entry.id);

    compileHotCache(store, testDir);

    const results = await rankAndRetrieveMemories(store, "JWT tokens expire", {
      project: "test-proj",
    });

    expect(results.length).toBeGreaterThan(0);
    const top = results.find((r) => r.entry.id === entry.id)!;

    expect(top).toBeDefined();
    expect(top.factors.source_channels).toBeDefined();
    expect(top.why_retrieved).toBeDefined();
    expect(top.why_retrieved!.some((token) => token.startsWith("source:"))).toBe(true);
  });

  describe("T-315: LangMem Logarithmic Frequency Rank Axis", () => {
    it("returns frequencyScore = 0 when access_count = 0", () => {
      const entry = propose(store, {
        title: "Fresh Unaccessed Memory",
        content: "New pattern not yet accessed",
        project: "test-proj",
        type: "fix",
      });

      const ctx: ScoreContext = {
        now: Date.now(),
        workspaceRoot: testDir,
      };

      const factors = computeFactors(entry, ["pattern"], ctx);
      expect(factors.frequencyScore).toBe(0);
    });

    it("computes logarithmic frequency score for moderate access counts (5 accesses ≈ 0.11)", () => {
      const entry = propose(store, {
        title: "Moderately Accessed Memory",
        content: "Pattern accessed several times",
        project: "test-proj",
        type: "fix",
      });
      entry.access_count = 5;

      const ctx: ScoreContext = {
        now: Date.now(),
        workspaceRoot: testDir,
      };

      const factors = computeFactors(entry, ["pattern"], ctx);
      expect(factors.frequencyScore).toBeGreaterThanOrEqual(0.10);
      expect(factors.frequencyScore).toBeLessThanOrEqual(0.15);
    });

    it("weights successful applications 2x compared to passive access counts", () => {
      const passiveEntry = propose(store, {
        title: "Passively Retrieved Memory",
        content: "Pattern retrieved 10 times but not verified",
        project: "test-proj",
        type: "fix",
      });
      passiveEntry.access_count = 10;

      const appliedEntry = propose(store, {
        title: "Actively Applied Memory",
        content: "Pattern retrieved 5 times with 5 successful applications",
        project: "test-proj",
        type: "fix",
      });
      appliedEntry.access_count = 5;
      appliedEntry.utility = {
        retrieval_count: 5,
        application_count: 5,
        successful_applications: 5,
        failed_applications: 0,
        regressions: 0,
        contradictions: 0,
        reuse_success_rate: 1.0,
      };

      const ctx: ScoreContext = {
        now: Date.now(),
        workspaceRoot: testDir,
      };

      const passiveFactors = computeFactors(passiveEntry, ["pattern"], ctx);
      const appliedFactors = computeFactors(appliedEntry, ["pattern"], ctx);

      // Applied entry has effectiveCount = 5 + 2 * 5 = 15 > 10, so frequencyScore must be higher
      expect(appliedFactors.frequencyScore!).toBeGreaterThan(passiveFactors.frequencyScore!);
    });

    it("smoothly caps base frequency score at 0.25 when access_count >= 50", () => {
      const entry = propose(store, {
        title: "Heavily Accessed Core Utility",
        content: "Pattern accessed over 100 times",
        project: "test-proj",
        type: "architecture",
      });
      entry.access_count = 150;

      const ctx: ScoreContext = {
        now: Date.now(),
        workspaceRoot: testDir,
      };

      const factors = computeFactors(entry, ["pattern"], ctx);
      // With 150 accesses and without 7-day recency bonus, capped at 0.25
      expect(factors.frequencyScore).toBe(0.25);
    });

    it("emits freq:high in why_retrieved when frequencyScore > 0.15", () => {
      const entry = propose(store, {
        title: "High Frequency Memory",
        content: "Frequently retrieved pattern in store",
        project: "test-proj",
        type: "architecture",
      });
      entry.access_count = 35;

      const ctx: ScoreContext = {
        now: Date.now(),
        workspaceRoot: testDir,
      };

      const scoreResult = calculateMultiFactorScore(entry, ["frequently", "pattern"], {
        now: ctx.now,
        workspaceRoot: testDir,
      });

      expect(scoreResult.why_retrieved).toContain("freq:high");
    });
  });
});
