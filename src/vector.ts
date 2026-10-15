import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "./store.ts";
import { list } from "./store.ts";
import { tokenize, isExpired, safeMax } from "./retrieval.ts";
import { softOrFusion } from "./retrieval/ranking.ts";
import type { MemoryEntry } from "./types.ts";

const DIMS = 256;

/** BM25 parameters (standard defaults). */
const K1 = 1.5;
const B = 0.75;

export interface IndexedEntry {
  /** L2-normalized hashed trigram embedding. */
  vector: number[];
  /** Term frequencies over word tokens. */
  tf: Record<string, number>;
  /** Total term count (for BM25 length normalization). */
  len: number;
}

export interface VectorIndex {
  version: 1;
  entries: Record<string, IndexedEntry>;
}

export function indexFilePath(memoryDir: string): string {
  return join(memoryDir, "index.json");
}

/** Deterministic FNV-1a hash → trigram bucket. */
function hashTrigram(tri: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < tri.length; i++) {
    h ^= tri.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(h) % DIMS;
}

/**
 * Hashed char-trigram bag projected to a fixed 256-dim vector, L2-normalized.
 * Fully deterministic and offline — same text always yields the same vector.
 */
export function embed(text: string): number[] {
  const normalized = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const vec = new Array<number>(DIMS).fill(0);
  for (let i = 0; i + 3 <= normalized.length; i++) {
    vec[hashTrigram(normalized.slice(i, i + 3))]++;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  return norm > 0 ? vec.map((v) => v / norm) : vec;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < DIMS; i++) dot += a[i] * b[i];
  return dot; // both inputs are L2-normalized
}

export function termFrequencies(text: string): { tf: Record<string, number>; len: number } {
  const tf: Record<string, number> = {};
  let len = 0;
  for (const t of tokenize(text)) {
    tf[t] = (tf[t] ?? 0) + 1;
    len++;
  }
  return { tf, len };
}

/** Build a full index over the store. ponytail: O(n) full rebuild every time — fine to ~10k entries; switch to incremental per-entry upserts if stores grow past that. */
export function rebuildIndex(store: Store): VectorIndex {
  const index: VectorIndex = { version: 1, entries: {} };
  for (const e of list(store)) {
    const text = `${e.title} ${e.content} ${(e.tags ?? []).join(" ")}`;
    const { tf, len } = termFrequencies(text);
    index.entries[e.id] = { vector: embed(text), tf, len };
  }
  return index;
}

export function saveIndex(index: VectorIndex, memoryDir: string): void {
  if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });
  writeFileSync(indexFilePath(memoryDir), JSON.stringify(index), "utf8");
}

export function loadIndex(memoryDir: string): VectorIndex | null {
  const p = indexFilePath(memoryDir);
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as VectorIndex;
    return parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

/** Classic BM25 of the query against one indexed entry, given corpus stats. */
export function bm25Score(queryTf: Record<string, number>, entry: IndexedEntry, idf: Record<string, number>, avgLen: number): number {
  let score = 0;
  for (const [term, qCount] of Object.entries(queryTf)) {
    const f = entry.tf[term];
    if (!f) continue;
    const idfTerm = idf[term] ?? 0;
    score += idfTerm * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (entry.len / Math.max(1, avgLen)))));
    void qCount;
  }
  return score;
}

interface IdfCacheEntry {
  updated_at?: string;
  count: number;
  result: { idf: Record<string, number>; avgLen: number };
}

const idfCache = new WeakMap<VectorIndex, IdfCacheEntry>();

export function inverseDocumentFrequencies(index: VectorIndex): { idf: Record<string, number>; avgLen: number } {
  const cached = idfCache.get(index);
  const entryCount = Object.keys(index.entries).length;
  if (cached && cached.updated_at === index.updated_at && cached.count === entryCount) {
    return cached.result;
  }

  const total = entryCount || 1;
  const df: Record<string, number> = {};
  let lenSum = 0;
  for (const e of Object.values(index.entries)) {
    lenSum += e.len ?? 0;
    for (const term of Object.keys(e.tf)) df[term] = (df[term] ?? 0) + 1;
  }
  const idf: Record<string, number> = {};
  for (const [term, count] of Object.entries(df)) {
    idf[term] = Math.log(1 + (total - count + 0.5) / (count + 0.5));
  }
  const result = { idf, avgLen: lenSum / total };
  idfCache.set(index, {
    updated_at: index.updated_at,
    count: entryCount,
    result,
  });
  return result;
}

export interface HybridResult {
  entry: MemoryEntry;
  score: number;
  cosine: number;
  bm25: number;
}

export interface HybridSearchOptions {
  limit?: number;
  /** Restrict candidate rows to this project (undefined = cross-project search). */
  project?: string;
  includeSuperseded?: boolean;
  includeArchived?: boolean;
  includeExpired?: boolean;
  /** Clock for expiry evaluation; defaults to Date.now(). */
  now?: number;
  /** Fusion strategy: 'linear' (default for legacy compatibility) or 'soft_or' (T-114). */
  fusion?: "linear" | "soft_or";
}

/**
 * Row-level lifecycle/project gate (T-303). Applied to candidate rows BEFORE fusion so
 * superseded/archived/expired and cross-project entries never influence ranking or context.
 * Mirrors queryContext semantics so both backends expose the same behaviour.
 */
function passesRowFilter(entry: MemoryEntry, o: HybridSearchOptions, now: number): boolean {
  if (o.project && entry.project !== o.project) return false;
  if (!o.includeSuperseded && (entry.status === "superseded" || entry.status === "rejected")) return false;
  if (!o.includeArchived && entry.status === "archived") return false;
  if (!o.includeExpired && isExpired(entry, now)) return false;
  return true;
}

/**
 * Hybrid search: 0.5 * cosine(hashed-trigram embedding) + 0.5 * bm25_norm.
 * Returns results sorted by fused score desc. Returns null when no index
 * exists yet so callers can fall back to live scoring with a reindex hint.
 */
export function hybridSearch(
  store: Store,
  memoryDir: string,
  query: string,
  options: HybridSearchOptions = {},
): HybridResult[] | null {
  const index = loadIndex(memoryDir);
  if (!index) return null;

  const now = options.now ?? Date.now();
  const qVec = embed(query);
  const { tf: qTf } = termFrequencies(query);
  const { idf, avgLen } = inverseDocumentFrequencies(index);

  const byId = new Map(list(store).map((e) => [e.id, e]));
  const results: HybridResult[] = [];

  // First pass: raw scores (needed for bm25 max-normalization)
  const scored: { entry: MemoryEntry; indexed: IndexedEntry; cosine: number; bm25: number }[] = [];
  for (const [id, indexed] of Object.entries(index.entries)) {
    const entry = byId.get(id);
    if (!entry) continue;
    if (!passesRowFilter(entry, options, now)) continue;
    scored.push({
      entry,
      indexed,
      cosine: cosineSimilarity(qVec, indexed.vector),
      bm25: bm25Score(qTf, indexed, idf, avgLen),
    });
  }
  const maxBm25 = safeMax(scored.map((s) => s.bm25), Number.EPSILON);

  const useSoftOr = options.fusion === "soft_or";
  for (const s of scored) {
    const pv = Math.max(0, s.cosine);
    const pl = Math.max(0, maxBm25 > 0 ? s.bm25 / maxBm25 : 0);
    const score = useSoftOr ? softOrFusion(pv, pl) : 0.5 * s.cosine + 0.5 * (s.bm25 / maxBm25);
    results.push({
      entry: s.entry,
      cosine: s.cosine,
      bm25: s.bm25,
      score,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, options.limit ?? 10);
}
