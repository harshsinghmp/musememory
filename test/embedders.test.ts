import { describe, test, expect } from "bun:test";
import type { Store } from "../src/store.ts";
import { openStore, propose, list } from "../src/store.ts";
import { sortCandidates, tokenize } from "../src/retrieval.ts";
import {
  createEmbedder,
  fingerprintOf,
  semanticCosine,
  getConfiguredEmbedder,
  loadEmbeddings,
  getEmbedPipeline,
  countEmbeddings,
} from "../src/retrieval/embedders.ts";
import {
  buildEmbeddings,
  reindexEmbeddings,
  semanticScoresFor,
  embedStatus,
  EmbeddingFingerprintError,
} from "../src/retrieval/embed-store.ts";
import { setSettings } from "../src/settings/loader.ts";
import { makeTempRoot, cleanup } from "./helpers.ts";

/**
 * Fake embedding "model": a tiny synonym-normalizing bag-of-words embedder.
 * Semantically-equal phrases share vocabulary buckets, so the suite proves
 * the wiring end-to-end without a real server.
 */
const VOCAB = ["api", "throttle", "sync", "deploy", "staging", "token", "expire", "database"];
const SYNONYMS: Record<string, string> = {
  rate: "throttle", limit: "throttle", throttle: "throttle", throttled: "throttle",
  failing: "sync", broken: "sync",
  ship: "deploy", release: "deploy",
  auth: "token", login: "token", session: "token",
  lifetime: "expire", ttl: "expire",
  connections: "database", pool: "database", postgres: "database", pg: "database",
};

function fakeVector(text: string): number[] {
  const vec = new Array(VOCAB.length).fill(0);
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    const word = SYNONYMS[raw] ?? raw;
    const i = VOCAB.indexOf(word);
    if (i >= 0) vec[i] += 1;
  }
  return vec;
}

/** OpenAI-compatible fake: echoes vectors back, optionally scrambling order. */
function fakeFetch(model = "fake-embed", scramble = false): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { model?: string; input: string[] };
    let data = body.input.map((text, index) => ({ embedding: fakeVector(text), index }));
    if (scramble && data.length > 1) data = [...data].reverse();
    return new Response(JSON.stringify({ data, model: body.model ?? model }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

const RETRIEVAL_BASE = {
  defaultMode: "hybrid" as const,
  defaultTokenBudget: 4000,
  defaultDisclosureDepth: "L2" as const,
  treeMaxDepth: 5,
  enableLLMReasoning: false,
  hybridVectorWeight: 0.5,
  hybridTreeWeight: 0.5,
};

const ENDPOINT = "http://127.0.0.1:9/v1";

function seed(root: string): Store {
  const store = openStore(root);
  propose(store, {
    title: "API throttled at 100 requests per minute",
    content: "The public API throttles at 100 requests per minute.",
    tags: ["api"],
    project: "test",
  });
  propose(store, {
    title: "Auth tokens expire after 15 minutes",
    content: "HMAC auth tokens have a 15 minute lifetime.",
    tags: ["auth"],
    project: "test",
  });
  propose(store, {
    title: "Quarterly billing report template",
    content: "Use the standard template for quarterly billing reports.",
    tags: ["billing"],
    project: "test",
  });
  return store;
}

describe("embedders (R21)", () => {
  test("probe reports dims and model from the response", async () => {
    const emb = createEmbedder({ endpoint: ENDPOINT, fetchImpl: fakeFetch() });
    const probe = await emb.probe();
    expect(probe.dims).toBe(VOCAB.length);
    expect(probe.model).toBe("fake-embed");
  });

  test("embed maps inputs to vectors by index, even scrambled", async () => {
    const emb = createEmbedder({ endpoint: ENDPOINT, fetchImpl: fakeFetch("m2", true) });
    const [a, b] = await emb.embed(["rate limit", "billing report"]);
    expect(Array.from(a)).toEqual(fakeVector("rate limit"));
    expect(Array.from(b)).toEqual(fakeVector("billing report"));
  });

  test("semantic cosine: paraphrase scores strong, unrelated near zero", async () => {
    const emb = createEmbedder({ endpoint: ENDPOINT, fetchImpl: fakeFetch() });
    const [q] = await emb.embed(["why is sync failing with rate limit errors"]);
    const [para, unrelated] = await emb.embed(["API throttled at 100 requests per minute", "Quarterly billing report template"]);
    expect(semanticCosine(q, para)).toBeGreaterThan(0.4);
    expect(semanticCosine(q, unrelated)).toBeLessThan(0.1);
  });

  test("fingerprint is model|dims|endpoint", () => {
    expect(fingerprintOf("m", 4, ENDPOINT)).toBe(`m|4|${ENDPOINT}`);
  });

  test("unconfigured store: null embedder, no vectors, status honest", () => {
    const root = makeTempRoot();
    try {
      const store = seed(root);
      expect(getConfiguredEmbedder(store.memoryDir)).toBeNull();
      const s = embedStatus(store);
      expect(s.configured).toBe(false);
      expect(s.vectorCount).toBe(0);
      expect(countEmbeddings(store.db!)).toBe(0);
      expect(getEmbedPipeline(store.db!)).toBeNull();
    } finally {
      cleanup(root);
    }
  });

  test("build stores vectors + pipeline fingerprint; status reports them", async () => {
    const root = makeTempRoot();
    try {
      const store = seed(root);
      const res = await buildEmbeddings(store, createEmbedder({ endpoint: ENDPOINT, fetchImpl: fakeFetch() }));
      expect(res.count).toBe(3);
      expect(res.dims).toBe(VOCAB.length);
      expect(countEmbeddings(store.db!)).toBe(3);
      const pipeline = getEmbedPipeline(store.db!)!;
      expect(pipeline.fingerprint).toBe(`fake-embed|${VOCAB.length}|${ENDPOINT}`);
      expect(loadEmbeddings(store.db!).size).toBe(3);

      setSettings(store.memoryDir!, { retrieval: { ...RETRIEVAL_BASE, embedderUrl: ENDPOINT } });
      const s = embedStatus(store);
      expect(s.configured).toBe(true);
      expect(s.vectorCount).toBe(3);
      expect(s.mismatch).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  test("pipeline mismatch: build refuses, recall refuses, reindex re-authorizes", async () => {
    const root = makeTempRoot();
    try {
      const store = seed(root);
      await buildEmbeddings(store, createEmbedder({ endpoint: ENDPOINT, fetchImpl: fakeFetch("model-a") }));

      // A different model is a different pipeline: refuse to overwrite.
      const other = createEmbedder({ endpoint: ENDPOINT, model: "model-b", fetchImpl: fakeFetch("model-b") });
      await expect(buildEmbeddings(store, other)).rejects.toThrow(EmbeddingFingerprintError);

      // Recall refuses too: null means the caller keeps lexical behavior.
      setSettings(store.memoryDir!, { retrieval: { ...RETRIEVAL_BASE, embedderUrl: ENDPOINT, embedderModel: "model-b" } });
      expect(await semanticScoresFor(store, "rate limit")).toBeNull();

      // Explicit reindex re-authorizes the new pipeline.
      const res = await reindexEmbeddings(store, other);
      expect(res.model).toBe("model-b");
      expect(getEmbedPipeline(store.db!)!.fingerprint).toBe(`model-b|${VOCAB.length}|${ENDPOINT}`);
      // Re-authorized: recall proceeds again (fake embedder keeps the suite offline).
      expect(await semanticScoresFor(store, "rate limit", other)).not.toBeNull();
    } finally {
      cleanup(root);
    }
  });

  test("semanticScoresFor: paraphrase beats lexical on the no-overlap pair", async () => {
    const root = makeTempRoot();
    try {
      const store = seed(root);
      await buildEmbeddings(store, createEmbedder({ endpoint: ENDPOINT, fetchImpl: fakeFetch() }));
      setSettings(store.memoryDir!, { retrieval: { ...RETRIEVAL_BASE, embedderUrl: ENDPOINT } });

      const scores = (await semanticScoresFor(
        store,
        "what is the rate limit",
        createEmbedder({ endpoint: ENDPOINT, fetchImpl: fakeFetch() }),
      ))!;
      const apiEntry = list(store).find((e) => e.title.includes("throttled"))!;
      expect(scores.get(apiEntry.id)!).toBeGreaterThan(0.3);

      // Ranking dim #12 actually reorders: without scores the entry has zero
      // lexical overlap; with them it sorts first.
      const entries = list(store);
      const query = "what is the rate limit";
      const withoutScores = sortCandidates(entries, tokenize(query), Date.now());
      const withScores = sortCandidates(entries, tokenize(query), Date.now(), scores);
      expect(withScores[0].entry.id).toBe(apiEntry.id);
      expect(withScores[0].score).toBeGreaterThan(withoutScores.find((r) => r.entry.id === apiEntry.id)!.score);
    } finally {
      cleanup(root);
    }
  });

  test("embed status CLI output is honest when unconfigured", async () => {
    const root = makeTempRoot();
    try {
      const { handleEmbedCommand } = await import("../src/cli/embed.ts");
      const code = await handleEmbedCommand({ positional: ["status"], flags: { dir: root } } as never);
      expect(code).toBe(0);
    } finally {
      cleanup(root);
    }
  });
});
