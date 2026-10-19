import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { openStore, propose } from "../src/store.ts";
import { queryContext } from "../src/retrieval.ts";
import { RetrievalEngine } from "../src/retrieval/engine.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("T-097: prefer_observations recall-time dedup scoped to top-2x budget", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-prefer-obs-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("favors observation-backed memory over abstract near-duplicate when prefer_observations is true", () => {
    const store = openStore(tmpDir);

    // 1. Abstract/speculative architectural memory
    const abstractMem = propose(store, {
      content: "Redis connection pool timeout occurs after 5000ms under heavy concurrency loads",
      project: "backend",
      title: "Redis Connection Timeout Speculation",
      type: "architecture",
      source: "agent",
    });

    // 2. Concrete empirical observation from test with evidence
    const observationMem = propose(store, {
      content: "Redis connection pool timeout occurs after 5000ms under heavy concurrency loads in production",
      project: "backend",
      title: "Redis Connection Timeout Empirical Fix",
      type: "fix",
      source: "test",
      evidence: [
        {
          id: "ev-redis-1",
          type: "test",
          timestamp: new Date().toISOString(),
          excerpt: "TimeoutError: connection pool timeout after 5000ms",
        },
      ],
    });

    // Query with prefer_observations: true
    const res = queryContext(store, "Redis connection pool timeout", {
      project: "backend",
      limit: 5,
      prefer_observations: true,
    });

    const resultIds = res.results.map((r) => r.entry.id);
    expect(resultIds).toContain(observationMem.id);
    expect(resultIds).not.toContain(abstractMem.id);
    expect(res.deduped_count).toBeGreaterThanOrEqual(1);

    const withheldObs = res.withheld?.find((w) => w.id === abstractMem.id);
    expect(withheldObs).toBeDefined();
    expect(withheldObs?.reason).toBe("observation_preferred");
  });

  it("does not suppress near-duplicates when prefer_observations is disabled", () => {
    const store = openStore(tmpDir);

    const mem1 = propose(store, {
      content: "Database pool max connections configured to 50 sockets",
      project: "db",
      title: "DB Pool Size A",
      type: "architecture",
    });

    const mem2 = propose(store, {
      content: "Database pool max connections configured to 50 sockets in cluster",
      project: "db",
      title: "DB Pool Size B",
      type: "fix",
      evidence: [{ id: "ev1", type: "code", timestamp: new Date().toISOString() }],
    });

    const res = queryContext(store, "Database pool max connections", {
      project: "db",
      limit: 5,
      prefer_observations: false,
    });

    const resultIds = res.results.map((r) => r.entry.id);
    expect(resultIds).toContain(mem1.id);
    expect(resultIds).toContain(mem2.id);
    expect(res.deduped_count).toBeUndefined();
  });

  it("applies observation bonus (+0.10) in scoring when prefer_observations is true", () => {
    const store = openStore(tmpDir);

    const abstractMem = propose(store, {
      content: "Kafka partition rebalance takes 30 seconds on worker crash",
      project: "kafka",
      title: "Kafka Rebalance Theory",
      type: "discovery",
      salience: 0.5,
    });

    const obsMem = propose(store, {
      content: "Kafka consumer group lag spikes during partition rebalance",
      project: "kafka",
      title: "Kafka Rebalance Observed Spike",
      type: "fix",
      source: "tool",
      evidence: [{ id: "ev-k", type: "test", timestamp: new Date().toISOString() }],
      salience: 0.5,
    });

    const res = queryContext(store, "Kafka partition rebalance", {
      project: "kafka",
      limit: 10,
      prefer_observations: true,
    });

    const obsResult = res.results.find((r) => r.entry.id === obsMem.id);
    expect(obsResult).toBeDefined();
    expect(obsResult?.score).toBeGreaterThan(0.5);
  });

  it("surfaces deduped_count through RetrievalEngine.search", () => {
    const store = openStore(tmpDir);

    propose(store, {
      content: "GraphQL schema stitching gateway memory usage exceeds 2GB",
      project: "api",
      title: "Gateway Memory Usage Abstract",
      type: "architecture",
    });

    propose(store, {
      content: "GraphQL schema stitching gateway memory usage exceeds 2GB during query batching",
      project: "api",
      title: "Gateway Memory Usage Observed Fix",
      type: "fix",
      source: "test",
      evidence: [{ id: "ev-g", type: "test", timestamp: new Date().toISOString() }],
    });

    const engineRes = RetrievalEngine.search(store, tmpDir, "GraphQL gateway memory usage", {
      project: "api",
      mode: "exact",
      prefer_observations: true,
    });

    expect(engineRes.deduped_count).toBeGreaterThanOrEqual(1);
    expect(engineRes.withheld?.some((w) => w.reason === "observation_preferred")).toBe(true);
  });
});
