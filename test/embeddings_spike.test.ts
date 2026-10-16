import { describe, test, expect } from "bun:test";
import {
  createEmbedder,
  fingerprintOf,
  semanticCosine,
  SEMANTIC_COSINE_MIN_THRESHOLD,
  BM25_MIN_THRESHOLD,
  calibrateSemanticScore,
} from "../src/retrieval/embedders.ts";
import { openStore, propose, list } from "../src/store.ts";
import { computeFactors } from "../src/retrieval.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";

/**
 * T-381: End-to-end spike validating local llama-cpp OpenAI-compatible embedding API.
 * Simulates a realistic llama-server --embedding endpoint response with standard 384-dim vectors.
 */
function mockLlamaCppServer(options: {
  model?: string;
  dims?: number;
  shouldFail?: boolean;
  status?: number;
} = {}): typeof fetch {
  const model = options.model ?? "bge-small-en-v1.5";
  const dims = options.dims ?? 384;

  return (async (url: string, init: RequestInit) => {
    if (options.shouldFail) {
      throw new Error("ECONNREFUSED 127.0.0.1:8081");
    }
    if (options.status && options.status !== 200) {
      return new Response("Internal Server Error", { status: options.status, statusText: "Internal Server Error" });
    }

    const body = JSON.parse(String(init.body)) as { model?: string; input: string | string[] };
    const inputs = Array.isArray(body.input) ? body.input : [body.input];

    const data = inputs.map((text, idx) => {
      // Deterministic pseudo-embedding based on text content
      const vec = new Array(dims).fill(0);
      let hash = 0;
      for (let i = 0; i < text.length; i++) {
        hash = (hash << 5) - hash + text.charCodeAt(i);
        hash |= 0;
      }
      for (let j = 0; j < dims; j++) {
        vec[j] = Math.sin(hash + j) * 0.1;
      }
      return {
        object: "embedding",
        embedding: vec,
        index: idx,
      };
    });

    return new Response(
      JSON.stringify({
        object: "list",
        data,
        model: body.model || model,
        usage: { prompt_tokens: inputs.length * 4, total_tokens: inputs.length * 4 },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as unknown as typeof fetch;
}

describe("Wave 6 - Task 1: Semantic Embeddings Spike & Dual Calibrated Thresholds (T-381, T-071)", () => {
  describe("T-381: Local llama-cpp embeddings E2E spike", () => {
    test("successfully probes llama-cpp server endpoint and reports dims + model", async () => {
      const fetchImpl = mockLlamaCppServer({ model: "bge-small-en-v1.5", dims: 384 });
      const embedder = createEmbedder({
        endpoint: "http://127.0.0.1:8081/v1",
        model: "bge-small-en-v1.5",
        fetchImpl,
      });

      const probe = await embedder.probe();
      expect(probe.dims).toBe(384);
      expect(probe.model).toBe("bge-small-en-v1.5");
      expect(embedder.endpoint).toBe("http://127.0.0.1:8081/v1");
    });

    test("embeds batch of queries and produces valid Float32Array vectors", async () => {
      const fetchImpl = mockLlamaCppServer({ dims: 384 });
      const embedder = createEmbedder({
        endpoint: "http://127.0.0.1:8081/v1",
        fetchImpl,
      });

      const vectors = await embedder.embed([
        "SQLite WAL mode concurrency guard",
        "Fast text search FTS5 syntax escaping",
      ]);

      expect(vectors.length).toBe(2);
      expect(vectors[0].length).toBe(384);
      expect(vectors[1].length).toBe(384);
      expect(vectors[0] instanceof Float32Array).toBe(true);

      const sim = semanticCosine(vectors[0], vectors[0]);
      expect(sim).toBeCloseTo(1.0, 4);
    });

    test("fails gracefully with honest error when llama-cpp server is offline", async () => {
      const fetchImpl = mockLlamaCppServer({ shouldFail: true });
      const embedder = createEmbedder({
        endpoint: "http://127.0.0.1:8081/v1",
        fetchImpl,
      });

      await expect(embedder.probe()).rejects.toThrow(/ECONNREFUSED/);
    });
  });

  describe("T-071: Dual calibrated thresholds (cosine max + BM25 min)", () => {
    test("defines calibrated engine constants for semantic cosine and BM25", () => {
      expect(SEMANTIC_COSINE_MIN_THRESHOLD).toBe(0.30);
      expect(BM25_MIN_THRESHOLD).toBe(0.25);
    });

    test("calibrateSemanticScore filters sub-threshold noise below 0.30", () => {
      expect(calibrateSemanticScore(0.15)).toBe(0);
      expect(calibrateSemanticScore(0.29)).toBe(0);
      expect(calibrateSemanticScore(0.30)).toBe(0.30);
      expect(calibrateSemanticScore(0.85)).toBe(0.85);
    });

    test("computeFactors zeroes semanticMatch when semanticScore is below MIN threshold", () => {
      const entry = {
        id: "m_test_1",
        title: "Test Invariant",
        content: "Testing calibrated threshold behavior in retrieval engine",
        project: "test",
        type: "constraint" as const,
        status: "confirmed" as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Below threshold (0.20 < 0.30) -> semanticMatch must be 0
      const noisyFactors = computeFactors(entry, ["test"], {
        now: Date.now(),
        semanticScore: 0.20,
      });
      expect(noisyFactors.semanticMatch).toBe(0);

      // Above threshold (0.65 >= 0.30) -> semanticMatch preserved
      const validFactors = computeFactors(entry, ["test"], {
        now: Date.now(),
        semanticScore: 0.65,
      });
      expect(validFactors.semanticMatch).toBe(0.65);
    });
  });
});
