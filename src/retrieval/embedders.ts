/**
 * R21: Local semantic embeddings via an OpenAI-compatible /v1/embeddings
 * endpoint (llama.cpp server by default; Ollama or hosted providers work by
 * URL alone). Opt-in: unconfigured stores keep today's trigram vectors and
 * identical behavior.
 *
 * Durability contract (borrowed from the qdrant-memory plugin's init pattern):
 * the embedding pipeline fingerprint (model|dims|endpoint) is recorded with
 * the vectors; a configured embedder whose fingerprint differs from the
 * stored one is REFUSED until an explicit reindex re-authorizes the change.
 */
import type { SqliteDatabase } from "../sqlite.ts";
import { getSettings } from "../settings/loader.ts";
import { validateEmbedderUrl } from "../settings/schema.ts";

export interface EmbedderProbe {
  dims: number;
  model: string;
}

export interface Embedder {
  endpoint: string;
  model?: string;
  probe(): Promise<EmbedderProbe>;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export function fingerprintOf(model: string, dims: number, endpoint: string): string {
  return `${model}|${dims}|${endpoint}`;
}

/** Default request timeout for probe and embed calls. */
const EMBED_TIMEOUT_MS = 15_000;
/** Batch size for bulk reindex; keeps one HTTP request per server-friendly chunk. */
export const EMBED_BATCH_SIZE = 32;

type FetchImpl = typeof fetch;

interface EmbeddingsResponse {
  data?: { embedding?: number[]; index?: number }[];
  model?: string;
}

export function createEmbedder(opts: {
  endpoint: string;
  model?: string;
  fetchImpl?: FetchImpl;
  allowInsecureHttp?: boolean;
}): Embedder {
  const urlCheck = validateEmbedderUrl(opts.endpoint, { allowInsecureHttp: opts.allowInsecureHttp });
  if (!urlCheck.valid && urlCheck.error) {
    throw new Error(`Invalid embedder endpoint: ${urlCheck.error}`);
  }

  const endpoint = opts.endpoint.replace(/\/+$/, "");
  const doFetch: FetchImpl = opts.fetchImpl ?? fetch;

  async function callEmbeddings(input: string[]): Promise<EmbeddingsResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
    try {
      const res = await doFetch(`${endpoint}/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(opts.model ? { model: opts.model, input } : { input }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`embedder responded ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as EmbeddingsResponse;
    } finally {
      clearTimeout(timer);
    }
  }

  function toVector(raw: number[]): Float32Array {
    const vec = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      const v = raw[i];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new Error("embedder returned a non-numeric vector component");
      }
      vec[i] = v;
    }
    return vec;
  }

  return {
    endpoint,
    model: opts.model,
    async probe(): Promise<EmbedderProbe> {
      const res = await callEmbeddings(["probe"]);
      const first = res.data?.[0]?.embedding;
      if (!Array.isArray(first) || first.length === 0) {
        throw new Error("embedder probe returned no vector");
      }
      return { dims: first.length, model: res.model ?? opts.model ?? "default" };
    },
    async embed(texts: string[]): Promise<Float32Array[]> {
      if (texts.length === 0) return [];
      const res = await callEmbeddings(texts);
      const data = res.data ?? [];
      if (data.length !== texts.length) {
        throw new Error(`embedder returned ${data.length} vectors for ${texts.length} inputs`);
      }
      // Response order is authoritative; index field is optional but validated when present.
      const ordered: (Float32Array | undefined)[] = new Array(texts.length);
      for (const item of data) {
        if (!Array.isArray(item.embedding)) throw new Error("embedder returned a missing vector");
        const idx = typeof item.index === "number" ? item.index : ordered.findIndex((v) => v === undefined);
        if (idx < 0 || idx >= texts.length) throw new Error("embedder returned an out-of-range index");
        ordered[idx] = toVector(item.embedding);
      }
      const dims = ordered[0]!.length;
      return ordered.map((v, i) => {
        if (!v) throw new Error(`embedder returned no vector for input ${i}`);
        if (v.length !== dims) throw new Error("embedder returned inconsistent dimensions");
        return v;
      });
    },
  };
}

/** Cosine similarity over raw (possibly unnormalized) Float32 vectors. */
export function semanticCosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * T-071: Dual calibrated thresholds for hybrid semantic/lexical fusion.
 * Prevents sub-threshold embedding noise from polluting exact matches.
 */
export const SEMANTIC_COSINE_MIN_THRESHOLD = 0.30;
export const SEMANTIC_COSINE_MAX_THRESHOLD = 0.75;
export const BM25_MIN_THRESHOLD = 0.25;

export function calibrateSemanticScore(score: number): number {
  if (score < SEMANTIC_COSINE_MIN_THRESHOLD) return 0;
  return Math.min(1, score);
}

/** Reads retrieval.embedderUrl / retrieval.embedderModel from settings.json. */
export function getConfiguredEmbedder(memoryDir?: string, fetchImpl?: FetchImpl): Embedder | null {
  if (!memoryDir) return null;
  const settings = getSettings(memoryDir);
  const url = settings.retrieval?.embedderUrl;
  if (!url || typeof url !== "string" || !url.trim()) return null;
  return createEmbedder({
    endpoint: url.trim(),
    model: settings.retrieval?.embedderModel || undefined,
    fetchImpl,
  });
}

// ---------------------------------------------------------------------------
// SQLite-backed vector storage + pipeline fingerprint
// ---------------------------------------------------------------------------

export function initEmbedTables(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_embeddings (
      id TEXT PRIMARY KEY,
      vector BLOB NOT NULL,
      dims INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS embed_pipeline (
      fingerprint TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      dims INTEGER NOT NULL,
      endpoint TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export interface EmbedPipelineRecord {
  fingerprint: string;
  model: string;
  dims: number;
  endpoint: string;
  updated_at: string;
}

function toBlob(vec: Float32Array): Uint8Array {
  return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
}

function fromBlob(blob: unknown): Float32Array {
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob as ArrayBuffer);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

export function saveEmbedding(db: SqliteDatabase, id: string, vector: Float32Array): void {
  db.run(
    `INSERT OR REPLACE INTO memory_embeddings (id, vector, dims) VALUES (?, ?, ?)`,
    [id, toBlob(vector), vector.length],
  );
}

export function loadEmbeddings(db: SqliteDatabase): Map<string, Float32Array> {
  const out = new Map<string, Float32Array>();
  try {
    const rows = db.query<{ id: string; vector: unknown }>(`SELECT id, vector FROM memory_embeddings`).all();
    for (const r of rows) out.set(r.id, fromBlob(r.vector));
  } catch {
    // table missing or unreadable — treat as no vectors
  }
  return out;
}

export function getEmbedPipeline(db: SqliteDatabase): EmbedPipelineRecord | null {
  try {
    const row = db
      .query<EmbedPipelineRecord>(`SELECT fingerprint, model, dims, endpoint, updated_at FROM embed_pipeline LIMIT 1`)
      .get();
    return row ?? null;
  } catch {
    return null;
  }
}

export function setEmbedPipeline(db: SqliteDatabase, rec: Omit<EmbedPipelineRecord, "updated_at">): void {
  db.run(
    `INSERT OR REPLACE INTO embed_pipeline (fingerprint, model, dims, endpoint, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [rec.fingerprint, rec.model, rec.dims, rec.endpoint, new Date().toISOString()],
  );
}

export function clearEmbeddings(db: SqliteDatabase): void {
  db.run(`DELETE FROM memory_embeddings`);
  db.run(`DELETE FROM embed_pipeline`);
}

export function countEmbeddings(db: SqliteDatabase): number {
  try {
    const row = db.query<{ count: number }>(`SELECT count(*) as count FROM memory_embeddings`).get();
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}
