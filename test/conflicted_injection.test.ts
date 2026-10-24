import { describe, it, expect, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openStore, save } from "../src/store.ts";
import { searchMemoriesFts } from "../src/sqlite.ts";
import { queryContext } from "../src/retrieval.ts";
import { rankAndRetrieveMemories } from "../src/retrieval/ranking.ts";
import { resolveMuseContext } from "../src/orchestrator/context.ts";
import type { MemoryStatus } from "../src/types.ts";

/**
 * T-405 / issue #313 — conflicted memories must not be injected into agent
 * prompts with no badge.
 *
 * Pre-fix defect: every prompt-serving read path filters `superseded`,
 * `rejected`, `archived` and `expired` — but NOT `conflicted`. The soft
 * -0.8 STATUS_PENALTY (src/types.ts) is a rank discount, not a filter, so a
 * memory flagged by the contradiction engine (a known potential falsehood)
 * is still served, unseen and unmarked, into recall results, ranked context
 * tier candidates, fused muse context and the constraint projection.
 *
 * Bar: the Wave-24 scope precedent (single flag honoured at consumer gates,
 * PR #315) — one `includeConflicted` opt-in, default excluded, accepted at
 * every prompt-serving surface that already honours `includeSuperseded`.
 *
 * This corpus is self-contained (not the frozen recall-golden.json corpus,
 * which carries no conflicted entry and must not grow without usage
 * telemetry — T-143 promotion discipline).
 */

const TEST_DIR = join(import.meta.dir, ".tmp_conflicted_injection_test");

describe("T-405: conflicted memories are withheld from prompt-serving paths by default", () => {
  let root: string;
  let store: ReturnType<typeof openStore>;

  const ACTIVE_ID = "t405_active_port";
  const CONFLICTED_ID = "t405_conflicted_port";

  const newStore = () => {
    mkdirSync(TEST_DIR, { recursive: true });
    root = TEST_DIR;
    store = openStore(TEST_DIR);

    const now = new Date().toISOString();
    save(store, {
      id: ACTIVE_ID,
      title: "Auth gateway port is 3000",
      content: "The auth gateway serves on port 3000 (verified in production).",
      type: "discovery",
      status: "active",
      tags: ["networking", "gateway"],
      project: "core",
      created_at: now,
      updated_at: now,
    });

    save(store, {
      id: CONFLICTED_ID,
      title: "Auth gateway port is 8080",
      content: "The auth gateway serves on port 8080 (--conflicted by the contradiction engine).",
      type: "discovery",
      status: "conflicted",
      tags: ["networking", "gateway"],
      project: "core",
      created_at: now,
      updated_at: now,
    });
  };

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("FTS store query hides conflicted rows and counts them as hidden", () => {
    newStore();
    const hits = searchMemoriesFts(store.db!, "port", { limit: 10 });
    const ids = hits.map((h) => h.entry.id);
    expect(ids).not.toContain(CONFLICTED_ID);
    expect(hits.hidden_count).toBe(1);
    expect(ids).toContain(ACTIVE_ID);

    // Opt-in: the operator may still ask for conflicted rows explicitly.
    const opted = searchMemoriesFts(store.db!, "port", { limit: 10, includeConflicted: true });
    expect(opted.map((h) => h.entry.id)).toContain(CONFLICTED_ID);
  });

  it("queryContext excludes conflicted entries from recall output", () => {
    newStore();
    const result = queryContext(store, "port", { limit: 5 });
    const ids = result.results.map((r) => r.entry.id);
    expect(ids).not.toContain(CONFLICTED_ID);
    expect(ids).toContain(ACTIVE_ID);

    // Opt-in symmetric with includeSuperseded.
    const opted = queryContext(store, "port", { limit: 5, includeSuperseded: true, includeConflicted: true });
    expect(opted.results.map((r) => r.entry.id)).toContain(CONFLICTED_ID);
  });

  it("ranked retrieval vetoes conflicted candidates before scoring", async () => {
    newStore();
    const result = await rankAndRetrieveMemories(store, "auth gateway port", { limit: 5, now: Date.now() });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(CONFLICTED_ID);

    const opted = await rankAndRetrieveMemories(store, "auth gateway port", {
      limit: 5,
      now: Date.now(),
      includeSuperseded: true,
      includeConflicted: true,
    });
    expect(JSON.stringify(opted)).toContain(CONFLICTED_ID);
  });

  it("fused muse context never injects conflicted constraints", async () => {
    newStore();
    const fused = await resolveMuseContext(store, root, { query: "auth gateway port", token_budget: 400 });
    const serialized = JSON.stringify(fused);
    expect(serialized).not.toContain(CONFLICTED_ID);
    expect(serialized).toContain(ACTIVE_ID);
  });

  it("an explicit status query asking for conflicted rows still returns them", () => {
    newStore();
    // Producers that query a specific status (audits, conflicts listings,
    // health tools) must keep working — the exclusion is the *default*
    // lifecycle filter, not a ban on reading the status.
    const hits = searchMemoriesFts(store.db!, "port", { limit: 10, status: "conflicted" });
    expect(hits.map((h) => h.entry.id)).toContain(CONFLICTED_ID);
  });

  it("an explicit status query reaches conflicted rows through queryContext too", () => {
    newStore();
    // Critic round 1 (Major #2): the conflicted hide-gate in queryContext must
    // carry the same options.status guard the archived gate already has, or a
    // status-scoped audit query hides the rows it explicitly asked for and
    // returns an unexplained empty result.
    const res = queryContext(store, "port", { limit: 5, status: "conflicted" });
    expect(res.results.map((r) => r.entry.id)).toContain(CONFLICTED_ID);
    expect(res.results.map((r) => r.entry.id)).not.toContain(ACTIVE_ID);
  });

  it("overfetch stays armed when a sibling lifecycle gate remains active", () => {
    newStore();
    const db = store.db!;
    const now = new Date().toISOString();
    const dense = (id: string, title: string, content: string, status: MemoryStatus) =>
      save(store, {
        id,
        title,
        content,
        type: "discovery",
        status,
        tags: ["networking"],
        project: "core",
        created_at: now,
        updated_at: now,
      });

    // Two actives match the query once; the two hidden-class entries match
    // twice (tf=2) so bm25 ranks them INSIDE the limit-2 fetch window. That
    // reproduces the truncation the critic proved: with the window full of
    // rows that a sibling gate will hide, overfetch is the only thing that
    // lets the actives through.
    dense("t405_active_z1", "Zebra deployment notes", "zebra migration notes for the edge cluster", "active");
    dense("t405_active_z2", "Zebra rollout checklist", "zebra rollout checklist for the edge cluster", "active");
    dense("t405_superseded_z", "Zebra migration superseded", "zebra zebra superseded migration notes", "superseded");
    dense("t405_conflicted_z", "Zebra port conflicted", "zebra zebra conflicted port mismatch notes", "conflicted");

    // Opt into superseded (its gate opens) — but the conflicted gate stays
    // active, so overfetch must remain armed or the actives vanish behind the
    // hidden rows filling the limit window. limit=2 with two tf=2 hidden rows
    // means the unfixed connective returns zero actives; which ONE active
    // accompanies the dense rows is bm25 tie-order, so pin membership, not position.
    const opened = searchMemoriesFts(db, "zebra", { limit: 2, includeSuperseded: true });
    const openedIds = opened.map((h) => h.entry.id);
    expect(openedIds.filter((id) => id.startsWith("t405_active_z")).length).toBeGreaterThanOrEqual(1);
    expect(opened.hidden_count).toBeGreaterThanOrEqual(1);

    // Mirror case: opt into conflicted — the superseded gate stays active.
    const mirrored = searchMemoriesFts(db, "zebra", { limit: 2, includeConflicted: true });
    const mirroredIds = mirrored.map((h) => h.entry.id);
    expect(mirroredIds.filter((id) => id.startsWith("t405_active_z")).length).toBeGreaterThanOrEqual(1);

    // Default options: both hidden classes stay out; overfetch guarantees the
    // actives still fill the limit.
    const plain = searchMemoriesFts(db, "zebra", { limit: 2 });
    const plainIds = plain.map((h) => h.entry.id);
    expect(plainIds).toContain("t405_active_z1");
    expect(plainIds).toContain("t405_active_z2");
    expect(plainIds).not.toContain("t405_superseded_z");
    expect(plainIds).not.toContain("t405_conflicted_z");
  });
});
