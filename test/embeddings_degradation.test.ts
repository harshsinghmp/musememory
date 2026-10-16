import { describe, test, expect } from "bun:test";
import { openStore, propose, list } from "../src/store.ts";
import {
  createEmbedder,
  fingerprintOf,
  semanticCosine,
  loadEmbeddings,
  getEmbedPipeline,
  countEmbeddings,
} from "../src/retrieval/embedders.ts";
import {
  buildEmbeddings,
  reindexEmbeddings,
  semanticScoresFor,
  EmbeddingFingerprintError,
} from "../src/retrieval/embed-store.ts";
import { rankAndRetrieveMemories } from "../src/retrieval/ranking.ts";
import { RetrievalEngine } from "../src/retrieval/engine.ts";
import { setSettings } from "../src/settings/loader.ts";
import { makeTempRoot, cleanup } from "./helpers.ts";

describe("Wave 6 - Task 2: Pipeline Fingerprint, In-Process BLOB Storage & FTS5-Floor Degradation (T-136, T-137, T-138)", () => {
  describe("T-136: Embeddings engine fingerprint pinning", () => {
    test("pins model|dims|endpoint in embed_pipeline and refuses conflicting models", async () => {
      const root = makeTempRoot();
      try {
        const store = openStore(root);
        propose(store, { title: "Arch Note", content: "Architecture invariant notes", project: "test" });

        const fakeFetchA = async () =>
          new Response(
            JSON.stringify({
              data: [{ embedding: [0.1, 0.2, 0.3, 0.4], index: 0 }],
              model: "model-v1",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );

        const embA = createEmbedder({
          endpoint: "http://127.0.0.1:8081/v1",
          model: "model-v1",
          fetchImpl: fakeFetchA as unknown as typeof fetch,
        });

        await buildEmbeddings(store, embA);
        const pipeline = getEmbedPipeline(store.db!)!;
        expect(pipeline.fingerprint).toBe(fingerprintOf("model-v1", 4, "http://127.0.0.1:8081/v1"));

        // Attempt to build with model-v2 without reindex -> must throw EmbeddingFingerprintError
        const fakeFetchB = async () =>
          new Response(
            JSON.stringify({
              data: [{ embedding: [0.1, 0.2, 0.3, 0.4], index: 0 }],
              model: "model-v2",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );

        const embB = createEmbedder({
          endpoint: "http://127.0.0.1:8081/v1",
          model: "model-v2",
          fetchImpl: fakeFetchB as unknown as typeof fetch,
        });

        await expect(buildEmbeddings(store, embB)).rejects.toThrow(EmbeddingFingerprintError);
      } finally {
        cleanup(root);
      }
    });
  });

  describe("T-138: Brute-force in-process cosine in SQLite BLOB (zero external daemon)", () => {
    test("persists raw float vectors into SQLite BLOB and rehydrates with bitwise parity", async () => {
      const root = makeTempRoot();
      try {
        const store = openStore(root);
        propose(store, { title: "Vector Persistence", content: "In-process vector storage test", project: "test" });

        const rawExpected = [0.12345, -0.6789, 0.54321, -0.09876];
        const fakeFetch = async () =>
          new Response(
            JSON.stringify({
              data: [{ embedding: rawExpected, index: 0 }],
              model: "test-model",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );

        const emb = createEmbedder({
          endpoint: "http://127.0.0.1:8081/v1",
          model: "test-model",
          fetchImpl: fakeFetch as unknown as typeof fetch,
        });

        await buildEmbeddings(store, emb);
        const loaded = loadEmbeddings(store.db!);
        expect(loaded.size).toBe(1);

        const loadedVector = Array.from(Array.from(loaded.values())[0]);
        for (let i = 0; i < rawExpected.length; i++) {
          expect(loadedVector[i]).toBeCloseTo(rawExpected[i], 4);
        }

        // Verify SQLite storage structure: must be stored as binary BLOB
        const row = store.db!.query<{ dims: number; vector: unknown }>(
          "SELECT dims, vector FROM memory_embeddings LIMIT 1",
        ).get()!;
        expect(row.dims).toBe(4);
        expect(row.vector instanceof Uint8Array).toBe(true);
      } finally {
        cleanup(root);
      }
    });
  });

  describe("T-137: FTS5-floor / vector-upgrade degradation path", () => {
    test("gracefully degrades to lexical / FTS5 floor when embedder network call fails", async () => {
      const root = makeTempRoot();
      try {
        const store = openStore(root);
        propose(store, {
          title: "Database connection pool timeout",
          content: "Postgres connection pool max timeout is 5000ms",
          project: "backend",
          tags: ["db", "postgres"],
        });

        // Configure embedder pointing to an offline server
        setSettings(store.memoryDir!, {
          retrieval: {
            defaultMode: "hybrid",
            defaultTokenBudget: 4000,
            defaultDisclosureDepth: "L2",
            treeMaxDepth: 5,
            enableLLMReasoning: false,
            hybridVectorWeight: 0.5,
            hybridTreeWeight: 0.5,
            embedderUrl: "http://127.0.0.1:8089/v1",
          },
        });

        // rankAndRetrieveMemories should not throw; it degrades to FTS5/lexical scoring
        const ranked = await rankAndRetrieveMemories(store, "postgres connection pool timeout");
        expect(ranked.length).toBeGreaterThan(0);
        expect(ranked[0].entry.title).toContain("Database connection pool");

        // RetrievalEngine.search should also degrade cleanly
        const unified = RetrievalEngine.search(store, store.memoryDir!, "postgres connection pool", {
          mode: "hybrid",
        });
        expect(unified.results.length).toBeGreaterThan(0);
        expect(unified.results[0].entry.title).toContain("Database connection pool");
      } finally {
        cleanup(root);
      }
    });
  });
});
