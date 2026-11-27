/**
 * Issue #497 — micro-benchmark for the vector index move to sqlite-vec.
 *
 * Measures the two paths the change touches on a synthetic store:
 *   1. save()            — one write, formerly an O(n) index.json rewrite
 *   2. hybridSearch()    — vec0 KNN vs the JSON/cosine scan
 *
 * Both are measured through the public API only, and the JSON side is the same
 * code the package shipped before the change (setVecLoaderMode("disabled")).
 *
 *   bun run scripts/bench-vector.ts [entries]
 */
import { existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { openStore, propose } from "../src/store.ts";
import { hybridSearch, rebuildIndex, saveIndex, indexFilePath } from "../src/vector.ts";
import { setVecLoaderMode } from "../src/vector/vec-index.ts";

const COUNT = Number(process.argv[2] ?? 2000);
const ROOT = join(process.env.TMPDIR ?? "/tmp", `muse-bench-vec-${process.pid}`);

const WORDS = [
  "redis", "cache", "eviction", "postgres", "connection", "pool", "docker", "build", "layer",
  "quantum", "pottery", "wheel", "dark", "theme", "css", "token", "rotation", "auth", "vector",
  "index", "sqlite", "memory", "ranking", "bm25", "cosine", "embedding", "trigram", "store",
];

function text(i: number): { title: string; content: string } {
  const a = WORDS[i % WORDS.length];
  const b = WORDS[(i * 7 + 3) % WORDS.length];
  const c = WORDS[(i * 13 + 5) % WORDS.length];
  return {
    title: `${a} ${b} note ${i}`,
    content: `${a} ${b} ${c} configuration notes for item ${i}. ${b} ${c} ${a} follow-up detail ${i}.`,
  };
}

function ms(fn: () => void, runs = 5): number {
  fn(); // warm
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((x, y) => x - y);
  return samples[Math.floor(samples.length / 2)];
}

rmSync(ROOT, { recursive: true, force: true });
const memoryDir = join(ROOT, ".memory");
const store = openStore(memoryDir);

const writes: string[] = [];
for (let i = 0; i < COUNT; i++) {
  const { title, content } = text(i);
  writes.push(propose(store, { title, content, project: "bench", confirmed: true }).id);
}

// ---- 1. save() cost with the vec0 index live ---------------------------------
const queries = ["redis cache eviction", "postgres connection pool", "vector index ranking", "quantum pottery wheel"];
const saveWithVec = ms(() => {
  const i = Math.floor(Math.random() * COUNT);
  const { title, content } = text(i);
  propose(store, { title: `${title} update`, content, project: "bench", confirmed: true });
});
const searchWithVec = ms(() => {
  for (const q of queries) hybridSearch(store, memoryDir, q, { limit: 10 });
});
// Realistic loop: one write, then one query (the query pays any corpus stats
// rebuild the write invalidated).
const writeThenQueryWithVec = ms(() => {
  const i = Math.floor(Math.random() * COUNT);
  const { title, content } = text(i);
  propose(store, { title: `${title} update`, content, project: "bench", confirmed: true });
  hybridSearch(store, memoryDir, queries[0], { limit: 10 });
});

// ---- 2. the same store on the JSON/cosine fallback ---------------------------
setVecLoaderMode("disabled");
const index = rebuildIndex(store);
saveIndex(index, memoryDir); // what the old code rebuilt on every write
const indexBytes = existsSync(indexFilePath(memoryDir)) ? statSync(indexFilePath(memoryDir)).size : 0;

const saveWithJson = ms(() => {
  const i = Math.floor(Math.random() * COUNT);
  const { title, content } = text(i);
  propose(store, { title: `${title} update`, content, project: "bench", confirmed: true });
});
const searchWithJson = ms(() => {
  for (const q of queries) hybridSearch(store, memoryDir, q, { limit: 10 });
});
const writeThenQueryWithJson = ms(() => {
  const i = Math.floor(Math.random() * COUNT);
  const { title, content } = text(i);
  propose(store, { title: `${title} update`, content, project: "bench", confirmed: true });
  hybridSearch(store, memoryDir, queries[0], { limit: 10 });
});
setVecLoaderMode("auto");

console.log(`entries: ${COUNT}`);
console.log(`index.json snapshot: ${(indexBytes / 1024 / 1024).toFixed(2)} MiB`);
console.log(`save()              vec0: ${saveWithVec.toFixed(2)}ms   json: ${saveWithJson.toFixed(2)}ms`);
console.log(`hybridSearch        vec0: ${searchWithVec.toFixed(2)}ms   json: ${searchWithJson.toFixed(2)}ms  (avg of ${queries.length} queries)`);
console.log(`write + 1 query     vec0: ${writeThenQueryWithVec.toFixed(2)}ms   json: ${writeThenQueryWithJson.toFixed(2)}ms`);

rmSync(ROOT, { recursive: true, force: true });
