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
  applicability,
  getEntryTokenSet,
  invalidateEntryTokenSet,
  clampLimit,
  calculateSymbolSpecificity,
  GENERIC_COMMON_SYMBOLS,
  computeFactors,
  matchesWordBoundary,
  evaluateAbstentionGate,
} from "../src/retrieval.ts";
import { calculateMultiFactorScore } from "../src/retrieval/ranking.ts";
import { RetrievalEngine } from "../src/retrieval/engine.ts";
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

  test("T-022: precomputed token sets per memory avoid per-query retokenization", () => {
    const root = makeTempRoot();
    const memoryDir = join(root, ".memory");
    const store = openStore(memoryDir);

    const entry = propose(store, {
      title: "Postgres Connection Pool Tuning",
      content: "Ensure max pool size is 20 and idle timeout is 10000ms.",
      project: "aria",
      type: "decision",
      confirmed: true,
      tags: ["postgres", "database"],
      graph: {
        provider: "codegraph",
        symbol_names: ["createPool"],
      },
    });

    // 1. First call computes and caches token set
    const set1 = getEntryTokenSet(entry);
    expect(set1.has("postgres")).toBe(true);
    expect(set1.has("pool")).toBe(true);
    expect(set1.has("tuning")).toBe(true);
    expect(set1.has("createpool")).toBe(true);

    // 2. Subsequent call returns the exact same cached reference
    const set2 = getEntryTokenSet(entry);
    expect(set2).toBe(set1);

    // 3. applicability uses cached set
    const score = applicability(entry, ["postgres", "tuning"]);
    expect(score).toBe(1.0);

    const partialScore = applicability(entry, ["postgres", "unknown"]);
    expect(partialScore).toBe(0.5);

    // 4. Invalidation clears cache and forces re-computation
    invalidateEntryTokenSet(entry);
    const set3 = getEntryTokenSet(entry);
    expect(set3).not.toBe(set1);
    expect(set3.has("postgres")).toBe(true);

    cleanup(root);
  });

  test("T-062: clampLimit sanitizes and bounds model-supplied limit inputs", () => {
    // 1. Defaults and fallbacks
    expect(clampLimit(undefined, 10)).toBe(10);
    expect(clampLimit(null, 10)).toBe(10);
    expect(clampLimit("invalid", 10)).toBe(10);
    expect(clampLimit(NaN, 10)).toBe(10);

    // 2. Clamping bounds
    expect(clampLimit(-10, 10, 100, 1)).toBe(1);
    expect(clampLimit(0, 10, 100, 1)).toBe(1);
    expect(clampLimit(50, 10, 100, 1)).toBe(50);
    expect(clampLimit(999999, 10, 100, 1)).toBe(100);

    // 3. String numeric parsing and float flooring
    expect(clampLimit("25", 10, 100, 1)).toBe(25);
    expect(clampLimit(15.9, 10, 100, 1)).toBe(15);

    // 4. queryContext limit clamping integration
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    // Negative limit clamped to 1
    const resNegative = queryContext(store, "test", { limit: -5 });
    expect(resNegative.results.length).toBeLessThanOrEqual(1);

    // Zero limit clamped to 1
    const resZero = queryContext(store, "test", { limit: 0 });
    expect(resZero.results.length).toBeLessThanOrEqual(1);

    cleanup(root);
  });

  test("T-064: read-path stale:true provenance tag for degraded/cache reads", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    // 1. Live normal read-path
    const resLive = queryContext(store, "auth");
    expect(resLive.source).toBe("live");
    expect(resLive.stale).toBe(false);
    expect(resLive.fromCache).toBe(false);

    // 2. Degraded read-path (circuit breaker open)
    store.circuit?.trip();
    const resDegraded = queryContext(store, "auth");
    expect(resDegraded.source).toBe("degraded");
    expect(resDegraded.stale).toBe(true);

    // Reset circuit
    store.circuit?.reset();
    expect(store.circuit?.isDegraded()).toBe(false);

    // 3. FormattedContext cache provenance
    const ctxLive = formatPromptContext(store, memoryDir, "auth");
    expect(ctxLive.fromCache).toBe(false);
    expect(ctxLive.stale).toBe(false);

    // Second call hits cache
    const ctxCached = formatPromptContext(store, memoryDir, "auth");
    expect(ctxCached.fromCache).toBe(true);
    expect(ctxCached.stale).toBe(false);

    // 4. RetrievalEngine fallback degraded reads
    // Requesting tree search when no tree index exists falls back to exact with stale: true
    const engineRes = RetrievalEngine.search(store, memoryDir, "auth", { mode: "tree" });
    expect(engineRes.mode).toBe("exact");
    expect(engineRes.stale).toBe(true);
    expect(engineRes.explanation).toContain("Degraded read: requested tree search");

    // Requesting hybrid search when no vector index exists falls back to exact with stale: true
    const hybridRes = RetrievalEngine.search(store, memoryDir, "auth", { mode: "hybrid" });
    expect(hybridRes.mode).toBe("exact");
    expect(hybridRes.stale).toBe(true);
    expect(hybridRes.explanation).toContain("Degraded read: requested hybrid vector index");

    cleanup(root);
  });

  test("T-309: calculateSymbolSpecificity downweights generic symbols and rewards specific identifiers", () => {
    // 1. Falsy and stopwords
    expect(calculateSymbolSpecificity("")).toBe(0);
    expect(calculateSymbolSpecificity("the")).toBe(0);
    expect(calculateSymbolSpecificity("for")).toBe(0);

    // 2. Generic verbs and ultra-short
    expect(GENERIC_COMMON_SYMBOLS.has("get")).toBe(true);
    expect(calculateSymbolSpecificity("get")).toBe(0.05);
    expect(calculateSymbolSpecificity("set")).toBe(0.05);
    expect(calculateSymbolSpecificity("run")).toBe(0.05);
    expect(calculateSymbolSpecificity("db")).toBe(0.05);
    expect(calculateSymbolSpecificity("foo")).toBe(0.15);

    // 3. Compound identifiers (snake_case, camelCase, dotted)
    expect(calculateSymbolSpecificity("SessionManager")).toBe(1.0);
    expect(calculateSymbolSpecificity("auth_token")).toBe(1.0);
    expect(calculateSymbolSpecificity("jwt.verify")).toBe(1.0);
    expect(calculateSymbolSpecificity("handleClick")).toBe(1.0);

    // 4. Length-based specificity
    expect(calculateSymbolSpecificity("database")).toBe(0.85); // length 8
    expect(calculateSymbolSpecificity("token")).toBe(0.60);    // length 5
    expect(calculateSymbolSpecificity("rate")).toBe(0.35);     // length 4
  });

  test("T-309: computeFactors applies IDF-weighted symbol matching rather than flat 1.0", () => {
    const entryGeneric = {
      id: "mem-generic",
      title: "How to get records",
      content: "Call `get` to read value.",
      project: "aria",
      type: "decision",
      confirmed: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any;

    const entrySpecific = {
      id: "mem-specific",
      title: "Session token rotation",
      content: "Use `SessionManager` for rotation.",
      project: "aria",
      type: "decision",
      confirmed: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any;

    const now = Date.now();
    // Query containing generic verb "get"
    const factorsGeneric = computeFactors(entryGeneric, ["get", "records"], { now });
    // exactSymbolMatch should be downweighted (0.05) instead of binary 1.0
    expect(factorsGeneric.exactSymbolMatch).toBe(0.05);

    // Query containing specific compound identifier "SessionManager"
    const factorsSpecific = computeFactors(entrySpecific, ["SessionManager", "rotation"], { now });
    expect(factorsSpecific.exactSymbolMatch).toBe(1.0);

    // Query containing lowercased "sessionmanager" (length >= 8) awards 0.85
    const factorsLower = computeFactors(entrySpecific, ["sessionmanager", "rotation"], { now });
    expect(factorsLower.exactSymbolMatch).toBe(0.85);

    // Explicit ctx.targetSymbol preserves 1.0 even for generic symbol
    const factorsExplicit = computeFactors(entryGeneric, ["records"], {
      now,
      targetSymbol: "get",
    });
    expect(factorsExplicit.exactSymbolMatch).toBe(1.0);
  });

  test("T-310: matchesWordBoundary prevents substring false positives (race⊂trace, port⊂report)", () => {
    // 1. Exact vs substring containment
    expect(matchesWordBoundary("Fix stack trace in logger", "race")).toBe(false);
    expect(matchesWordBoundary("Fix async race condition in lock", "race")).toBe(true);

    expect(matchesWordBoundary("Generate quarterly report", "port")).toBe(false);
    expect(matchesWordBoundary("Bind server to port 8080", "port")).toBe(true);

    expect(matchesWordBoundary("Deadlock prevention in sqlite", "lock")).toBe(false);
    expect(matchesWordBoundary("Acquire mutex lock on file", "lock")).toBe(true);
    expect(matchesWordBoundary("Avoid blocking main thread", "lock")).toBe(false);

    // 2. Boundary edge cases: string start, string end, punctuation
    expect(matchesWordBoundary("race condition", "race")).toBe(true);
    expect(matchesWordBoundary("the race", "race")).toBe(true);
    expect(matchesWordBoundary("a 'race' hazard", "race")).toBe(true);
    expect(matchesWordBoundary("race: fix immediately", "race")).toBe(true);

    // 3. Case insensitivity
    expect(matchesWordBoundary("Fix Race Condition", "race")).toBe(true);
    expect(matchesWordBoundary("fix race condition", "Race")).toBe(true);

    // 4. Empty / invalid arguments
    expect(matchesWordBoundary("", "race")).toBe(false);
    expect(matchesWordBoundary("race condition", "")).toBe(false);
    expect(matchesWordBoundary(null as any, "race")).toBe(false);
    expect(matchesWordBoundary("race condition", null as any)).toBe(false);
  });

  test("T-072: evaluateAbstentionGate matches FTS5 tokenization to abstain early", () => {
    // 1. Empty and whitespace queries
    expect(evaluateAbstentionGate("").abstain).toBe(true);
    expect(evaluateAbstentionGate("   ").abstain).toBe(true);
    expect(evaluateAbstentionGate(null as any).abstain).toBe(true);

    // 2. Trivial greetings
    expect(evaluateAbstentionGate("hi").abstain).toBe(true);
    expect(evaluateAbstentionGate("hello").reason).toBe("trivial_greeting");
    expect(evaluateAbstentionGate("hey there!").abstain).toBe(true);
    expect(evaluateAbstentionGate("thanks").abstain).toBe(true);

    // 3. Hostile FTS syntax or no searchable terms
    expect(evaluateAbstentionGate("AND OR NOT").abstain).toBe(true);
    expect(evaluateAbstentionGate("AND OR NOT").reason).toBe("fts_no_searchable_terms");
    expect(evaluateAbstentionGate("~ ^ * : { } ( )").abstain).toBe(true);

    // 4. Stopwords only
    expect(evaluateAbstentionGate("is it or not").abstain).toBe(true);
    expect(evaluateAbstentionGate("is it or not").reason).toBe("stopwords_only");
    expect(evaluateAbstentionGate("about above after").reason).toBe("stopwords_only");

    // 5. Legitimate queries pass cleanly
    const pass1 = evaluateAbstentionGate("auth token validation");
    expect(pass1.abstain).toBe(false);
    expect(pass1.searchableTerms).toContain("auth");

    const pass2 = evaluateAbstentionGate("SessionManager connection pool");
    expect(pass2.abstain).toBe(false);

    const pass3 = evaluateAbstentionGate("`jwt.verify`");
    expect(pass3.abstain).toBe(false);
  });

  test("T-073: no_confident_match result mode across queryContext and formatPromptContext", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    propose(store, {
      title: "PostgreSQL Migration Strategy",
      content: "Always run migrations using zero-downtime expand-and-contract pattern with foreign key checks disabled.",
      project: "billing",
      confirmed: true,
      salience: 0.9,
    });

    // 1. Confident query match
    const confident = queryContext(store, "PostgreSQL migration expand-and-contract");
    expect(confident.mode).toBe("confident_match");
    expect(confident.no_confident_match).toBe(false);
    expect(confident.results.length).toBeGreaterThan(0);

    const formattedConfident = formatPromptContext(store, undefined, "PostgreSQL migration expand-and-contract");
    expect(formattedConfident.mode).toBe("confident_match");
    expect(formattedConfident.no_confident_match).toBe(false);
    expect(formattedConfident.markdown).toContain("PostgreSQL Migration Strategy");
    expect(formattedConfident.markdown).not.toContain("_No confident prior memories matched this query._");

    // 2. Query with no matches or below confidence threshold
    const nonConfident = queryContext(store, "quantum computing entanglement superconductors");
    expect(nonConfident.mode).toBe("no_confident_match");
    expect(nonConfident.no_confident_match).toBe(true);

    const formattedNonConfident = formatPromptContext(store, undefined, "quantum computing entanglement superconductors");
    expect(formattedNonConfident.mode).toBe("no_confident_match");
    expect(formattedNonConfident.no_confident_match).toBe(true);
    expect(formattedNonConfident.entries.length).toBeGreaterThanOrEqual(1);
    expect(formattedNonConfident.markdown).toContain("_No confident prior memories matched this query._");

    // 3. Empty query returns default confident match when entries exist
    const emptyQuery = queryContext(store, "");
    expect(emptyQuery.mode).toBe("confident_match");
    expect(emptyQuery.no_confident_match).toBe(false);

    cleanup(root);
  });
});




