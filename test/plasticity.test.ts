import { describe, test, expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openStore, propose } from "../src/store.ts";
import { rankAndRetrieveMemories } from "../src/retrieval/ranking.ts";
import {
  loadHebbianGraph,
  recordCoActivation,
  MAX_GRAPH_NODES,
  type HebbianGraph,
} from "../src/plasticity.ts";
import { makeTempRoot, cleanup } from "./helpers.ts";

const GRAPH_FILE = "hebbian-plasticity.json";

function seedGraph(memoryDir: string, nodes: number): HebbianGraph {
  const now = new Date().toISOString();
  const graph: HebbianGraph = {};
  for (let i = 0; i < nodes; i++) {
    graph[`m_seed_${i}`] = { m_hub: { weight: 0.1, count: 1, lastActivated: now } };
  }
  writeFileSync(join(memoryDir, GRAPH_FILE), JSON.stringify(graph, null, 2), "utf8");
  return graph;
}

describe("issue #191: plasticity bounds and associative retrieval", () => {
  test("MAX_GRAPH_NODES caps the retained graph and drops the newest low-degree nodes", () => {
    const root = makeTempRoot();
    const memoryDir = join(root, ".memory");
    mkdirSync(memoryDir, { recursive: true });
    seedGraph(memoryDir, MAX_GRAPH_NODES);

    recordCoActivation(["m_fresh_a", "m_fresh_b"], memoryDir);

    const graph = loadHebbianGraph(memoryDir);
    expect(Object.keys(graph).length).toBe(MAX_GRAPH_NODES);
    // The two fresh nodes are the lowest-degree (1 edge each) and are pruned.
    expect(graph["m_fresh_a"]).toBeUndefined();
    expect(graph["m_fresh_b"]).toBeUndefined();
    expect(graph["m_seed_0"]).toBeDefined();

    cleanup(root);
  });

  test("a no-op co-activation is not a dirty write: the graph file is left untouched", () => {
    const root = makeTempRoot();
    const memoryDir = join(root, ".memory");
    mkdirSync(memoryDir, { recursive: true });
    const graphPath = join(memoryDir, GRAPH_FILE);

    // 1. Sub-threshold batches never create the file at all.
    recordCoActivation([], memoryDir);
    recordCoActivation(["m_solo"], memoryDir);
    recordCoActivation(["m_solo", "m_solo"], memoryDir); // dedupes to one id
    expect(existsSync(graphPath)).toBe(false);

    // 2. Even with an existing graph, a no-op call must not rewrite it.
    seedGraph(memoryDir, 2);
    const before = readFileSync(graphPath, "utf8");
    const mtimeBefore = statSync(graphPath).mtimeMs;

    recordCoActivation(["m_unrelated"], memoryDir);
    recordCoActivation([], memoryDir);

    expect(readFileSync(graphPath, "utf8")).toBe(before);
    expect(statSync(graphPath).mtimeMs).toBe(mtimeBefore);

    // 3. A real change writes through a temp file and leaves no residue.
    recordCoActivation(["m_a", "m_b"], memoryDir);
    expect(loadHebbianGraph(memoryDir)["m_a"]?.["m_b"]?.weight).toBeGreaterThan(0);
    expect(existsSync(`${graphPath}.tmp`)).toBe(false);

    cleanup(root);
  });

  test("ranked retrieval expands candidates through the Hebbian graph (weight >= 0.2)", async () => {
    const root = makeTempRoot();
    const memoryDir = join(root, ".memory");
    mkdirSync(memoryDir, { recursive: true });
    const store = openStore(memoryDir);

    const anchor = propose(store, {
      title: "Kubernetes deployment strategy",
      content: "Kubernetes rolls deployments with maxSurge 25% and a readiness gate before cutover.",
      project: "core",
      type: "decision",
    });
    const associate = propose(store, {
      title: "Sourdough starter hydration",
      content: "Feed the sourdough starter twice a day at 100% hydration and keep it at room temperature.",
      project: "core",
      type: "discovery",
    });

    // Baseline: the associate shares no token with the query, so it earns no
    // lexical (bm25Match) credit.
    const before = await rankAndRetrieveMemories(store, "kubernetes", { limit: 10, now: Date.now() });
    const beforeAssoc = before.find((r) => r.entry.id === associate.id);
    expect(beforeAssoc?.factors.bm25Match ?? 0).toBe(0);

    // Four co-activations => 0.20 weight, exactly the expansion threshold.
    for (let i = 0; i < 4; i++) recordCoActivation([anchor.id, associate.id], memoryDir);

    const after = await rankAndRetrieveMemories(store, "kubernetes", { limit: 10, now: Date.now() });
    const boosted = after.find((r) => r.entry.id === associate.id);
    expect(boosted).toBeDefined();
    // Candidate pulled in by association is scored as an FTS match (0.3).
    expect(boosted?.factors.bm25Match).toBe(0.3);

    cleanup(root);
  });
});
