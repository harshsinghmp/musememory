import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { openStore, list, get, propose } from "../src/store.ts";
import { consolidateScenes, clusterByTokenOverlap, cosineSimilarity, tokenBag } from "../src/consolidate.ts";
import { makeTempRoot, cleanup } from "./helpers.ts";

function setup() {
  const root = makeTempRoot();
  const memoryDir = join(root, ".memory");
  const store = openStore(memoryDir);
  return { root, memoryDir, store };
}

function seedRedisCluster(store: ReturnType<typeof openStore>) {
  const seeds = [
    { title: "Redis cache eviction policy", content: "redis cache eviction uses allkeys-lru" },
    { title: "Redis cache TTL tuning", content: "redis cache ttl tuned to 300s" },
    { title: "Redis cache persistence mode", content: "redis cache persistence uses aof everysec" },
  ];
  return seeds.map((s) =>
    propose(store, { ...s, project: "aria", type: "fix", tags: ["redis"], confirmed: true }),
  );
}

describe("token bag clustering", () => {
  test("cosine similarity of weighted bags is 0 for disjoint bags and symmetric", () => {
    const a = tokenBag("redis cache eviction");
    const b = tokenBag("redis cache ttl tuning");
    const s = cosineSimilarity(a, b);
    expect(s).toBeGreaterThan(0);
    expect(s).toBe(cosineSimilarity(b, a));
    expect(cosineSimilarity(a, tokenBag("dark theme colors"))).toBe(0);
    expect(cosineSimilarity(a, tokenBag(""))).toBe(0);
  });

  test("clusterByTokenOverlap groups similar items and separates dissimilar ones", () => {
    const items = [
      { id: "1", text: "redis cache eviction lru" },
      { id: "2", text: "redis cache ttl tuning" },
      { id: "3", text: "redis cache persistence aof" },
      { id: "4", text: "dark mode theme toggle colors" },
    ];
    const clusters = clusterByTokenOverlap(
      items,
      (i) => tokenBag(i.text),
      0.5,
    );
    expect(clusters.length).toBe(2);
    const big = clusters.find((c) => c.length === 3)!;
    expect(big.map((i) => i.id).sort()).toEqual(["1", "2", "3"]);
  });
});

describe("scene-based hierarchical consolidation", () => {
  test("clusters of >=3 similar confirmed entries become linked scene rollups", () => {
    const { root, memoryDir, store } = setup();
    const members = seedRedisCluster(store);
    // Distractor that must not join the cluster
    propose(store, { title: "Dark mode theme palette", content: "dark theme css variables", project: "aria", type: "fix", confirmed: true });

    const report = consolidateScenes(store);
    expect(report.scenesCreated.length).toBe(1);
    const scene = report.scenesCreated[0];
    expect(scene.title).toMatch(/^Scene: redis/);

    const sceneEntry = get(store, scene.id!)!;
    expect(sceneEntry.type).toBe("architecture");
    expect(sceneEntry.status).toBe("confirmed");
    for (const m of members) {
      expect(sceneEntry.content).toContain(m.id);
      expect(get(store, m.id)!.related_memory_ids).toContain(scene.id!);
    }
    expect(sceneEntry.related_memory_ids?.sort()).toEqual(members.map((m) => m.id).sort());

    cleanup(root);
  });

  test("is idempotent: second run skips clusters already covered by a scene", () => {
    const { root, memoryDir, store } = setup();
    seedRedisCluster(store);
    consolidateScenes(store);
    const countAfterFirst = list(store).length;

    const second = consolidateScenes(store);
    expect(second.scenesCreated.length).toBe(0);
    expect(second.skippedClusters.length).toBeGreaterThan(0);
    expect(list(store).length).toBe(countAfterFirst);

    cleanup(root);
  });

  test("dry-run reports scenes without writing anything", () => {
    const { root, memoryDir, store } = setup();
    seedRedisCluster(store);
    const before = list(store).length;

    const report = consolidateScenes(store, { dryRun: true });
    expect(report.scenesCreated.length).toBe(1);
    expect(report.scenesCreated[0].id).toBeUndefined();
    expect(list(store).length).toBe(before);

    cleanup(root);
  });

  test("clusters below minCluster size produce no scene", () => {
    const { root, memoryDir, store } = setup();
    propose(store, { title: "Redis cache eviction policy", content: "redis cache eviction lru", project: "aria", type: "fix", confirmed: true });
    propose(store, { title: "Redis cache TTL tuning", content: "redis cache ttl 300s", project: "aria", type: "fix", confirmed: true });

    const report = consolidateScenes(store);
    expect(report.scenesCreated.length).toBe(0);
    expect(list(store).filter((e) => e.title.startsWith("Scene:")).length).toBe(0);

    cleanup(root);
  });

  test("--project filter restricts clustering scope", () => {
    const { root, memoryDir, store } = setup();
    for (const p of ["aria", "other"]) {
      propose(store, { title: `Redis cache eviction ${p}`, content: `redis cache eviction lru ${p}`, project: p, type: "fix", confirmed: true });
      propose(store, { title: `Redis cache TTL tuning ${p}`, content: `redis cache ttl ${p}`, project: p, type: "fix", confirmed: true });
      propose(store, { title: `Redis cache persistence ${p}`, content: `redis cache aof ${p}`, project: p, type: "fix", confirmed: true });
    }
    const report = consolidateScenes(store, { project: "aria" });
    expect(report.scenesCreated.length).toBe(1);
    expect(report.scenesCreated[0].members.every((id) => id.includes("aria"))).toBe(true);

    cleanup(root);
  });
});
