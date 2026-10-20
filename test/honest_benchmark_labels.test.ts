import { describe, it, expect } from "bun:test";
import {
  createMeasuredMetric,
  createClaimedMetric,
  formatHonestMetric,
  auditDocumentHonestLabels,
  toHonestBenchmarkReport,
} from "../src/benchmark/labels.ts";
import { formatBenchmarkScoreboard, type BenchmarkReport } from "../src/benchmark/suite.ts";

describe("T-131: honest benchmark labels (measured-vs-claimed) on all published numbers", () => {
  describe("Metric creation and formatting", () => {
    it("creates an honest measured metric with [MEASURED] label and environment provenance", () => {
      const metric = createMeasuredMetric(14.2, {
        samples: 100,
        unit: "ms",
        rationale: "FTS5 BM25 search latency benchmark",
      });

      expect(metric.value).toBe(14.2);
      expect(metric.unit).toBe("ms");
      expect(metric.provenance.kind).toBe("MEASURED");
      expect(metric.provenance.label).toBe("[MEASURED]");
      expect(metric.provenance.samples).toBe(100);
      expect(metric.provenance.environment).toBeDefined();
      expect(metric.provenance.measured_at).toBeDefined();

      const formatted = formatHonestMetric(metric);
      expect(formatted).toBe("[MEASURED] 14.2 ms");
    });

    it("creates an honest claimed metric with [CLAIMED] label for design SLA targets", () => {
      const metric = createClaimedMetric(50, {
        unit: "µs",
        rationale: "Hot cache lookup SLA bound",
      });

      expect(metric.value).toBe(50);
      expect(metric.unit).toBe("µs");
      expect(metric.provenance.kind).toBe("CLAIMED");
      expect(metric.provenance.label).toBe("[CLAIMED]");

      const formatted = formatHonestMetric(metric);
      expect(formatted).toBe("[CLAIMED] 50 µs");
    });
  });

  describe("toHonestBenchmarkReport transformation", () => {
    it("transforms raw benchmark measurements into an honest benchmark report", () => {
      const honestReport = toHonestBenchmarkReport(
        {
          cold_startup_ms: 8.5,
          hot_cache_lookup: { p50: 25.0, unit: "µs" },
          fts5_search: { p50: 4.8, unit: "ms" },
          knapsack_ranking: { p50: 3.2, unit: "ms" },
          context_assembly: { p50: 12.0, unit: "ms" },
        },
        {
          roi_success_rate_pct: 95,
          conflict_rate_pct: 0.5,
        },
        {
          compression_ratio_pct: 45,
        },
        50
      );

      expect(honestReport.iterations).toBe(50);
      expect(honestReport.speed.fts5_search_p50.provenance.label).toBe("[MEASURED]");
      expect(honestReport.speed.fts5_search_p50.value).toBe(4.8);
      expect(honestReport.targets.fts5_search_sla.provenance.label).toBe("[CLAIMED]");
      expect(honestReport.targets.fts5_search_sla.value).toBe(15.0);
      expect(honestReport.quality.roi_success_rate.provenance.label).toBe("[MEASURED]");
    });
  });

  describe("Documentation honesty auditing", () => {
    it("verifies documents where all numbers have honest [MEASURED] or [CLAIMED] labels", () => {
      const honestDoc = `
# System Performance
- Hot cache lookup latency: [MEASURED] 25 µs (p50 across 500 samples)
- FTS5 retrieval speed: [MEASURED] 4.8 ms on local SQLite FTS5 index
- Target SLA bound: [CLAIMED] < 15 ms context assembly target
- Compression efficiency: [MEASURED] 45% tokens saved
`;
      const audit = auditDocumentHonestLabels(honestDoc);
      expect(audit.isHonest).toBe(true);
      expect(audit.unlabeledClaims.length).toBe(0);
      expect(audit.measuredCount).toBe(3);
      expect(audit.claimedCount).toBe(1);
    });

    it("flags unlabeled performance claims as dishonest and reports line locations", () => {
      const dishonestDoc = `
# Marketing Performance Claims
- Our lightning-fast speed delivers 5ms latency everywhere!
- p50 benchmark retrieval takes 3ms across all engines.
- [MEASURED] Knapsack ranking takes 2.1 ms on M2 MacBook.
`;
      const audit = auditDocumentHonestLabels(dishonestDoc);
      expect(audit.isHonest).toBe(false);
      expect(audit.unlabeledClaims.length).toBe(2);
      expect(audit.unlabeledClaims[0]).toContain("Line 3");
      expect(audit.unlabeledClaims[1]).toContain("Line 4");
      expect(audit.measuredCount).toBe(1);
    });
  });

  describe("formatBenchmarkScoreboard provenance labels", () => {
    it("scoreboard table renders [MEASURED] and [CLAIMED] provenance labels", () => {
      const mockReport: BenchmarkReport = {
        iterations: 30,
        timestamp: "2026-10-20T00:00:00.000Z",
        speed: {
          cold_startup_ms: 12.0,
          hot_cache_lookup: { min: 10, p50: 25, p95: 40, p99: 50, max: 60, unit: "µs" },
          fts5_search: { min: 2, p50: 5, p95: 10, p99: 12, max: 15, unit: "ms" },
          knapsack_ranking: { min: 1, p50: 3, p95: 6, p99: 8, max: 10, unit: "ms" },
          context_assembly: { min: 8, p50: 15, p95: 25, p99: 30, max: 35, unit: "ms" },
        },
        quality: {
          total_memories: 100,
          duplicate_rate_pct: 0,
          conflict_rate_pct: 1.0,
          stale_rate_pct: 2.0,
          roi_success_rate_pct: 98,
        },
        tokens: {
          raw_tokens_total: 10000,
          packed_tokens_avg: 1500,
          compression_ratio_pct: 85,
        },
      };

      const table = formatBenchmarkScoreboard(mockReport);
      expect(table).toContain("[MEASURED] Hot Cache");
      expect(table).toContain("[MEASURED] FTS5 BM25");
      expect(table).toContain("[CLAIMED] SLA Target Bounds");
      expect(table).toContain("[MEASURED] Memory ROI");
      expect(table).toContain("[MEASURED] Compression");
    });
  });
});
