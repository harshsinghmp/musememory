export type BenchmarkProvenanceKind = "MEASURED" | "CLAIMED";

export interface BenchmarkProvenance {
  kind: BenchmarkProvenanceKind;
  label: "[MEASURED]" | "[CLAIMED]";
  rationale: string;
  samples?: number;
  environment?: string;
  measured_at?: string;
}

export interface HonestMetric<T = number | string> {
  value: T;
  provenance: BenchmarkProvenance;
  unit?: string;
}

export interface HonestBenchmarkReport {
  iterations: number;
  timestamp: string;
  provenance: {
    runtime: string;
    os: string;
    arch: string;
  };
  speed: {
    cold_startup: HonestMetric<number>;
    hot_cache_lookup_p50: HonestMetric<number>;
    fts5_search_p50: HonestMetric<number>;
    knapsack_ranking_p50: HonestMetric<number>;
    context_assembly_p50: HonestMetric<number>;
  };
  targets: {
    cold_startup_sla: HonestMetric<number>;
    hot_cache_sla: HonestMetric<number>;
    fts5_search_sla: HonestMetric<number>;
    context_assembly_sla: HonestMetric<number>;
  };
  quality: {
    roi_success_rate: HonestMetric<number>;
    conflict_rate: HonestMetric<number>;
  };
  tokens: {
    compression_ratio: HonestMetric<number>;
  };
}

/**
 * Creates an honest metric with [MEASURED] provenance.
 */
export function createMeasuredMetric<T = number | string>(
  value: T,
  options: {
    samples?: number;
    environment?: string;
    measured_at?: string;
    rationale?: string;
    unit?: string;
  } = {}
): HonestMetric<T> {
  return {
    value,
    unit: options.unit,
    provenance: {
      kind: "MEASURED",
      label: "[MEASURED]",
      rationale: options.rationale || "Empirically sampled via performance.now() benchmark run.",
      samples: options.samples,
      environment: options.environment || `${process.platform}-${process.arch}`,
      measured_at: options.measured_at || new Date().toISOString(),
    },
  };
}

/**
 * Creates an honest metric with [CLAIMED] provenance for SLA targets or theoretical bounds.
 */
export function createClaimedMetric<T = number | string>(
  value: T,
  options: {
    rationale?: string;
    unit?: string;
  } = {}
): HonestMetric<T> {
  return {
    value,
    unit: options.unit,
    provenance: {
      kind: "CLAIMED",
      label: "[CLAIMED]",
      rationale: options.rationale || "Design SLA target or theoretical budget specification.",
    },
  };
}

/**
 * Formats a metric into a readable string with its honest label.
 */
export function formatHonestMetric(metric: HonestMetric): string {
  const unitSuffix = metric.unit ? ` ${metric.unit}` : "";
  return `${metric.provenance.label} ${metric.value}${unitSuffix}`;
}

/**
 * T-131: Audit markdown text or documentation to verify that performance claims
 * are honest (contain [MEASURED] or [CLAIMED] provenance labels).
 */
export function auditDocumentHonestLabels(markdown: string): {
  totalClaims: number;
  measuredCount: number;
  claimedCount: number;
  unlabeledClaims: string[];
  isHonest: boolean;
} {
  const lines = markdown.split("\n");
  const unlabeledClaims: string[] = [];
  let measuredCount = 0;
  let claimedCount = 0;

  // Patterns matching performance numbers like "< 5ms", "p50: 12ms", "latency 50us", "throughput 1000/s"
  const claimRegex = /(?:<|>|~)?\s*\d+(?:\.\d+)?\s*(?:ms|µs|us|tokens|req\/s|rps|%)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Check if line asserts a performance, latency, throughput, or benchmark number
    if (
      claimRegex.test(line) &&
      /(?:latency|p50|p95|p99|speed|fast|perf|benchmark|throughput|reduction|compression|target|bound|sla|ranking|retrieval|lookup|cache)/i.test(line)
    ) {
      if (line.includes("[MEASURED]")) {
        measuredCount++;
      } else if (line.includes("[CLAIMED]")) {
        claimedCount++;
      } else {
        unlabeledClaims.push(`Line ${i + 1}: ${line.trim().slice(0, 80)}`);
      }
    }
  }

  const totalClaims = measuredCount + claimedCount + unlabeledClaims.length;
  const isHonest = unlabeledClaims.length === 0;

  return {
    totalClaims,
    measuredCount,
    claimedCount,
    unlabeledClaims,
    isHonest,
  };
}

/**
 * Transforms benchmark latency and quality metrics into an HonestBenchmarkReport.
 */
export function toHonestBenchmarkReport(
  speed: {
    cold_startup_ms: number;
    hot_cache_lookup: { p50: number; unit: string };
    fts5_search: { p50: number; unit: string };
    knapsack_ranking: { p50: number; unit: string };
    context_assembly: { p50: number; unit: string };
  },
  quality: {
    roi_success_rate_pct: number;
    conflict_rate_pct: number;
  },
  tokens: {
    compression_ratio_pct: number;
  },
  iterations: number = 30
): HonestBenchmarkReport {
  return {
    iterations,
    timestamp: new Date().toISOString(),
    provenance: {
      runtime: `bun-${process.versions.bun || "node"}`,
      os: process.platform,
      arch: process.arch,
    },
    speed: {
      cold_startup: createMeasuredMetric(speed.cold_startup_ms, { samples: 1, unit: "ms", rationale: "Unprimed cold store open time" }),
      hot_cache_lookup_p50: createMeasuredMetric(speed.hot_cache_lookup.p50, { samples: iterations * 5, unit: speed.hot_cache_lookup.unit, rationale: "P50 memory lookup in warmed SQLite cache" }),
      fts5_search_p50: createMeasuredMetric(speed.fts5_search.p50, { samples: iterations, unit: speed.fts5_search.unit, rationale: "P50 BM25 FTS5 index query" }),
      knapsack_ranking_p50: createMeasuredMetric(speed.knapsack_ranking.p50, { samples: iterations, unit: speed.knapsack_ranking.unit, rationale: "P50 knapsack ranking with token packing" }),
      context_assembly_p50: createMeasuredMetric(speed.context_assembly.p50, { samples: Math.min(iterations, 15), unit: speed.context_assembly.unit, rationale: "P50 full orchestrator context fusion" }),
    },
    targets: {
      cold_startup_sla: createClaimedMetric(10.0, { unit: "ms", rationale: "Target SLA bound for unprimed store init" }),
      hot_cache_sla: createClaimedMetric(50.0, { unit: "µs", rationale: "Target SLA bound for cached memory read" }),
      fts5_search_sla: createClaimedMetric(15.0, { unit: "ms", rationale: "Target SLA bound for full BM25 search" }),
      context_assembly_sla: createClaimedMetric(50.0, { unit: "ms", rationale: "Target SLA bound for context fusion" }),
    },
    quality: {
      roi_success_rate: createMeasuredMetric(quality.roi_success_rate_pct, { unit: "%", rationale: "Observed memory application success rate" }),
      conflict_rate: createMeasuredMetric(quality.conflict_rate_pct, { unit: "%", rationale: "Active contradiction frequency" }),
    },
    tokens: {
      compression_ratio: createMeasuredMetric(tokens.compression_ratio_pct, { unit: "%", rationale: "Measured tokens saved via knapsack packing" }),
    },
  };
}
