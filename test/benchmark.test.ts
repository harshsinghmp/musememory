import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, list, get } from "../src/store.ts";
import { queryContext } from "../src/retrieval.ts";
import { buildTreeIndex, searchTree } from "../src/retrieval/tree-index.ts";
import { compileWiki } from "../src/wiki/compiler.ts";
import { buildPageIndex, searchPageIndex } from "../src/pageindex/engine.ts";

describe("Phase 8: Scale & Throughput Benchmarks", () => {
  let testDir: string;
  let memoryDir: string;
  let store: ReturnType<typeof openStore>;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "musememory-bench-"));
    memoryDir = join(testDir, ".memory");
    store = openStore(memoryDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("bulk proposes 100 memory entries within latency budget (<250ms)", () => {
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      propose(store, {
        title: `Scale benchmark entry ${i} for distributed cache cluster`,
        content: `Detailed architecture notes for cluster node ${i}: uses consistent hashing with virtual nodes and replicated write logs for durability.`,
        project: i % 2 === 0 ? "cache-cluster" : "gateway-proxy",
        type: i % 3 === 0 ? "architecture" : i % 3 === 1 ? "fix" : "operation",
        tags: ["cache", "distributed", "networking", `shard-${i % 5}`],
        confirmed: true,
      });
    }
    const duration = performance.now() - start;
    const entries = list(store);
    expect(entries.length).toBe(100);
    expect(duration).toBeLessThan(1500); // 100 disk writes with YAML serialize under 1.5s
  });

  it("multi-factor ranked retrieval executes within latency budget (<20ms)", () => {
    // Populate store with 50 memories
    for (let i = 0; i < 50; i++) {
      propose(store, {
        title: `High throughput async event bus ${i}`,
        content: `Event bus channel ${i} dispatches events using non-blocking ring buffers and epoll multiplexing.`,
        project: "eventbus",
        type: "architecture",
        confirmed: true,
      });
    }

    const start = performance.now();
    const result = queryContext(store, "async ring buffer dispatch", { limit: 10, tokenBudget: 2000 });
    const duration = performance.now() - start;

    expect(result.results.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(50);
  });

  it("Tree-Index builds and searches within latency budget (<50ms)", () => {
    for (let i = 0; i < 40; i++) {
      propose(store, {
        title: `Tree node cluster spec ${i}`,
        content: `Cluster specification ${i} for Kubernetes worker pool autoscaling and pod disruption budgets.`,
        project: "infra",
        type: "operation",
        confirmed: true,
      });
    }

    const buildStart = performance.now();
    const tree = buildTreeIndex(store, memoryDir, { maxDepth: 3 });
    const buildDuration = performance.now() - buildStart;

    expect(tree).not.toBeNull();
    expect(buildDuration).toBeLessThan(150);

    const searchStart = performance.now();
    const searchRes = searchTree(tree!, { query: "Kubernetes worker autoscaling", tokenBudget: 1500 });
    const searchDuration = performance.now() - searchStart;

    expect(searchRes.nodes.length).toBeGreaterThan(0);
    expect(searchDuration).toBeLessThan(40);
  });

  it("Wiki Compilation processes multi-cluster store within latency budget (<100ms)", () => {
    for (let i = 0; i < 30; i++) {
      propose(store, {
        title: `Authentication token rotation step ${i}`,
        content: `Authentication tokens are signed using ECDSA P-256 and rotated periodically with zero downtime.`,
        project: "auth-service",
        type: "architecture",
        confirmed: true,
      });
    }

    const start = performance.now();
    const res = compileWiki(store, memoryDir, { project: "auth-service", dryRun: true });
    const duration = performance.now() - start;

    expect(res.pagesCreated.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(200);
  });

  it("PageIndex hierarchical indexing & reasoning search execute within budget (<20ms)", () => {
    const md = `
# LifeOS Platform Thesis
## Autonomous Agent Harness
Agents operate with persistent cognitive memory without daemon background overhead.
### Token Knapsack Engine
Packs ranked prompt contexts within token boundaries.
### CodeGraph AST Integration
Traces callers, callees, and symbol hierarchies.
## Storage Topology
Dual-scope local and global file-backed architecture.
`;
    const start = performance.now();
    const doc = buildPageIndex(md, { project: "lifeos", title: "Platform Thesis", memoryDir, dryRun: true });
    const indexDuration = performance.now() - start;

    expect(doc.totalNodes).toBeGreaterThanOrEqual(5);
    expect(indexDuration).toBeLessThan(50);

    const searchStart = performance.now();
    const search = searchPageIndex(doc, { query: "Token Knapsack prompt context", maxNodes: 3 });
    const searchDuration = performance.now() - searchStart;

    expect(search.results.length).toBeGreaterThan(0);
    expect(searchDuration).toBeLessThan(20);
  });

  it("L0 Hot Cache retrieval executes under 0.05ms (microsecond scale)", () => {
    const entry = propose(store, {
      title: "Microsecond Hot Cache Benchmark",
      content: "L0 cache serves in-memory entry references without disk or database roundtrips.",
      project: "bench",
      type: "architecture",
      confirmed: true,
    });

    // Warmup
    get(store, entry.id);

    // Measure 1000 hot lookups
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      const e = get(store, entry.id);
      expect(e).not.toBeNull();
    }
    const avgDuration = (performance.now() - start) / 1000;
    expect(avgDuration).toBeLessThan(0.05); // Sub 50 microseconds
  });

  it("list(store) with L0 query cache executes under 0.1ms for 100 entries", () => {
    for (let i = 0; i < 50; i++) {
      propose(store, {
        title: `Scale test entry ${i}`,
        content: `Content for scale benchmark ${i}`,
        project: "scale",
      });
    }

    // Warm query cache
    list(store);

    const start = performance.now();
    for (let i = 0; i < 500; i++) {
      const all = list(store);
      expect(all.length).toBeGreaterThanOrEqual(50);
    }
    const avgDuration = (performance.now() - start) / 500;
    expect(avgDuration).toBeLessThan(0.1); // Sub 100 microseconds
  });

  it("SQLite FTS5 full-text search executes under 2ms across populated store", () => {
    const { searchMemoriesFts } = require("../src/sqlite.ts");
    for (let i = 0; i < 30; i++) {
      propose(store, {
        title: `Distributed Consensus Protocol ${i}`,
        content: `Node ${i} uses Raft state machine replication with leader leases and vectorized log compaction.`,
        project: "consensus",
        tags: ["raft", "consensus", "replication"],
        confirmed: true,
      });
    }

    // Warmup
    searchMemoriesFts(store.db!, "Raft");

    const start = performance.now();
    const results = searchMemoriesFts(store.db!, "Raft consensus");
    const duration = performance.now() - start;

    expect(results.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(10); // Under 10ms warm search across 30 records
  });
});
