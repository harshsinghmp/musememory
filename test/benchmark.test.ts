import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, save } from "../src/store.ts";
import { runMemoryBenchmark, formatBenchmarkScoreboard } from "../src/benchmark/suite.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("Repeatable Benchmark Suite & Telemetry Scoreboard", () => {
  let tempDir: string;
  let storeDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "muse-benchmark-test-"));
    storeDir = join(tempDir, ".memory");
    mkdirSync(storeDir, { recursive: true });
    mkdirSync(join(storeDir, "memories"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("measures cold start, microsecond hot cache, FTS5 retrieval, and token compression", async () => {
    const store = openStore(storeDir);

    // Populate a few test memories
    for (let i = 1; i <= 5; i++) {
      const entry: MemoryEntry = {
        id: `m_bench_${i}`,
        title: `Architectural Decision ${i}: Service Isolation`,
        content: `Detailed specifications for service boundary isolation and JWT token authentication rules ${i}.`,
        project: "benchmark-test",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["architecture", "auth", "security"],
      };
      save(store, entry);
    }

    const report = await runMemoryBenchmark(store, {
      iterations: 5,
      query: "service boundary JWT authentication",
      tokenBudget: 500,
      workspaceRoot: tempDir,
    });

    expect(report.iterations).toBe(5);
    expect(report.speed.cold_startup_ms).toBeGreaterThanOrEqual(0);

    // Hot cache lookup should be recorded in microseconds
    expect(report.speed.hot_cache_lookup.unit).toBe("µs");
    expect(report.speed.hot_cache_lookup.p50).toBeGreaterThanOrEqual(0);

    // FTS5 and knapsack retrieval in milliseconds
    expect(report.speed.fts5_search.unit).toBe("ms");
    expect(report.speed.fts5_search.p50).toBeGreaterThanOrEqual(0);
    expect(report.speed.knapsack_ranking.unit).toBe("ms");
    expect(report.speed.context_assembly.unit).toBe("ms");

    // Quality metrics
    expect(report.quality.total_memories).toBe(5);
    expect(report.quality.conflict_rate_pct).toBe(0);
    expect(report.quality.stale_rate_pct).toBe(0);
    expect(report.quality.roi_success_rate_pct).toBeGreaterThanOrEqual(0);

    // Token economy
    expect(report.tokens.raw_tokens_total).toBeGreaterThan(0);
    expect(report.tokens.packed_tokens_avg).toBeGreaterThanOrEqual(0);
    expect(report.tokens.compression_ratio_pct).toBeGreaterThanOrEqual(0);

    // Formatted scoreboard
    const scoreboard = formatBenchmarkScoreboard(report);
    expect(scoreboard).toContain("MUSE MEMORY ENGINE BENCHMARK & TELEMETRY SCOREBOARD");
    expect(scoreboard).toContain("Hot Cache Lookup");
    expect(scoreboard).toContain("FTS5 BM25 Retrieval");
    expect(scoreboard).toContain("KNOWLEDGE QUALITY & ROI");
    expect(scoreboard).toContain("TOKEN ECONOMY & EFFICIENCY");
  });
});
