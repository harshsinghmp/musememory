import { describe, test, expect } from "bun:test";
import { openStore, propose, list, get } from "../src/store.ts";
import { createEmbedder } from "../src/retrieval/embedders.ts";
import { buildEmbeddings, reindexEmbeddings, embedStatus } from "../src/retrieval/embed-store.ts";
import { runDoctor } from "../src/doctor.ts";
import { setSettings } from "../src/settings/loader.ts";
import { makeTempRoot, cleanup } from "./helpers.ts";

const ENDPOINT = "http://127.0.0.1:9/v1";

function makeSelectiveFailFetch(failOnIdSubstring: string): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { model?: string; input: string[] };
    for (const text of body.input) {
      if (text.includes(failOnIdSubstring)) {
        return new Response(JSON.stringify({ error: "Selective failure" }), { status: 500 });
      }
    }
    const data = body.input.map((_, index) => ({
      embedding: [0.1, 0.2, 0.3, 0.4],
      index,
    }));
    return new Response(JSON.stringify({ data, model: body.model ?? "test-embed" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("stale_embedder stamping on reindex-miss entries (T-139)", () => {
  test("stamps stale_embedder: true when embedding fails for an entry, and clears it when resolved", async () => {
    const root = makeTempRoot();
    try {
      const resolved = await runDoctor(root);
      const store = openStore(resolved.storage.path);
      const e1 = propose(store, {
        title: "Normal memory entry",
        content: "This entry will be embedded successfully.",
        project: "test",
      });
      const e2 = propose(store, {
        title: "Problematic memory entry FAIL_THIS",
        content: "This entry causes embedding failure: FAIL_THIS",
        project: "test",
      });

      // Embedder that fails on FAIL_THIS
      const selectiveEmbedder = createEmbedder({
        endpoint: ENDPOINT,
        fetchImpl: makeSelectiveFailFetch("FAIL_THIS"),
      });

      const res = await buildEmbeddings(store, selectiveEmbedder);
      expect(res.count).toBe(1);

      // Verify e1 has no stale flag and e2 has stale_embedder: true
      const e1Reloaded = get(store, e1.id)!;
      const e2Reloaded = get(store, e2.id)!;
      expect(e1Reloaded.stale_embedder).toBeFalsy();
      expect(e2Reloaded.stale_embedder).toBe(true);

      // embedStatus reports 1 stale embedder entry
      const status = embedStatus(store);
      expect(status.staleEmbedderCount).toBe(1);
      expect(status.staleEmbedderIds).toContain(e2.id);

      // runDoctor reports the stale entry in doctor diagnostics
      const report = await runDoctor(root);
      expect(report.embeddings).toBeDefined();
      expect(report.embeddings?.staleEmbedderCount).toBe(1);

      // Now reindex with a working embedder (no failure)
      const workingEmbedder = createEmbedder({
        endpoint: ENDPOINT,
        fetchImpl: makeSelectiveFailFetch("NONE_FAIL"),
      });
      const reindexRes = await reindexEmbeddings(store, workingEmbedder);
      expect(reindexRes.count).toBe(2);

      const e2Cleared = get(store, e2.id)!;
      expect(e2Cleared.stale_embedder).toBeFalsy();

      const statusAfter = embedStatus(store);
      expect(statusAfter.staleEmbedderCount).toBe(0);
      expect(statusAfter.staleEmbedderIds.length).toBe(0);
    } finally {
      cleanup(root);
    }
  });

  test("detects unindexed entries added after build as stale_embedder in embedStatus", async () => {
    const root = makeTempRoot();
    try {
      const store = openStore(root);
      propose(store, {
        title: "Existing entry",
        content: "Embedded before new addition.",
        project: "test",
      });

      const workingEmbedder = createEmbedder({
        endpoint: ENDPOINT,
        fetchImpl: makeSelectiveFailFetch("NONE_FAIL"),
      });
      await buildEmbeddings(store, workingEmbedder);

      // Add a new entry to the store without embedding it
      const newEntry = propose(store, {
        title: "New entry after build",
        content: "Has no vector in sqlite yet.",
        project: "test",
      });

      const status = embedStatus(store);
      expect(status.staleEmbedderCount).toBe(1);
      expect(status.staleEmbedderIds).toContain(newEntry.id);
    } finally {
      cleanup(root);
    }
  });
});
