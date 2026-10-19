import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, propose, supersede, save, walkLineageBfs, type Store } from "../src/store.ts";
import { flagConflict } from "../src/quality/contradiction.ts";

describe("T-101: Lineage BFS Walker", () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-lineage-bfs-"));
    store = openStore(tmpDir);
  });

  afterEach(() => {
    store.db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("traverses ancestors backwards along supersedes lineage", () => {
    const v1 = propose(store, {
      title: "Storage Engine: In-Memory JSON",
      content: "Initial storage in flat JSON file.",
      project: "engine-proj",
      type: "architecture",
      confirmed: true,
    });

    const v2 = propose(store, {
      title: "Storage Engine: SQLite DB",
      content: "Migrated from JSON to embedded SQLite.",
      project: "engine-proj",
      type: "architecture",
      supersedes: v1.id,
      confirmed: true,
    });

    const v3 = propose(store, {
      title: "Storage Engine: Dual SQLite + YAML Store",
      content: "Enhanced to dual-write SQLite primary with YAML fallback mirror.",
      project: "engine-proj",
      type: "architecture",
      supersedes: v2.id,
      confirmed: true,
    });

    const walk = walkLineageBfs(store, v3.id, { direction: "ancestors" });

    expect(walk.rootId).toBe(v3.id);
    expect(walk.entries.map((e) => e.id)).toEqual([v3.id, v2.id, v1.id]);
    expect(walk.depths[v3.id]).toBe(0);
    expect(walk.depths[v2.id]).toBe(1);
    expect(walk.depths[v1.id]).toBe(2);

    const edgeRelations = walk.edges.map((e) => `${e.from}->${e.to}:${e.relation}`);
    expect(edgeRelations).toContain(`${v3.id}->${v2.id}:supersedes`);
    expect(edgeRelations).toContain(`${v2.id}->${v1.id}:supersedes`);
  });

  test("traverses descendants forwards along superseded_by lineage", () => {
    const v1 = propose(store, {
      title: "Auth: Session Cookies",
      content: "Stateful session cookies with Redis store.",
      project: "auth-proj",
      type: "architecture",
      confirmed: true,
    });

    const v2 = propose(store, {
      title: "Auth: Stateless JWT",
      content: "Stateless JWT bearer tokens with RSA signatures.",
      project: "auth-proj",
      type: "architecture",
      supersedes: v1.id,
      confirmed: true,
    });

    const v3 = propose(store, {
      title: "Auth: Paseto v4 Public Tokens",
      content: "Upgraded from JWT to Paseto v4 with Ed25519 signatures.",
      project: "auth-proj",
      type: "architecture",
      supersedes: v2.id,
      confirmed: true,
    });

    const walk = walkLineageBfs(store, v1.id, { direction: "descendants" });

    expect(walk.rootId).toBe(v1.id);
    expect(walk.entries.map((e) => e.id)).toEqual([v1.id, v2.id, v3.id]);
    expect(walk.depths[v1.id]).toBe(0);
    expect(walk.depths[v2.id]).toBe(1);
    expect(walk.depths[v3.id]).toBe(2);

    const edgeRelations = walk.edges.map((e) => `${e.from}->${e.to}:${e.relation}`);
    expect(edgeRelations).toContain(`${v1.id}->${v2.id}:superseded_by`);
    expect(edgeRelations).toContain(`${v2.id}->${v3.id}:superseded_by`);
  });

  test("traverses bidirectional lineage (both ancestors and descendants)", () => {
    const v1 = propose(store, {
      title: "Cache: In-Memory Map",
      content: "Simple JS Map cache.",
      project: "cache-proj",
      confirmed: true,
    });

    const v2 = propose(store, {
      title: "Cache: LRU Cache with TTL",
      content: "Bounded LRU cache with 60s TTL.",
      project: "cache-proj",
      supersedes: v1.id,
      confirmed: true,
    });

    const v3 = propose(store, {
      title: "Cache: Multi-Tier L0/L1 Cache",
      content: "Process-local L0 with persistent SQLite cache.",
      project: "cache-proj",
      supersedes: v2.id,
      confirmed: true,
    });

    // Walk starting from the middle node v2
    const walk = walkLineageBfs(store, v2.id, { direction: "both" });

    expect(walk.rootId).toBe(v2.id);
    const entryIds = walk.entries.map((e) => e.id);
    expect(entryIds).toContain(v2.id);
    expect(entryIds).toContain(v1.id);
    expect(entryIds).toContain(v3.id);
    expect(walk.depths[v2.id]).toBe(0);
    expect(walk.depths[v1.id]).toBe(1);
    expect(walk.depths[v3.id]).toBe(1);
  });

  test("respects maxDepth boundary", () => {
    const v1 = propose(store, { title: "Step 1", content: "c1", project: "test" });
    const v2 = propose(store, { title: "Step 2", content: "c2", project: "test", supersedes: v1.id });
    const v3 = propose(store, { title: "Step 3", content: "c3", project: "test", supersedes: v2.id });
    const v4 = propose(store, { title: "Step 4", content: "c4", project: "test", supersedes: v3.id });

    const walk = walkLineageBfs(store, v4.id, { direction: "ancestors", maxDepth: 2 });

    expect(walk.entries.map((e) => e.id)).toEqual([v4.id, v3.id, v2.id]);
    expect(walk.entries.map((e) => e.id)).not.toContain(v1.id);
  });

  test("respects limit boundary", () => {
    const v1 = propose(store, { title: "Step 1", content: "c1", project: "test" });
    const v2 = propose(store, { title: "Step 2", content: "c2", project: "test", supersedes: v1.id });
    const v3 = propose(store, { title: "Step 3", content: "c3", project: "test", supersedes: v2.id });

    const walk = walkLineageBfs(store, v3.id, { direction: "ancestors", limit: 2 });
    expect(walk.entries.length).toBe(2);
  });

  test("returns empty entries when root memory does not exist", () => {
    const walk = walkLineageBfs(store, "non-existent-id");
    expect(walk.rootId).toBe("non-existent-id");
    expect(walk.entries).toEqual([]);
    expect(walk.depths).toEqual({});
    expect(walk.edges).toEqual([]);
  });

  test("prevents infinite loops on cyclic lineage edges", () => {
    const a = propose(store, { title: "Cyclic A", content: "ca", project: "test" });
    const b = propose(store, { title: "Cyclic B", content: "cb", project: "test", supersedes: a.id });

    // Artificially inject a cycle: A supersedes B as well
    a.supersedes = b.id;
    a.supersedes_id = b.id;
    save(store, a);

    const walk = walkLineageBfs(store, a.id, { direction: "ancestors" });
    expect(walk.entries.map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
    expect(walk.entries.length).toBe(2);
  });

  test("traverses lateral conflicts when includeConflicts is true", () => {
    const base = propose(store, {
      title: "Concurrency: Mutex Locks",
      content: "Use process-level mutex locks for concurrency.",
      project: "concurrency-proj",
      type: "constraint",
      confirmed: true,
    });

    const conflicting = propose(store, {
      title: "Concurrency: Lockless Atomics",
      content: "Never use mutex locks; use lockless atomic operations.",
      project: "concurrency-proj",
      type: "constraint",
      confirmed: true,
    });

    flagConflict(store, base.id, conflicting.id, "Direct mutual exclusion contradiction");

    // Walk with conflicts disabled (default)
    const withoutConflicts = walkLineageBfs(store, base.id, { includeConflicts: false });
    expect(withoutConflicts.entries.map((e) => e.id)).toEqual([base.id]);

    // Walk with conflicts enabled
    const withConflicts = walkLineageBfs(store, base.id, { includeConflicts: true });
    expect(withConflicts.entries.map((e) => e.id)).toContain(conflicting.id);
    expect(withConflicts.depths[conflicting.id]).toBe(1);

    const conflictEdge = withConflicts.edges.find((e) => e.relation === "conflicts_with");
    expect(conflictEdge).toBeDefined();
    expect(conflictEdge!.from).toBe(base.id);
    expect(conflictEdge!.to).toBe(conflicting.id);
  });

  test("traverses write-time linked edges when includeLinked is true", () => {
    const m1 = propose(store, {
      title: "Telemetry: Prometheus Metrics",
      content: "Metrics exported on :9090/metrics.",
      project: "obs-proj",
    });

    const m2 = propose(store, {
      title: "Telemetry: Grafana Dashboard",
      content: "Dashboard visualizes Prometheus counters.",
      project: "obs-proj",
      linked_memory_ids: [m1.id],
    });

    const walk = walkLineageBfs(store, m2.id, { includeLinked: true });
    expect(walk.entries.map((e) => e.id)).toContain(m1.id);
    expect(walk.depths[m1.id]).toBe(1);

    const linkedEdge = walk.edges.find((e) => e.relation === "linked");
    expect(linkedEdge).toBeDefined();
    expect(linkedEdge!.from).toBe(m2.id);
    expect(linkedEdge!.to).toBe(m1.id);
  });
});
