import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { openStore, propose, list, markSuperseded, deleteEntry, get } from "../src/store.ts";
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

describe("#435 tree-index search resolves hits against the live store", () => {
  test("a GDPR-erased memory is not served from the stale tree index", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const doomed = propose(store, {
      title: "Quokka erasure subject",
      content: "quokka erasure subject matter held in the tree index",
      project: "tree-erasure",
      type: "architecture",
      confirmed: true,
    });

    RetrievalEngine.reindexAll(store, memoryDir);
    const before = RetrievalEngine.search(store, memoryDir, "quokka erasure", { mode: "tree", project: "tree-erasure" });
    expect(before.mode).toBe("tree");
    expect(before.results.map((r) => r.entry.id)).toContain(doomed.id);

    deleteEntry(store, doomed.id, "gdpr erasure");

    // The persisted index still holds the node — the read path must drop it.
    const after = RetrievalEngine.search(store, memoryDir, "quokka erasure", { mode: "tree", project: "tree-erasure" });
    expect(after.results.map((r) => r.entry.id)).not.toContain(doomed.id);
    expect(after.results.length).toBe(0);

    cleanup(root);
  });

  test("a superseded memory is withheld unless includeSuperseded is set", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const entry = propose(store, {
      title: "Wombat policy subject",
      content: "wombat policy subject matter held in the tree index",
      project: "tree-superseded",
      type: "decision",
      confirmed: true,
    });

    RetrievalEngine.reindexAll(store, memoryDir);
    markSuperseded(store, entry.id, "replaced by the newer wombat policy");

    const hidden = RetrievalEngine.search(store, memoryDir, "wombat policy", { mode: "tree", project: "tree-superseded" });
    expect(hidden.results.map((r) => r.entry.id)).not.toContain(entry.id);

    const shown = RetrievalEngine.search(store, memoryDir, "wombat policy", {
      mode: "tree",
      project: "tree-superseded",
      includeSuperseded: true,
    });
    expect(shown.results.map((r) => r.entry.id)).toContain(entry.id);

    cleanup(root);
  });

  test("a live tree hit returns the memory id and its real status, not the node projection", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const entry = propose(store, {
      title: "Numbat pipeline subject",
      content: "numbat pipeline subject matter held in the tree index",
      project: "tree-live",
      type: "architecture",
      confirmed: true,
    });

    RetrievalEngine.reindexAll(store, memoryDir);
    const res = RetrievalEngine.search(store, memoryDir, "numbat pipeline", { mode: "tree", project: "tree-live" });

    expect(res.mode).toBe("tree");
    const hit = res.results.find((r) => r.entry.id === entry.id);
    expect(hit).toBeDefined();
    expect(hit!.entry.id.startsWith("node_")).toBe(false);
    expect(hit!.entry.status).toBe(entry.status);
    expect(hit!.entry.content).toBe(entry.content);
    expect(get(store, hit!.entry.id)?.title).toBe(entry.title);

    cleanup(root);
  });
});
