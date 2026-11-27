/**
 * Issue #519 — deletion reconciliation for the sqlite-vec `vec0` index.
 *
 * `deleteEntry()` removes a row's vector, but three paths still leave an orphan:
 * a crash between the `memories` write and the vec delete, a restored YAML
 * export (the row returns through `save()`, the tombstone does not), and a store
 * opened by an older build. An orphan is returned by the KNN and then dropped by
 * the row fetch, so a page silently shrinks. `reconcileVecIndex()` deletes every
 * `memory_vec` row with no live `memories` row, and `vecKnn()` runs it once per
 * connection before its first KNN.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { openStore, propose, deleteEntry } from "../src/store.ts";
import { DIMS, embed, hybridSearch, rebuildIndex, saveIndex } from "../src/vector.ts";
import {
  getVecIndex,
  reconcileVecIndex,
  setVecLoaderMode,
  toVecBlob,
  VEC_TABLE,
  vecCount,
  vecHas,
  vecKnn,
} from "../src/vector/vec-index.ts";
import { makeTempRoot, cleanup } from "./helpers.ts";

function setup() {
  const root = makeTempRoot();
  const memoryDir = join(root, ".memory");
  const store = openStore(memoryDir);
  return { root, memoryDir, store };
}

/** Insert a vector row directly, the way a crash or a restored export would. */
function insertRawVector(db: NonNullable<ReturnType<typeof openStore>["db"]>, id: string, text: string): void {
  db.run(`INSERT INTO ${VEC_TABLE}(memory_id, embedding) VALUES (?, ?)`, [id, toVecBlob(embed(text))]);
}

beforeEach(() => setVecLoaderMode("auto"));
afterEach(() => setVecLoaderMode("auto"));

describe("Issue #519: reconcileVecIndex", () => {
  test("removes a nonexistent-id orphan and a tombstoned memory's orphan", () => {
    const { root, memoryDir, store } = setup();
    const live = propose(store, {
      title: "Redis cache eviction",
      content: "allkeys-lru eviction policy for the redis cache cluster",
      project: "aria",
      confirmed: true,
    });
    const doomed = propose(store, {
      title: "Quantum pottery",
      content: "aligning a pottery wheel with quantum noise",
      project: "aria",
      confirmed: true,
    });
    const vec = getVecIndex(store.db!, DIMS)!;

    // Orphan 1: no `memories` row at all (restored YAML export / older build).
    insertRawVector(store.db!, "m_orphan_no_such_memory", "redis cache eviction policy");
    // Orphan 2: the memory is tombstoned but `deleteEntry`'s vec delete was lost
    // (crash between the memories write and the vec delete).
    store.db!.run(`UPDATE memories SET deleted_at = ?, deleted_by = ? WHERE id = ?`, [
      new Date().toISOString(),
      "test",
      doomed.id,
    ]);

    expect(vecCount(vec)).toBe(3); // two live/tombstoned rows plus the nonexistent-id orphan

    const results = hybridSearch(store, memoryDir, "redis cache eviction policy")!;
    const ids = results.map((r) => r.entry.id);
    expect(ids).toEqual([live.id]);
    expect(ids).not.toContain(doomed.id);
    expect(ids).not.toContain("m_orphan_no_such_memory");

    // Physically gone, not merely filtered: the next reconcile has nothing left
    // to do and the rows are absent from the vec0 table itself.
    expect(reconcileVecIndex(vec)).toBe(0);
    expect(vecHas(vec, "m_orphan_no_such_memory")).toBe(false);
    expect(vecHas(vec, doomed.id)).toBe(false);
    expect(vecCount(vec)).toBe(1);
    cleanup(root);
  });

  test("a page is not silently shrunk when orphans crowd the KNN window", () => {
    const { root, memoryDir, store } = setup();
    const query = "redis cache eviction policy";
    const live = [
      propose(store, { title: "Redis cache eviction", content: "allkeys-lru eviction policy", project: "aria", confirmed: true }),
      propose(store, { title: "Redis persistence", content: "append-only file plus rdb snapshots", project: "aria", confirmed: true }),
      propose(store, { title: "Postgres pool", content: "connection pool sizing under load", project: "aria", confirmed: true }),
    ];
    const vec = getVecIndex(store.db!, DIMS)!;

    // 300 orphans whose embedding is the query itself: distance 0, so they would
    // occupy the whole 256-wide KNN window and every hit would be dropped by the
    // row fetch, returning an empty page for a store that has three matches.
    const qVec = embed(query);
    for (let i = 0; i < 300; i++) {
      store.db!.run(`INSERT INTO ${VEC_TABLE}(memory_id, embedding) VALUES (?, ?)`, [`m_orphan_${i}`, toVecBlob(qVec)]);
    }

    const results = hybridSearch(store, memoryDir, query, { limit: 3 })!;
    expect(results.length).toBe(3);
    expect(new Set(results.map((r) => r.entry.id))).toEqual(new Set(live.map((e) => e.id)));
    expect(vecCount(vec)).toBe(3);
    cleanup(root);
  });

  test("runs once per connection: later orphans wait for the next open or a manual call", () => {
    const { root, store } = setup();
    const entry = propose(store, {
      title: "Redis cache eviction",
      content: "allkeys-lru eviction policy",
      project: "aria",
      confirmed: true,
    });
    const vec = getVecIndex(store.db!, DIMS)!;

    // First KNN of this connection reconciles (nothing to do yet)…
    expect(vecKnn(vec, embed("redis cache eviction"), 5).map((h) => h.id)).toEqual([entry.id]);
    // …so a row that goes stale afterwards is not re-scanned on every query.
    insertRawVector(store.db!, "m_orphan_late", "redis cache eviction");
    expect(vecKnn(vec, embed("redis cache eviction"), 5).map((h) => h.id)).toContain("m_orphan_late");

    // The next store open (or an explicit reconcile) clears it.
    expect(reconcileVecIndex(vec)).toBe(1);
    expect(vecHas(vec, "m_orphan_late")).toBe(false);
    expect(vecKnn(vec, embed("redis cache eviction"), 5).map((h) => h.id)).toEqual([entry.id]);
    cleanup(root);
  });

  test("a failing reconcile is logged and does not block writes or searches", () => {
    const { root, memoryDir, store } = setup();
    // An index whose table does not exist: the reconciliation statement throws.
    const broken = { db: store.db!, dims: DIMS, table: "memory_vec_missing" };
    expect(reconcileVecIndex(broken)).toBe(0);

    const entry = propose(store, {
      title: "Redis cache eviction",
      content: "allkeys-lru eviction policy",
      project: "aria",
      confirmed: true,
    });
    expect(entry.id).toBeTruthy();
    const results = hybridSearch(store, memoryDir, "redis cache eviction policy")!;
    expect(results[0].entry.id).toBe(entry.id);
    cleanup(root);
  });
});

describe("Issue #519: the normal lifecycle is unchanged", () => {
  test("save, search, delete and search again keep the index in step", () => {
    const { root, memoryDir, store } = setup();
    const keep = propose(store, {
      title: "Redis cache eviction",
      content: "allkeys-lru eviction policy",
      project: "aria",
      confirmed: true,
    });
    const gone = propose(store, {
      title: "Quantum pottery",
      content: "aligning a pottery wheel with quantum noise",
      project: "aria",
      confirmed: true,
    });
    const vec = getVecIndex(store.db!, DIMS)!;

    expect(hybridSearch(store, memoryDir, "redis cache eviction policy")!.map((r) => r.entry.id)).toContain(keep.id);
    deleteEntry(store, gone.id);
    const after = hybridSearch(store, memoryDir, "quantum pottery wheel")!;
    expect(after.map((r) => r.entry.id)).not.toContain(gone.id);
    expect(after.map((r) => r.entry.id)).toContain(keep.id);

    // `deleteEntry` kept the index in step, so reconciliation has nothing to fix.
    expect(reconcileVecIndex(vec)).toBe(0);
    expect(vecCount(vec)).toBe(1);
    cleanup(root);
  });
});

describe("Issue #519: the JSON fallback is unaffected", () => {
  test("with vec0 unavailable, reconcile is a no-op and the JSON path still answers", () => {
    const { root, memoryDir, store } = setup();
    setVecLoaderMode("disabled");
    const entry = propose(store, {
      title: "Redis cache eviction",
      content: "allkeys-lru eviction policy",
      project: "aria",
      confirmed: true,
    });

    expect(getVecIndex(store.db!, DIMS)).toBeNull();
    expect(reconcileVecIndex(null)).toBe(0);
    expect(reconcileVecIndex(undefined)).toBe(0);
    expect(reconcileVecIndex(getVecIndex(store.db!, DIMS))).toBe(0);

    // No index.json yet: the pre-existing null contract is intact.
    expect(hybridSearch(store, memoryDir, "redis cache eviction")).toBeNull();

    saveIndex(rebuildIndex(store), memoryDir);
    const results = hybridSearch(store, memoryDir, "redis cache eviction policy")!;
    expect(results.length).toBe(1);
    expect(results[0].entry.id).toBe(entry.id);

    // Writes still land in the fallback index while the reconciler is inert.
    const second = propose(store, { title: "Postgres pool", content: "connection pool sizing", project: "aria", confirmed: true });
    expect(hybridSearch(store, memoryDir, "connection pool sizing")![0].entry.id).toBe(second.id);
    cleanup(root);
  });
});
