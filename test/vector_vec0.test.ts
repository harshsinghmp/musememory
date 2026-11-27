/**
 * Issue #497 — focused tests for the sqlite-vec `vec0` vector index.
 *
 * The whole-file index.json rewrite is gone from `save()`; these tests pin the
 * three properties that replaced it (write, delete, KNN read), the lazy backfill
 * for stores written before the extension was available, and the promise that
 * the JSON/cosine path still answers when the extension cannot load.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { openStore, propose, deleteEntry } from "../src/store.ts";
import {
  DIMS,
  embed,
  cosineSimilarity,
  hybridSearch,
  indexedText,
  indexFilePath,
  rebuildIndex,
  saveIndex,
  vectorIndexSize,
  hasVectorIndex,
} from "../src/vector.ts";
import { getVecIndex, setVecLoaderMode, vecCount, vecKnn, VEC_TABLE } from "../src/vector/vec-index.ts";
import { makeTempRoot, cleanup } from "./helpers.ts";

function setup() {
  const root = makeTempRoot();
  const memoryDir = join(root, ".memory");
  const store = openStore(memoryDir);
  return { root, memoryDir, store };
}

const FIXTURE = [
  { title: "Redis cache eviction", content: "allkeys-lru eviction policy for the redis cache cluster", tags: ["redis"] },
  { title: "Redis persistence", content: "append-only file plus rdb snapshots for redis durability", tags: ["redis"] },
  { title: "Dark mode palette", content: "css variables for the dark theme colors", tags: ["ui"] },
  { title: "Docker build cache", content: "multi-stage dockerfile keeps the build layer cache small", tags: ["ci"] },
  { title: "Quantum pottery", content: "aligning a pottery wheel with quantum noise", tags: [] },
  { title: "Postgres pool sizing", content: "connection pool max clients for postgres under load", tags: ["db"] },
];

beforeEach(() => {
  setVecLoaderMode("auto");
});

afterEach(() => {
  setVecLoaderMode("auto");
});

describe("Issue #497: vec0 schema", () => {
  test("the vector table is created at DIMS width", () => {
    const { root, store } = setup();
    expect(DIMS).toBe(256);
    const vec = getVecIndex(store.db!, DIMS)!;
    expect(vec).not.toBeNull();
    expect(vec.table).toBe(VEC_TABLE);
    const row = store.db!
      .query<{ sql: string }>(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get([VEC_TABLE])!;
    expect(row.sql).toContain(`float[${DIMS}]`);
    cleanup(root);
  });
});

describe("Issue #497: write path", () => {
  test("save() indexes the memory and a KNN query returns its row", () => {
    const { root, store } = setup();
    const entry = propose(store, {
      title: "Redis cache eviction",
      content: "allkeys-lru eviction policy",
      project: "aria",
      confirmed: true,
    });
    const vec = getVecIndex(store.db!, DIMS)!;
    expect(vecCount(vec)).toBe(1);
    expect(vecKnn(vec, embed("redis cache eviction policy"), 5).map((h) => h.id)).toEqual([entry.id]);

    // the SQLite-side view of the index agrees with the search-facing helpers
    expect(hasVectorIndex(store, store.memoryDir!)).toBe(true);
    expect(vectorIndexSize(store, store.memoryDir!)).toBe(1);
    cleanup(root);
  });

  test("the semantically closer entry ranks first in vec0 and in hybridSearch", () => {
    const { root, memoryDir, store } = setup();
    const ids: Record<string, string> = {};
    for (const fixture of FIXTURE) {
      ids[fixture.title] = propose(store, { ...fixture, project: "aria", confirmed: true }).id;
    }
    const vec = getVecIndex(store.db!, DIMS)!;
    const query = "redis cache eviction policy";
    expect(vecKnn(vec, embed(query), 3)[0].id).toBe(ids["Redis cache eviction"]);

    const results = hybridSearch(store, memoryDir, query)!;
    expect(results[0].entry.id).toBe(ids["Redis cache eviction"]);
    expect(results[0].cosine).toBeGreaterThan(results[results.length - 1].cosine);
    cleanup(root);
  });

  test("deleteEntry() removes the vector row", () => {
    const { root, store } = setup();
    const keep = propose(store, { title: "Keep me", content: "redis cache notes", project: "aria", confirmed: true });
    const gone = propose(store, { title: "Drop me", content: "quantum pottery wheel", project: "aria", confirmed: true });
    const vec = getVecIndex(store.db!, DIMS)!;
    expect(vecCount(vec)).toBe(2);

    deleteEntry(store, gone.id);
    expect(vecCount(vec)).toBe(1);
    expect(vecKnn(vec, embed("quantum pottery wheel"), 5).map((h) => h.id)).not.toContain(gone.id);
    expect(vecKnn(vec, embed("redis cache notes"), 5).map((h) => h.id)).toEqual([keep.id]);
    cleanup(root);
  });
});

describe("Issue #497: read path", () => {
  test("KNN ordering equals the previous cosine ordering on a small fixture", () => {
    const { root, store } = setup();
    const ids = FIXTURE.map((fixture) => propose(store, { ...fixture, project: "aria", confirmed: true }).id);

    const query = "redis cache eviction policy";
    const qVec = embed(query);

    // The ordering the pre-#497 JSON path produced: cosine over embed(indexedText).
    const byCosine = FIXTURE.map((fixture, i) => ({
      id: ids[i],
      cos: cosineSimilarity(qVec, embed(indexedText(fixture))),
    }))
      .sort((a, b) => b.cos - a.cos)
      .map((e) => e.id);

    const vec = getVecIndex(store.db!, DIMS)!;
    const knn = vecKnn(vec, qVec, FIXTURE.length);
    expect(knn.map((h) => h.id)).toEqual(byCosine);

    const similarities = knn.map((h) => 1 - h.distance);
    expect(similarities).toEqual([...similarities].sort((a, b) => b - a));
    cleanup(root);
  });

  test("hybridSearch scores match the JSON/cosine backend", () => {
    const { root, memoryDir, store } = setup();
    for (const fixture of FIXTURE) propose(store, { ...fixture, project: "aria", confirmed: true });
    // Snapshot for the fallback backend, exactly as a pre-#497 store would have it.
    saveIndex(rebuildIndex(store), memoryDir);

    const query = "redis cache eviction policy";
    const viaVec = hybridSearch(store, memoryDir, query)!;

    setVecLoaderMode("disabled");
    const viaJson = hybridSearch(store, memoryDir, query)!;
    setVecLoaderMode("auto");

    expect(viaJson).not.toBeNull();
    expect(viaVec.length).toBe(viaJson.length);
    expect(viaVec.map((r) => r.entry.id)).toEqual(viaJson.map((r) => r.entry.id));
    for (let i = 0; i < viaVec.length; i++) {
      // float32 storage in vec0 vs float64 in the JSON path
      expect(viaVec[i].cosine).toBeCloseTo(viaJson[i].cosine, 5);
      expect(viaVec[i].bm25).toBeCloseTo(viaJson[i].bm25, 9);
      expect(viaVec[i].score).toBeCloseTo(viaJson[i].score, 5);
    }
    cleanup(root);
  });
});

describe("Issue #497: lazy backfill", () => {
  test("a store written without the extension indexes itself on the first search", () => {
    const { root, memoryDir, store } = setup();
    setVecLoaderMode("disabled");
    const ids = FIXTURE.map((fixture) => propose(store, { ...fixture, project: "aria", confirmed: true }).id);
    // No vec0 table was touched while the loader was off.
    expect(getVecIndex(store.db!, DIMS)).toBeNull();
    setVecLoaderMode("auto");

    const results = hybridSearch(store, memoryDir, "redis cache eviction policy")!;
    expect(results.length).toBe(FIXTURE.length);
    expect(results[0].entry.id).toBe(ids[0]);

    const vec = getVecIndex(store.db!, DIMS)!;
    expect(vecCount(vec)).toBe(FIXTURE.length);
    expect(vecKnn(vec, embed("redis cache eviction policy"), 1)[0].id).toBe(ids[0]);
    cleanup(root);
  });
});

describe("Issue #497: fallback", () => {
  test("with the extension unavailable the JSON path still answers, and writes still land", () => {
    const { root, memoryDir, store } = setup();
    setVecLoaderMode("disabled");
    const entry = propose(store, {
      title: "Redis cache eviction",
      content: "allkeys-lru eviction policy",
      project: "aria",
      confirmed: true,
    });

    // No vec0 backend at all…
    expect(getVecIndex(store.db!, DIMS)).toBeNull();
    // …and no index.json yet, so the pre-existing null contract is intact.
    expect(hybridSearch(store, memoryDir, "redis cache eviction")).toBeNull();
    expect(hasVectorIndex(store, memoryDir)).toBe(false);

    // Building the JSON index restores the shipped behaviour.
    saveIndex(rebuildIndex(store), memoryDir);
    const results = hybridSearch(store, memoryDir, "redis cache eviction")!;
    expect(results.length).toBe(1);
    expect(results[0].entry.id).toBe(entry.id);
    expect(results[0].score).toBeGreaterThan(0);

    // Writes keep maintaining the fallback index incrementally.
    const second = propose(store, { title: "Postgres pool", content: "connection pool sizing", project: "aria", confirmed: true });
    expect(existsSync(indexFilePath(memoryDir))).toBe(true);
    const after = hybridSearch(store, memoryDir, "connection pool sizing")!;
    expect(after[0].entry.id).toBe(second.id);
    cleanup(root);
  });
});
