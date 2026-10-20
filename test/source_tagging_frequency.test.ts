import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openStore, propose, confirm, type Store } from "../src/store.ts";
import { compileHotCache, getHotCandidateIds } from "../src/compounding/temporal.ts";
import { computeFactors, calculateMultiFactorScore, type ScoreContext } from "../src/retrieval.ts";
import { rankAndRetrieveMemories } from "../src/retrieval/ranking.ts";

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
});
