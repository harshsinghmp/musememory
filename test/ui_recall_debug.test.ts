import { describe, test, expect } from "bun:test";
import { openStore, propose } from "../src/store.ts";
import { startUiServer } from "../src/ui.ts";
import { rankAndRetrieveMemories } from "../src/retrieval/ranking.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";

describe("R32: studio recall-debug endpoint", () => {
  test("returns per-factor breakdowns from the canonical ranker", async () => {
    const { memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    // Two entries so the breakdown is not trivially one row.
    propose(store, {
      content: "auth session tokens are rotated on every request for safety",
      project: "p",
      confirmed: true,
    });
    propose(store, {
      content: "database connection pooling limits are tuned per environment",
      project: "p",
      confirmed: true,
    });

    const srv = await startUiServer({ port: 0, memoryDir, store });
    try {
      const res = await fetch(`http://localhost:${srv.port}/api/recall-debug`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "auth session token rotation", limit: 5 }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.query).toBe("auth session token rotation");
      expect(body.count).toBeGreaterThan(0);
      expect(body.count).toBe(body.results.length);
      expect(typeof body.totalTokens).toBe("number");

      const top = body.results[0];
      // Every ranked row carries the full factor object, not just a score.
      expect(top.factors).toBeDefined();
      expect(typeof top.factors.bm25Match).toBe("number");
      expect(typeof top.factors.baseApplicability).toBe("number");
      expect(Array.isArray(top.why_retrieved)).toBe(true);

      // The panel must not invent a second scoring path: the factors it shows
      // are the canonical scorer's factors for that same entry.
      const stored = store.db!
        .query<{ id: string }>("SELECT id FROM memories WHERE id = ?")
        .get([top.id]);
      expect(stored?.id).toBe(top.id);
      const rankedAgain = await rankAndRetrieveMemories(store, "auth session token rotation", { limit: 5 });
      const expected = rankedAgain.find((r) => r.entry.id === top.id);
      expect(expected).toBeDefined();
      expect(top.factors.baseApplicability).toBeCloseTo(expected!.factors.baseApplicability, 6);
      expect(top.factors.bm25Match).toBeCloseTo(expected!.factors.bm25Match, 6);
      expect(top.score).toBeCloseTo(Number(expected!.score.toFixed(4)), 3);
    } finally {
      await srv.close?.();
      cleanup(memoryDir.replace(/\/\.memory$/, ""));
    }
  });

  test("rejects an empty query rather than scoring the whole store", async () => {
    const { memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const srv = await startUiServer({ port: 0, memoryDir, store });
    try {
      const res = await fetch(`http://localhost:${srv.port}/api/recall-debug`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "   " }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("query");
    } finally {
      await srv.close?.();
      cleanup(memoryDir.replace(/\/\.memory$/, ""));
    }
  });
});
