import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { openStore, propose, markSuperseded } from "../src/store.ts";
import { verifyRuntimeFiles } from "../src/graph.ts";
import { setCurrent } from "../src/current.ts";
import {
  queryContext,
  formatPromptContext,
  scoreEntry,
  sortCandidates,
  tokenize,
  filterByRelevanceThreshold,
} from "../src/retrieval.ts";
import { calculateMultiFactorScore } from "../src/retrieval/ranking.ts";
import { hybridSearch, rebuildIndex, saveIndex } from "../src/vector.ts";
import { setupFixtureRoot, makeTempRoot, cleanup } from "./helpers.ts";

describe("unified context & retrieval engine", () => {
  test("queryContext ranks, filters, and applies token knapsack budget", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const e1 = propose(store, {
      title: "Authentication Token Handling",
      content: "Always use HttpOnly secure cookies for auth session tokens.",
      project: "aria",
      type: "decision",
      confirmed: true,
      tags: ["auth", "security"],
    });

    const e2 = propose(store, {
      title: "Database Indexing Strategy",
      content: "Ensure composite index on tenant_id and created_at.",
      project: "aria",
      type: "architecture",
      confirmed: true,
      tags: ["database", "perf"],
    });

    // Query for auth
    const authRes = queryContext(store, "auth tokens cookies", { project: "aria" });
    expect(authRes.results.length).toBeGreaterThan(0);
    expect(authRes.results[0].entry.id).toBe(e1.id);
    expect(authRes.results[0].score).toBeGreaterThan(0);

    // Query with token budget
    const budgetRes = queryContext(store, "auth database", { tokenBudget: 40, limit: 10 });
    expect(budgetRes.totalTokensUsed).toBeLessThanOrEqual(40);
    expect(budgetRes.results.length).toBe(1);

    cleanup(root);
  });

  test("formatPromptContext outputs structured Markdown with USER.md and CURRENT.md constraints", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const { setUserProfile } = await import("../src/user.ts");

    // Set user profile
    setUserProfile(memoryDir, "# Developer Profile\n- Tone: Ultra terse\n- Prefer strict TypeScript");

    // Set constraint in CURRENT.md
    setCurrent(memoryDir, "Zero-credential leakage policy strictly enforced.", "aria");

    propose(store, {
      title: "API Timeout Limit",
      content: "All downstream HTTP calls must timeout after 5000ms.",
      project: "aria",
      type: "constraint",
      confirmed: true,
      tags: ["http", "network"],
    });

    const formatted = formatPromptContext(store, memoryDir, "timeout limit", { project: "aria" });
    expect(formatted.userProfile).toContain("Developer Profile");
    expect(formatted.constraints.length).toBeGreaterThan(0);
    expect(formatted.markdown).toContain("### User Profile & Preferences (USER.md)");
    expect(formatted.markdown).toContain("Ultra terse");
    expect(formatted.markdown).toContain("### Active Working Constraints (CURRENT.md)");
    expect(formatted.markdown).toContain("Zero-credential leakage policy");
    expect(formatted.markdown).toContain("### Relevant Memories & Learned Patterns");
    expect(formatted.markdown).toContain("API Timeout Limit");
    expect(formatted.markdown).toContain("5000ms");
    expect(formatted.markdown).toContain("Memory Directive: When learning durable facts");

    cleanup(root);
  });

  test("hybridSearch filters superseded, expired, and cross-project candidate rows (T-303)", () => {
    const root = makeTempRoot();
    const memoryDir = join(root, ".memory");
    const store = openStore(memoryDir);
    const past = new Date(Date.now() - 86_400_000).toISOString();

    const live = propose(store, {
      title: "Auth token rotation",
      content: "auth session token rotation happens every 24 hours",
      project: "aria",
      type: "constraint",
      confirmed: true,
    });
    const superseded = propose(store, {
      title: "Auth token rotation legacy",
      content: "auth session token rotation legacy interval",
      project: "aria",
      type: "constraint",
      confirmed: true,
    });
    markSuperseded(store, superseded.id, "newer policy");
    propose(store, {
      title: "Auth token rotation retired",
      content: "auth session token rotation expired policy",
      project: "aria",
      type: "constraint",
      confirmed: true,
      expiresAt: past,
    });
    propose(store, {
      title: "Auth token rotation other project",
      content: "auth session token rotation for borealis",
      project: "borealis",
      type: "constraint",
      confirmed: true,
    });

    saveIndex(rebuildIndex(store), memoryDir);

    const scoped = hybridSearch(store, memoryDir, "auth token rotation", { project: "aria", limit: 10 })!;
    expect(scoped).not.toBeNull();
    expect(scoped.map((r) => r.entry.id)).toEqual([live.id]);

    // Escape hatches still honored, mirroring queryContext semantics.
    const withSuperseded = hybridSearch(store, memoryDir, "auth token rotation", {
      project: "aria",
      includeSuperseded: true,
    })!;
    expect(withSuperseded.map((r) => r.entry.id).sort()).toEqual([live.id, superseded.id].sort());

    cleanup(root);
  });

  /**
   * T-308: get_context ranks with scoreEntry (src/retrieval.ts) and muse_context ranks with
   * calculateMultiFactorScore (src/retrieval/ranking.ts). Both read the same store, so both
   * must produce the same order — the fixed fixture fails if a factor exists on one side only.
   */
  test("both retrieval scorers order a fixed fixture identically (T-308)", () => {
    const root = makeTempRoot();
    const memoryDir = join(root, ".memory");
    const store = openStore(memoryDir);
    const now = Date.now();

    const auth = propose(store, {
      title: "Auth token rotation",
      content: "Rotate the auth token every 24 hours and revoke stale sessions.",
      project: "aria",
      type: "constraint",
      confirmed: true,
      tags: ["auth", "session"],
    });
    const perf = propose(store, {
      title: "Cache warmup on boot",
      content: "Preload hot cache keys right after deploy.",
      project: "aria",
      type: "decision",
      confirmed: true,
    });
    const cache = propose(store, {
      title: "Redis cache invalidation",
      content: "Invalidate the redis cache on every write.",
      project: "aria",
      type: "architecture",
      confirmed: true,
    });
    const styling = propose(store, {
      title: "CSS gradient buttons",
      content: "Use a linear-gradient for the primary button.",
      project: "aria",
      type: "preference",
      confirmed: true,
      tags: ["css", "styling"],
    });
    // Age the redis note so recency has to break the cache/cache tie deterministically.
    cache.updated_at = new Date(now - 120 * 86_400_000).toISOString();

    const entries = [auth, perf, cache, styling];
    const tokens = tokenize("cache auth");
    expect(tokens).toEqual(["cache", "auth"]);

    // get_context ordering primitive (queryContext -> sortCandidates -> scoreEntry).
    const getContextOrder = sortCandidates(entries, tokens, now).map((s) => s.entry.id);
    // muse_context ordering primitive (rankAndRetrieveMemories -> calculateMultiFactorScore).
    const museOrder = entries
      .map((entry) => ({ entry, score: calculateMultiFactorScore(entry, tokens, { now }).score }))
      .sort((a, b) => b.score - a.score)
      .map((s) => s.entry.id);

    expect(getContextOrder).toEqual([auth.id, perf.id, cache.id, styling.id]);
    expect(museOrder).toEqual(getContextOrder);

    cleanup(root);
  });

  test("non-ASCII queries tokenize across scripts and return signal (T-311)", () => {
    const root = makeTempRoot();
    const memoryDir = join(root, ".memory");
    const store = openStore(memoryDir);

    const cjk = propose(store, {
      title: "缓存策略",
      content: "写入数据库之后必须失效缓存条目。",
      project: "aria",
      type: "constraint",
      confirmed: true,
    });
    const cafe = propose(store, {
      title: "Café opening hours",
      content: "The café opens at 8am and closes at 6pm.",
      project: "aria",
      type: "preference",
      confirmed: true,
    });
    const styling = propose(store, {
      title: "CSS gradient buttons",
      content: "Use a linear-gradient for the primary button.",
      project: "aria",
      type: "preference",
      confirmed: true,
    });

    // Letters/numbers across scripts tokenize; accented words stay whole.
    expect(tokenize("缓存策略")).toEqual(["缓存策略"]);
    expect(tokenize("Café au lait")).toEqual(["café", "au", "lait"]);

    const cjkRes = queryContext(store, "缓存策略", { project: "aria" });
    expect(cjkRes.results[0].entry.id).toBe(cjk.id);
    expect(cjkRes.results[0].score).toBeGreaterThan(0);

    const cafeRes = queryContext(store, "café", { project: "aria" });
    const scoreOf = (id: string) => cafeRes.results.find((r) => r.entry.id === id)!.score;
    expect(scoreOf(cafe.id)).toBeGreaterThan(scoreOf(styling.id));

    cleanup(root);
  });

  test("queries with no lexical counterpart stay below the confident-match bar (T-311)", () => {
    const root = makeTempRoot();
    const memoryDir = join(root, ".memory");
    const store = openStore(memoryDir);
    const now = Date.now();

    const entry = propose(store, {
      title: "Deployment notes",
      content: "Release train checklist for the deploy window.",
      project: "aria",
      type: "decision",
      confirmed: true,
    });

    // A degenerate query that tokenizes to nothing scores exactly like one that matched nothing.
    const degenerate = tokenize("?? 🙃");
    expect(degenerate).toEqual([]);
    expect(scoreEntry(entry, degenerate, now)).toBeCloseTo(
      scoreEntry(entry, tokenize("zzqqxxnope"), now),
      6,
    );

    // Tokens that exist but hit no entry are honestly reported as "no confident match"
    // instead of falling back to "most recently confirmed".
    const noSignal = queryContext(store, "量子 场论", { project: "aria" });
    expect(tokenize("量子 场论")).toEqual(["量子", "场论"]);
    expect(noSignal.results.map((r) => r.entry.id)).toEqual([entry.id]);
    expect(filterByRelevanceThreshold(noSignal.results)).toEqual([]);

    cleanup(root);
  });

  test("T-021: memoized file verification caches path checks and verdicts across candidates", () => {
    const root = makeTempRoot();
    const memoryDir = join(root, ".memory");
    const store = openStore(memoryDir);
    const now = Date.now();

    // Create an actual file in workspace
    const realFile = join(root, "src", "index.ts");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(realFile, "export const x = 1;");

    const e1 = propose(store, {
      title: "Architecture 1",
      content: "Module A handles data",
      project: "test",
      type: "decision",
      confirmed: true,
      graph: {
        provider: "codegraph",
        affected_paths: ["src/index.ts", "src/missing.ts"],
      },
    });

    const e2 = propose(store, {
      title: "Architecture 2",
      content: "Module B handles data",
      project: "test",
      type: "decision",
      confirmed: true,
      graph: {
        provider: "codegraph",
        affected_paths: ["src/index.ts", "src/missing.ts"],
      },
    });

    // Test verifyRuntimeFiles path cache
    const pathCache = new Map<string, boolean>();
    const verdict1 = verifyRuntimeFiles(e1, root, pathCache);
    expect(verdict1.verdict).toBe("WEAK");
    expect(verdict1.existingPaths).toEqual(["src/index.ts"]);
    expect(verdict1.missingPaths).toEqual(["src/missing.ts"]);
    expect(pathCache.size).toBe(2);
    expect(pathCache.get(realFile)).toBe(true);

    // Call verifyRuntimeFiles on e2 with the same pathCache
    const verdict2 = verifyRuntimeFiles(e2, root, pathCache);
    expect(verdict2.verdict).toBe("WEAK");
    expect(verdict2.existingPaths).toEqual(["src/index.ts"]);

    // Test sortCandidates with workspaceRoot runs through memoized fileVerificationCache
    const scored = sortCandidates([e1, e2], ["data"], now, undefined, root);
    expect(scored.length).toBe(2);

    cleanup(root);
  });
});

