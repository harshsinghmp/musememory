import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "./store.ts";
import { list } from "./store.ts";
import { tokenize, isExpired, safeMax } from "./retrieval.ts";
import { softOrFusion } from "./retrieval/ranking.ts";
import {
  type RrfConfig,
  type RrfVariant,
  RRF_PRESETS,
  calculateRrfItemScore,
  resolveRrfConfig,
} from "./retrieval/rrf.ts";
import type { MemoryEntry } from "./types.ts";
import type { SqliteDatabase } from "./sqlite.ts";
import { getContentGeneration } from "./sqlite.ts";
import {
  getVecIndex,
  vecCount,
  vecDelete,
  vecKnn,
  vecMetaGet,
  vecMetaSet,
  vecUpsert,
  vecUpsertMany,
  type VecIndex,
} from "./vector/vec-index.ts";

/** Embedding width. Also the `vec0` column dimension (`embedding float[DIMS]`). */
export const DIMS = 256;

/** BM25 parameters (standard defaults). */
const K1 = 1.5;
const B = 0.75;

export interface IndexedEntry {
  /** L2-normalized hashed trigram embedding. */
  vector: number[];
  /** Term frequencies over word tokens. */
  tf: Record<string, number>;
  /** Total term count (for BM25 length normalization). */
  len?: number;
  magnitude?: number;
  tokens?: string[];
}

export interface VectorIndex {
  version: 1;
  updated_at?: string;
  dimension?: number;
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

/** The exact text a memory is indexed by: title, body and tags. */
export function indexedText(entry: Pick<MemoryEntry, "title" | "content" | "tags">): string {
  return `${entry.title} ${entry.content} ${(entry.tags ?? []).join(" ")}`;
}

/** Build a full index over the store. ponytail: O(n) full rebuild every time — fine to ~10k entries; switch to incremental per-entry upserts if stores grow past that. */
export function rebuildIndex(store: Store): VectorIndex {
  const index: VectorIndex = { version: 1, updated_at: new Date().toISOString(), entries: {} };
  for (const e of list(store)) {
    const text = indexedText(e);
    const { tf, len } = termFrequencies(text);
    index.entries[e.id] = { vector: embed(text), tf, len };
  }
  return index;
}

export function saveIndex(index: VectorIndex, memoryDir: string): void {
  if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });
  writeFileSync(indexFilePath(memoryDir), JSON.stringify(index), "utf8");
}

/**
 * Issue #497 — portability surface. `index.json` is no longer a read path: it is
 * an export/snapshot a human (or another tool) can inspect, diff or carry to a
 * store that cannot load the extension. Regenerating it is always safe because
 * every field is derived from the entries themselves.
 */
export function exportVectorSnapshot(store: Store, memoryDir: string): VectorIndex {
  const index = rebuildIndex(store);
  saveIndex(index, memoryDir);
  return index;
}

/**
 * Issue #497 — is a vector index actually usable for this store?
 * True when the vec0 table holds rows, or when the JSON snapshot exists.
 * Callers use this to gate the hybrid path without knowing which backend won.
 */
export function hasVectorIndex(store: Store, memoryDir: string): boolean {
  const vec = getVecIndex(store.db ?? null, DIMS);
  if (vec && vecCount(vec) > 0) return true;
  return existsSync(indexFilePath(memoryDir));
}

/**
 * Issue #497 — how many vectors the active backend holds, or null when there is
 * no index at all. Lets callers detect a stale index without loading index.json.
 */
export function vectorIndexSize(store: Store, memoryDir: string): number | null {
  const vec = getVecIndex(store.db ?? null, DIMS);
  if (vec) {
    const count = vecCount(vec);
    if (count > 0) return count;
  }
  const index = loadIndex(memoryDir);
  return index ? Object.keys(index.entries).length : null;
}

/**
 * T-304 / Issue #497: keep the vector index in step with one written entry.
 *
 * With the extension loaded this is a single `vec0` upsert and `index.json` is
 * left alone (it is a snapshot, not the read path). Without it, the previous
 * read-modify-write of `index.json` runs unchanged — the fallback stays
 * functional rather than becoming a second-class crash path.
 */
export function upsertIndexEntry(entry: MemoryEntry, memoryDir: string, db?: SqliteDatabase | null): boolean {
  const vec = getVecIndex(db, DIMS);
  if (vec && vecUpsert(vec, entry.id, embed(indexedText(entry)))) return true;

  const p = indexFilePath(memoryDir);
  if (!existsSync(p)) return false;
  try {
    const index = loadIndex(memoryDir);
    if (!index) return false;
    const text = indexedText(entry);
    const { tf, len } = termFrequencies(text);
    index.entries[entry.id] = { vector: embed(text), tf, len };
    index.updated_at = new Date().toISOString();
    saveIndex(index, memoryDir);
    return true;
  } catch {
    return false;
  }
}

/**
 * T-304 / Issue #497: drop one entry's vector on delete or tombstone.
 * vec0 mode deletes the row and does not rewrite the JSON snapshot.
 */
export function removeIndexEntry(id: string, memoryDir: string, db?: SqliteDatabase | null): boolean {
  const vec = getVecIndex(db, DIMS);
  let removedFromVec = false;
  if (vec) removedFromVec = vecDelete(vec, id);

  const p = indexFilePath(memoryDir);
  if (!existsSync(p)) return removedFromVec;
  try {
    const index = loadIndex(memoryDir);
    if (!index || !index.entries[id]) return removedFromVec;
    // vec0 owns the live index; the JSON file is a snapshot and is left as-is.
    if (vec) return removedFromVec;
    delete index.entries[id];
    index.updated_at = new Date().toISOString();
    saveIndex(index, memoryDir);
    return true;
  } catch {
    return removedFromVec;
  }
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
export function bm25Score(queryTf: Record<string, number>, entry: Pick<IndexedEntry, "tf" | "len">, idf: Record<string, number>, avgLen: number): number {
  let score = 0;
  for (const [term, qCount] of Object.entries(queryTf)) {
    const f = entry.tf[term];
    if (!f) continue;
    const idfTerm = idf[term] ?? 0;
    score += idfTerm * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * ((entry.len ?? 0) / Math.max(1, avgLen)))));
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
  /** T-405: include conflicted rows in hybrid search candidates (excluded by default). */
  includeConflicted?: boolean;
  includeArchived?: boolean;
  includeExpired?: boolean;
  /** Clock for expiry evaluation; defaults to Date.now(). */
  now?: number;
  /** Fusion strategy: 'linear' (default for legacy compatibility), 'soft_or' (T-114), or 'rrf' (T-120). */
  fusion?: "linear" | "soft_or" | "rrf";
  /** T-120: RRF configuration when fusion === 'rrf'. */
  rrfConfig?: RrfConfig;
  /** T-120: A/B variant for RRF presets ('A'/'control' vs 'B'/'treatment'). */
  rrfVariant?: RrfVariant;
}

/**
 * Row-level lifecycle/project gate (T-303). Applied to candidate rows BEFORE fusion so
 * superseded/archived/expired and cross-project entries never influence ranking or context.
 * Mirrors queryContext semantics so both backends expose the same behaviour.
 */
function passesRowFilter(entry: MemoryEntry, o: HybridSearchOptions, now: number): boolean {
  if (o.project && entry.project !== o.project) return false;
  if (!o.includeSuperseded && (entry.status === "superseded" || entry.status === "rejected")) return false;
  if (!o.includeConflicted && entry.status === "conflicted") return false;
  if (!o.includeArchived && entry.status === "archived") return false;
  if (!o.includeExpired && isExpired(entry, now)) return false;
  return true;
}

/**
 * Issue #497: raw scored candidate, backend-agnostic. Both the vec0 KNN path and
 * the JSON/cosine fallback produce these, so fusion has exactly one implementation.
 */
interface ScoredCandidate {
  entry: MemoryEntry;
  cosine: number;
  bm25: number;
}

/** BM25 corpus statistics derived from entry text, keyed per store generation. */
interface CorpusStatistics {
  generation: number;
  signature: number;
  idf: Record<string, number>;
  avgLen: number;
  byId: Map<string, { tf: Record<string, number>; len: number }>;
}

const corpusCache = new WeakMap<Store, CorpusStatistics>();

function entriesSignature(entries: MemoryEntry[]): number {
  let h = 0x811c9dc5;
  for (const entry of entries) {
    const s = `${entry.id}:${entry.updated_at}`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

/**
 * Issue #497: the lexical half of hybrid search needs term frequencies for every
 * entry. In vec0 mode there is no index.json to read them from, so they are
 * derived from the entries and cached per (store, content generation).
 */
function corpusStatistics(store: Store, entries: MemoryEntry[]): CorpusStatistics {
  const generation = store.db ? getContentGeneration(store.db) : -1;
  const signature = entriesSignature(entries);
  const cached = corpusCache.get(store);
  if (cached && cached.generation === generation && cached.signature === signature) return cached;

  const byId = new Map<string, { tf: Record<string, number>; len: number }>();
  const df: Record<string, number> = {};
  let lenSum = 0;
  for (const entry of entries) {
    const { tf, len } = termFrequencies(indexedText(entry));
    byId.set(entry.id, { tf, len });
    lenSum += len;
    for (const term of Object.keys(tf)) df[term] = (df[term] ?? 0) + 1;
  }
  const total = entries.length || 1;
  const idf: Record<string, number> = {};
  for (const [term, count] of Object.entries(df)) {
    idf[term] = Math.log(1 + (total - count + 0.5) / (count + 0.5));
  }
  const result: CorpusStatistics = { generation, signature, idf, avgLen: lenSum / total, byId };
  corpusCache.set(store, result);
  return result;
}

const BACKFILL_META_KEY = "backfill_v1";
/** Candidates pulled from vec0 before the lifecycle/project gates narrow the page. */
const KNN_MIN_WINDOW = 256;
const KNN_OVERFETCH = 4;

/**
 * Issue #497: one-time lazy backfill. A store that predates the vec0 table (or
 * was written while the extension was unavailable) has rows but no vectors; the
 * first search builds them from the stored content. Writes never wait for this.
 */
export function ensureVecBackfill(vec: VecIndex, entries: MemoryEntry[]): boolean {
  if (vecMetaGet(vec, BACKFILL_META_KEY) === "done") return false;
  if (entries.length === 0) return false;
  const rows = entries.map((entry) => ({ id: entry.id, vector: embed(indexedText(entry)) }));
  vecUpsertMany(vec, rows);
  if (vecCount(vec) >= rows.length) vecMetaSet(vec, BACKFILL_META_KEY, "done");
  return true;
}

/** vec0 candidate generation: KNN, then the same row gates the JSON path applies. */
function scoreVecCandidates(
  store: Store,
  vec: VecIndex,
  entries: MemoryEntry[],
  qVec: number[],
  qTf: Record<string, number>,
  options: HybridSearchOptions,
  now: number,
  total: number,
  limit: number,
): ScoredCandidate[] {
  const k = Math.min(total, Math.max(limit * KNN_OVERFETCH, KNN_MIN_WINDOW));
  const hits = vecKnn(vec, qVec, k);
  if (hits.length === 0) return [];

  const { idf, avgLen, byId } = corpusStatistics(store, entries);
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const scored: ScoredCandidate[] = [];
  for (const hit of hits) {
    const entry = entriesById.get(hit.id);
    // A vector can outlive its row (hard delete, tombstone, another writer):
    // the entry is the authority, exactly as the JSON path treated `byId`.
    if (!entry || !passesRowFilter(entry, options, now)) continue;
    const stats = byId.get(hit.id);
    if (!stats) continue;
    // vec0's cosine distance is `1 - cosine similarity`, the same number the
    // fallback computes with cosineSimilarity() (float32-rounded).
    const cosine = 1 - hit.distance;
    scored.push({ entry, cosine, bm25: bm25Score(qTf, stats, idf, avgLen) });
  }
  return scored;
}

/** Shared fusion: linear (default), soft-or (T-114) or RRF (T-120). */
function fuseCandidates(scored: ScoredCandidate[], options: HybridSearchOptions): HybridResult[] {
  const limit = options.limit ?? 10;
  if (scored.length === 0) return [];
  const results: HybridResult[] = [];
  const maxBm25 = safeMax(scored.map((s) => s.bm25), Number.EPSILON);

  if (options.fusion === "rrf") {
    const { k, weights } = resolveRrfConfig(
      options.rrfConfig ?? (options.rrfVariant ? { variant: options.rrfVariant } : {}),
    );
    const cosineRanked = [...scored].sort((a, b) => b.cosine - a.cosine);
    const bm25Ranked = [...scored].sort((a, b) => b.bm25 - a.bm25);

    const cosineRanks = new Map<string, number>();
    cosineRanked.forEach((s, idx) => cosineRanks.set(s.entry.id, idx + 1));

    const bm25Ranks = new Map<string, number>();
    bm25Ranked.forEach((s, idx) => bm25Ranks.set(s.entry.id, idx + 1));

    const semWeight = weights.semantic ?? 1.0;
    const lexWeight = weights.lexical ?? 1.0;

    for (const s of scored) {
      const cRank = cosineRanks.get(s.entry.id) ?? 999;
      const bRank = bm25Ranks.get(s.entry.id) ?? 999;
      const score = calculateRrfItemScore(
        [
          { rank: cRank, weight: semWeight, signal: "semantic" },
          { rank: bRank, weight: lexWeight, signal: "lexical" },
        ],
        k,
      );
      results.push({ entry: s.entry, cosine: s.cosine, bm25: s.bm25, score });
    }
  } else {
    const useSoftOr = options.fusion === "soft_or";
    for (const s of scored) {
      const pv = Math.max(0, s.cosine);
      const pl = Math.max(0, maxBm25 > 0 ? s.bm25 / maxBm25 : 0);
      const score = useSoftOr ? softOrFusion(pv, pl) : 0.5 * s.cosine + 0.5 * (s.bm25 / maxBm25);
      results.push({ entry: s.entry, cosine: s.cosine, bm25: s.bm25, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/**
 * Hybrid search: 0.5 * cosine(hashed-trigram embedding) + 0.5 * bm25_norm.
 * Returns results sorted by fused score desc. Returns null when no index
 * exists yet so callers can fall back to live scoring with a reindex hint.
 *
 * Issue #497: candidates come from the vec0 KNN query when the extension is
 * loaded, and from the JSON/cosine scan when it is not. Both paths share the
 * row gates and the fusion stage, so scores and ordering are interchangeable.
 */
export function hybridSearch(
  store: Store,
  memoryDir: string,
  query: string,
  options: HybridSearchOptions = {},
): HybridResult[] | null {
  const now = options.now ?? Date.now();
  const limit = options.limit ?? 10;
  const qVec = embed(query);
  const { tf: qTf } = termFrequencies(query);

  // 1. vec0: one indexed KNN query instead of reading and parsing index.json.
  const vec = getVecIndex(store.db ?? null, DIMS);
  if (vec) {
    const entries = list(store);
    ensureVecBackfill(vec, entries);
    const total = vecCount(vec);
    if (total > 0) {
      return fuseCandidates(scoreVecCandidates(store, vec, entries, qVec, qTf, options, now, total, limit), options);
    }
  }

  // 2. Fallback: the shipped JSON/cosine scan, unchanged.
  const index = loadIndex(memoryDir);
  if (!index) return null;

  const { idf, avgLen } = inverseDocumentFrequencies(index);
  const byId = new Map(list(store).map((e) => [e.id, e]));
  const scored: ScoredCandidate[] = [];
  for (const [id, indexed] of Object.entries(index.entries)) {
    const entry = byId.get(id);
    if (!entry) continue;
    if (!passesRowFilter(entry, options, now)) continue;
    scored.push({
      entry,
      cosine: cosineSimilarity(qVec, indexed.vector),
      bm25: bm25Score(qTf, indexed, idf, avgLen),
    });
  }
  return fuseCandidates(scored, options);
}
