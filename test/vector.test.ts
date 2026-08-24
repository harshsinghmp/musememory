import { describe, test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { openStore, propose, get } from "../src/store.ts";
import { embed, cosineSimilarity, rebuildIndex, saveIndex, loadIndex, hybridSearch, termFrequencies, bm25Score } from "../src/vector.ts";
import { makeTempRoot, cleanup } from "./helpers.ts";

function setup() {
  const root = makeTempRoot();
  const memoryDir = join(root, ".memory");
  const store = openStore(memoryDir);
  return { root, memoryDir, store };
}

describe("hashed embedding", () => {
  test("deterministic and L2-normalized", () => {
    const a = embed("Redis cache eviction policy");
    const b = embed("Redis cache eviction policy");
    expect(a).toEqual(b);
    expect(a.length).toBe(256);
    const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
    expect(embed("").every((v) => v === 0)).toBe(true);
  });

  test("morphological variant scores higher than unrelated text", () => {
    const base = embed("configure the redis cache cluster settings");
    const variant = embed("configuring the redis cache cluster settings");
    const unrelated = embed("quantum pottery wheel alignment");
    expect(cosineSimilarity(base, variant)).toBeGreaterThan(cosineSimilarity(base, unrelated));
    expect(cosineSimilarity(base, variant)).toBeGreaterThan(0.5);
  });
});

describe("BM25", () => {
  test("ranks entries containing query terms above those that do not", () => {
    const hit = { ...termFrequencies("redis cache eviction lru policy"), vector: new Array(256).fill(0) };
    const miss = { ...termFrequencies("dark mode theme colors css"), vector: new Array(256).fill(0) };
    const idf = { redis: 2.5, cache: 2.5, eviction: 3 };
    const avgLen = 6;
    expect(bm25Score({ redis: 1, cache: 1 }, hit, idf, avgLen)).toBeGreaterThan(0);
    expect(bm25Score({ redis: 1, cache: 1 }, miss, idf, avgLen)).toBe(0);
  });
});

describe("index persistence", () => {
  test("save/load roundtrip preserves vectors and term frequencies", () => {
    const { root, memoryDir, store } = setup();
    propose(store, { title: "Redis cache config", content: "allkeys-lru eviction", project: "aria", confirmed: true });
    const index = rebuildIndex(store);
    saveIndex(index, memoryDir);

    const loaded = loadIndex(memoryDir)!;
    expect(loaded.version).toBe(1);
    const ids = Object.keys(loaded.entries);
    expect(ids.length).toBe(1);
    expect(loaded.entries[ids[0]].vector).toEqual(index.entries[ids[0]].vector);
    expect(loaded.entries[ids[0]].tf).toEqual(index.entries[ids[0]].tf);

    cleanup(root);
  });

  test("loadIndex returns null when absent or corrupt", () => {
    const { root, memoryDir, store } = setup();
    expect(loadIndex(memoryDir)).toBeNull();
    require("node:fs").writeFileSync(join(memoryDir, "index.json"), "{broken", "utf8");
    expect(loadIndex(memoryDir)).toBeNull();
    cleanup(root);
  });
});

describe("hybrid fusion search", () => {
  test("relevant entry ranks above unrelated; fusion uses both signals", () => {
    const { root, memoryDir, store } = setup();
    const relevant = propose(store, {
      title: "Redis cache eviction tuning",
      content: "use allkeys-lru eviction for the redis cache",
      project: "aria",
      type: "fix",
      tags: ["redis"],
      confirmed: true,
    });
    propose(store, {
      title: "Dark mode palette rollout",
      content: "css variables for dark theme colors",
      project: "aria",
      type: "fix",
      tags: ["ui"],
      confirmed: true,
    });
    const index = rebuildIndex(store);
    saveIndex(index, memoryDir);

    const results = hybridSearch(store, memoryDir, "redis cache eviction")!;
    expect(results.length).toBe(2);
    expect(results[0].entry.id).toBe(relevant.id);
    expect(results[0].score).toBeGreaterThan(results[1].score);

    // Both fusion components present
    expect(results[0].cosine).toBeGreaterThan(0);
    expect(results[0].bm25).toBeGreaterThan(0);
    // Fused score is the 0.5/0.5 blend of normalized components
    const top = results[0];
    const expected = 0.5 * top.cosine + 0.5 * (top.bm25 / Math.max(...results.map((r) => r.bm25), Number.EPSILON));
    expect(top.score).toBeCloseTo(expected, 6);

    cleanup(root);
  });

  test("stale index entries without matching store entries are ignored", () => {
    const { root, memoryDir, store } = setup();
    propose(store, { title: "Only entry", content: "content here", project: "aria", confirmed: true });
    const index = rebuildIndex(store);
    index.entries["m_9999999999_ghost"] = { vector: new Array(256).fill(0), tf: {}, len: 0 };
    saveIndex(index, memoryDir);

    const results = hybridSearch(store, memoryDir, "content")!;
    expect(results.every((r) => r.entry.id !== "m_9999999999_ghost")).toBe(true);
    cleanup(root);
  });
});
