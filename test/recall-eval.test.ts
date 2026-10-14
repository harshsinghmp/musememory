import { describe, test } from "bun:test";
import { openStore } from "../src/store.ts";
import { queryContext } from "../src/retrieval.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";

/**
 * R27: recall quality gate. Runs the golden fixture over the standard corpus
 * with the default (lexical) engine and locks the measured baseline: any
 * future retrieval change that drops recall below the floor fails CI.
 *
 * Re-run with an embedder configured (retrieval.embedderUrl) and the
 * harness reports the semantic delta on the same fixture.
 */

/** recall@5 floor — the measured trigram baseline, rounded down. */
const RECALL5_FLOOR = 0.8;
/** p50 latency budget in ms (reported, not gated — speed regressions show in output). */
const P50_BUDGET_MS = 25;

interface GoldenQuery {
  query: string;
  relevant: string[];
  distractors: string[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

describe("recall eval (R27)", () => {
  test("golden fixture recall@5 does not regress below the floor", () => {
    const { root, memoryDir } = setupFixtureRoot();
    try {
      const store = openStore(memoryDir);
      const fixture = require("./fixtures/recall-golden.json") as { queries: GoldenQuery[] };

      let recallSum = 0;
      let distractorViolations = 0;
      const latencies: number[] = [];

      for (const q of fixture.queries) {
        const t0 = performance.now();
        const results = queryContext(store, q.query, { limit: 10 });
        latencies.push(performance.now() - t0);

        const top5 = new Set(results.results.slice(0, 5).map((r) => r.entry.id));
        if (q.relevant.length > 0) {
          const hits = q.relevant.filter((id) => top5.has(id)).length;
          recallSum += hits / q.relevant.length;
        }
        distractorViolations += q.distractors.filter((id) => top5.has(id)).length;
      }

      const recallAt5 = recallSum / fixture.queries.length;
      const p50 = percentile([...latencies].sort((a, b) => a - b), 50);

      console.log(
        `[recall-eval] queries=${fixture.queries.length} recall@5=${recallAt5.toFixed(3)} ` +
          `floor=${RECALL5_FLOOR} distractor_violations=${distractorViolations} p50=${p50.toFixed(1)}ms ` +
          `(budget ${P50_BUDGET_MS}ms)`,
      );

      if (recallAt5 < RECALL5_FLOOR) {
        throw new Error(
          `recall@5 ${recallAt5.toFixed(3)} below floor ${RECALL5_FLOOR} — retrieval quality regressed`,
        );
      }
    } finally {
      cleanup(root);
    }
  });
});
