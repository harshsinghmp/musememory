import { describe, test, expect } from "bun:test";
import { openStore, propose } from "../src/store.ts";
import { RetrievalEngine } from "../src/retrieval/index.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";

describe("Adaptive RetrievalEngine & Query Planner", () => {
  test("routes exact queries with knapsack budgeting and token estimation", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const res = RetrievalEngine.search(store, memoryDir, "auth token expiry", {
      mode: "exact",
      tokenBudget: 500,
    });

    expect(res.mode).toBe("exact");
    expect(res.results.length).toBeGreaterThanOrEqual(1);
    expect(res.results[0].entry.title).toContain("Auth");
    expect(res.totalTokensUsed).toBeGreaterThan(0);

    cleanup(root);
  });

  test("formatPromptContext injects active constraints, profile, and ranked memories", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const ctx = RetrievalEngine.formatPromptContext(store, memoryDir, "rate limit", {
      project: "aria",
    });

    expect(ctx.markdown).toContain("### User Profile & Preferences");
    expect(ctx.markdown).toContain("### Active Working Constraints");
    expect(ctx.markdown).toContain("### Relevant Memories & Learned Patterns");
    expect(ctx.entries.length).toBeGreaterThanOrEqual(1);

    cleanup(root);
  });

  test("reindexAll rebuilds vector and tree index in one coordinated pass", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const report = RetrievalEngine.reindexAll(store, memoryDir);
    expect(report.vectorEntries).toBeGreaterThanOrEqual(1);
    expect(report.treeShards).toBeGreaterThanOrEqual(1);
    expect(report.timestamp).toBeDefined();

    cleanup(root);
  });
});
