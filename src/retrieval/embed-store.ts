/**
 * R21: embedding lifecycle — probe, build, fingerprint enforcement, recall.
 * One funnel for the CLI (embed status|reindex) and the retrieval wiring.
 */
import type { Store } from "../store.ts";
import { list, extractEntryText } from "../store.ts";
import type { MemoryEntry } from "../types.ts";
import {
  createEmbedder,
  fingerprintOf,
  getConfiguredEmbedder,
  loadEmbeddings,
  getEmbedPipeline,
  setEmbedPipeline,
  clearEmbeddings,
  saveEmbedding,
  countEmbeddings,
  initEmbedTables,
  semanticCosine,
  EMBED_BATCH_SIZE,
  type Embedder,
} from "./embedders.ts";

export class EmbeddingFingerprintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingFingerprintError";
  }
}

export interface EmbedStatus {
  configured: boolean;
  endpoint?: string;
  model?: string;
  vectorCount: number;
  pipeline: { fingerprint: string; model: string; dims: number; endpoint: string; updated_at: string } | null;
  /** True when configured embedder's identity differs from the stored pipeline. */
  mismatch: boolean;
}

export function embedStatus(store: Store): EmbedStatus {
  const embedder = getConfiguredEmbedder(store.memoryDir);
  const db = store.db;
  const pipeline = db ? getEmbedPipeline(db) : null;
  const vectorCount = db ? countEmbeddings(db) : 0;
  if (!embedder) {
    return { configured: false, vectorCount, pipeline, mismatch: false };
  }
  // Without a probe we cannot know dims/model for certain; mismatch is only
  // decidable against the stored pipeline's endpoint+model string prefix.
  const mismatch =
    pipeline !== null &&
    (!pipeline.fingerprint.endsWith(`|${embedder.endpoint}`) ||
      (embedder.model !== undefined && pipeline.model !== embedder.model));
  return {
    configured: true,
    endpoint: embedder.endpoint,
    model: embedder.model ?? pipeline?.model,
    vectorCount,
    pipeline,
    mismatch,
  };
}

/**
 * Probe the embedder, then embed every entry and record the pipeline
 * fingerprint. Refuses to overwrite a store built by a different pipeline —
 * call reindexEmbeddings to explicitly re-authorize the change.
 */
export async function buildEmbeddings(store: Store, embedder?: Embedder): Promise<{ dims: number; model: string; count: number }> {
  const emb = embedder ?? getConfiguredEmbedder(store.memoryDir);
  if (!emb) throw new Error("no embedder configured (set retrieval.embedderUrl via memory settings)");
  if (!store.db) throw new Error("SQLite unavailable — embeddings require the primary database");

  initEmbedTables(store.db);
  const probe = await emb.probe();
  const fingerprint = fingerprintOf(probe.model, probe.dims, emb.endpoint);

  const existing = getEmbedPipeline(store.db);
  if (existing && existing.fingerprint !== fingerprint) {
    throw new EmbeddingFingerprintError(
      `embedding pipeline mismatch: store built with '${existing.fingerprint}', configured '${fingerprint}'. ` +
        `Run 'memory embed reindex' to explicitly rebuild with the new pipeline.`,
    );
  }

  const entries = list(store);
  let count = 0;
  for (let i = 0; i < entries.length; i += EMBED_BATCH_SIZE) {
    const batch = entries.slice(i, i + EMBED_BATCH_SIZE);
    const texts = batch.map((e) => extractEntryText(e));
    const vectors = await emb.embed(texts);
    for (let j = 0; j < batch.length; j++) {
      saveEmbedding(store.db, batch[j].id, vectors[j]);
      count++;
    }
  }
  setEmbedPipeline(store.db, { fingerprint, model: probe.model, dims: probe.dims, endpoint: emb.endpoint });
  return { dims: probe.dims, model: probe.model, count };
}

/** Explicit re-authorization: wipe vectors + pipeline, then rebuild. */
export async function reindexEmbeddings(store: Store, embedder?: Embedder): Promise<{ dims: number; model: string; count: number }> {
  const emb = embedder ?? getConfiguredEmbedder(store.memoryDir);
  if (!emb) throw new Error("no embedder configured (set retrieval.embedderUrl via memory settings)");
  if (!store.db) throw new Error("SQLite unavailable — embeddings require the primary database");
  initEmbedTables(store.db);
  clearEmbeddings(store.db);
  return buildEmbeddings(store, emb);
}

/**
 * Cosine scores of a query against stored vectors, or null when the
 * configured pipeline does not match the store (refuse-to-load: the caller
 * keeps today's lexical behavior unchanged).
 */
export async function semanticScoresFor(
  store: Store,
  query: string,
  embedder?: Embedder,
): Promise<Map<string, number> | null> {
  const emb = embedder ?? getConfiguredEmbedder(store.memoryDir);
  if (!emb || !store.db || !query.trim()) return null;
  initEmbedTables(store.db);
  const vectors = loadEmbeddings(store.db);
  if (vectors.size === 0) return null;

  const pipeline = getEmbedPipeline(store.db);
  if (pipeline) {
    // Identity check without a network call: endpoint must match, and an
    // explicitly configured model must match the stored pipeline's model.
    // A dims change still surfaces at the next probe (build/reindex path).
    if (!pipeline.fingerprint.endsWith(`|${emb.endpoint}`)) return null;
    if (emb.model && pipeline.model && emb.model !== pipeline.model) return null;
  }

  const [qVec] = await emb.embed([query]);
  const scores = new Map<string, number>();
  for (const [id, vec] of vectors) {
    if (vec.length !== qVec.length) continue; // dims drift — skip, never crash
    scores.set(id, semanticCosine(qVec, vec));
  }
  return scores;
}
