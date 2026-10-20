import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { openStore, propose, supersede, get, isSuperseded, list } from "../src/store.ts";
import { searchMemoriesFts } from "../src/sqlite.ts";
import { queryContext } from "../src/retrieval.ts";
import { RetrievalEngine } from "../src/retrieval/engine.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("T-096: supersede-not-delete and hidden-count-aware over-fetch", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-supersede-overfetch-"));
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("preserves superseded memory without deletion on supersede()", () => {
    const store = openStore(tmpDir);

    const v1 = propose(store, {
      content: "Node.js v18 engine requirement",
      project: "core",
      title: "Node Engine v18",
      confirmed: true,
    });

    const v2 = propose(store, {
      content: "Node.js v20 engine requirement",
      project: "core",
      title: "Node Engine v20",
      confirmed: true,
    });

    const supersededV1 = supersede(store, v1.id, v2.id, { valid_to_exact: true });
    expect(supersededV1).not.toBeNull();
    expect(isSuperseded(supersededV1!)).toBe(true);

    // Old memory still exists in store and database
    const fetchedOld = get(store, v1.id);
    expect(fetchedOld).not.toBeNull();
    expect(fetchedOld?.status).toBe("superseded");
    expect(fetchedOld?.superseded_by).toContain(v2.id);
    expect(fetchedOld?.valid_to).toBeDefined();
    expect(fetchedOld?.valid_to_exact).toBe(true);
  });

  it("handles supersede-not-delete during propose({ supersedes })", () => {
    const store = openStore(tmpDir);

    const oldRule = propose(store, {
      content: "Use MySQL database for user persistence",
      project: "core",
      title: "DB Architecture Old",
      confirmed: true,
    });

    const newRule = propose(store, {
      content: "Use PostgreSQL database for user persistence",
      project: "core",
      title: "DB Architecture New",
      supersedes: oldRule.id,
      confirmed: true,
    });

    expect(newRule.supersedes).toBe(oldRule.id);

    // Verify oldRule is marked superseded but preserved
    const reloadedOld = get(store, oldRule.id);
    expect(reloadedOld).not.toBeNull();
    expect(isSuperseded(reloadedOld!)).toBe(true);
    expect(reloadedOld?.superseded_by).toContain(newRule.id);
  });

  it("reports hidden_count in queryContext when active lifecycle filters exclude superseded entries", () => {
    const store = openStore(tmpDir);

    const oldMem = propose(store, {
      content: "Legacy deprecated authentication flow",
      project: "auth",
      title: "Legacy Auth",
      confirmed: true,
    });

    const activeMem = propose(store, {
      content: "Modern OAuth2 authentication flow with PKCE",
      project: "auth",
      title: "Modern Auth",
      supersedes: oldMem.id,
      confirmed: true,
    });

    // Query without includeSuperseded
    const res = queryContext(store, "authentication flow", {
      project: "auth",
      includeSuperseded: false,
    });

    expect(res.results.map((r) => r.entry.id)).toContain(activeMem.id);
    expect(res.results.map((r) => r.entry.id)).not.toContain(oldMem.id);
    expect(res.hidden_count).toBeGreaterThanOrEqual(1);

    // Query with includeSuperseded: true
    const resAll = queryContext(store, "authentication flow", {
      project: "auth",
      includeSuperseded: true,
    });
    expect(resAll.results.map((r) => r.entry.id)).toContain(oldMem.id);
    expect(resAll.results.map((r) => r.entry.id)).toContain(activeMem.id);
    expect(resAll.hidden_count).toBe(0);
  });

  it("over-fetches in searchMemoriesFts to fill requested limit despite superseded entries", () => {
    const store = openStore(tmpDir);
    const db = store.db!;

    // Create 3 superseded entries and 2 active entries that all match query "database"
    const s1 = propose(store, { content: "database memory one old", project: "test", title: "DB One" });
    const s2 = propose(store, { content: "database memory two old", project: "test", title: "DB Two" });
    const s3 = propose(store, { content: "database memory three old", project: "test", title: "DB Three" });

    // Mark them superseded
    const a1 = propose(store, { content: "database memory active alpha", project: "test", title: "DB Active Alpha", supersedes: [s1.id, s2.id] });
    const a2 = propose(store, { content: "database memory active beta", project: "test", title: "DB Active Beta", supersedes: [s3.id] });

    // Search FTS with limit = 2.
    // Without overfetch, SQLite LIMIT 2 might return only s1 and s2 (both superseded), returning 0 active results!
    // With hidden-count-aware over-fetch, it fetches buffer, filters out s1/s2/s3, and returns the 2 active entries.
    const hits = searchMemoriesFts(db, "database", {
      project: "test",
      limit: 2,
      includeSuperseded: false,
    });

    expect(hits.length).toBe(2);
    expect(hits.map((h) => h.entry.id)).toContain(a1.id);
    expect(hits.map((h) => h.entry.id)).toContain(a2.id);
    expect(hits.hidden_count).toBeGreaterThanOrEqual(3);
  });

  it("surfaces hidden_count through RetrievalEngine.search", () => {
    const store = openStore(tmpDir);

    const mOld = propose(store, {
      content: "Old cache configuration with memcached",
      project: "cache",
      title: "Cache Old",
    });

    const mNew = propose(store, {
      content: "New cache configuration with dragonfly",
      project: "cache",
      title: "Cache New",
      supersedes: mOld.id,
    });

    const engineRes = RetrievalEngine.search(store, tmpDir, "cache configuration", {
      project: "cache",
      mode: "exact",
    });

    expect(engineRes.hidden_count).toBeGreaterThanOrEqual(1);
    expect(engineRes.results.map((r) => r.entry.id)).toContain(mNew.id);
    expect(engineRes.results.map((r) => r.entry.id)).not.toContain(mOld.id);
  });
});
