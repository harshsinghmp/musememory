import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { openStore, propose, list, markSuperseded } from "../src/store.ts";
import { RetrievalEngine } from "../src/retrieval/index.ts";
import { setupFixtureRoot, makeTempRoot, cleanup } from "./helpers.ts";

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

  test("hybrid fusion drops superseded, expired, and cross-project rows at scale (T-303)", () => {
    // The defect is scale-gated (>100 entries routes through hybrid), so the fixture must exceed that bar.
    const root = makeTempRoot();
    const memoryDir = join(root, ".memory");
    const store = openStore(memoryDir);
    const past = new Date(Date.now() - 86_400_000).toISOString();

    // 3 projects x 40 = 120 entries: 20 live, 10 superseded, 10 expired per project.
    for (const project of ["aria", "borealis", "cosmos"]) {
      for (let i = 0; i < 40; i++) {
        const entry = propose(store, {
          title: `${project} deployment pipeline rollout note ${i}`,
          content: `deployment pipeline rollout checklist for release train variant ${i}`,
          project,
          type: "decision",
          confirmed: true,
          ...(i >= 20 ? { expiresAt: past } : {}),
        });
        if (i >= 10 && i < 20) markSuperseded(store, entry.id, "replaced by newer policy");
      }
    }
    expect(list(store).length).toBeGreaterThan(100);
    RetrievalEngine.reindexAll(store, memoryDir);

    const res = RetrievalEngine.search(store, memoryDir, "deployment pipeline rollout", {
      mode: "hybrid",
      project: "aria",
      limit: 10,
    });

    expect(res.mode).toBe("hybrid");
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results.length).toBeLessThanOrEqual(10);
    expect(res.results.every((r) => r.entry.project === "aria")).toBe(true);
    expect(res.results.some((r) => r.entry.status === "superseded")).toBe(false);
    expect(res.results.every((r) => !r.entry.expires_at || Date.parse(r.entry.expires_at) > Date.now())).toBe(true);

    cleanup(root);
  });
});
