export type RrfVariant = "control" | "treatment" | "A" | "B";

export interface RrfWeights {
  lexical?: number;
  semantic?: number;
  graph?: number;
  recency?: number;
  [signal: string]: number | undefined;
}

export interface RrfConfig {
  k?: number;
  weights?: RrfWeights;
  variant?: RrfVariant;
}

/**
 * T-120: Standard RRF A/B testing presets:
 * - Control (A): Standard balanced baseline (k=60, lexical=1.0, semantic=1.0, graph=0.8, recency=0.5).
 * - Treatment (B): Semantic & graph-boosted variant (k=60, lexical=0.8, semantic=1.2, graph=1.0, recency=0.6).
 */
export const RRF_PRESETS: Record<RrfVariant, { k: number; weights: RrfWeights }> = {
  control: {
    k: 60,
    weights: { lexical: 1.0, semantic: 1.0, graph: 0.8, recency: 0.5 },
  },
  A: {
    k: 60,
    weights: { lexical: 1.0, semantic: 1.0, graph: 0.8, recency: 0.5 },
  },
  treatment: {
    k: 60,
    weights: { lexical: 0.8, semantic: 1.2, graph: 1.0, recency: 0.6 },
  },
  B: {
    k: 60,
    weights: { lexical: 0.8, semantic: 1.2, graph: 1.0, recency: 0.6 },
  },
};

/**
 * Resolves active RRF configuration merging defaults, A/B presets, and custom overrides.
 */
export function resolveRrfConfig(config: RrfConfig = {}): { k: number; weights: RrfWeights; variant?: RrfVariant } {
  const variant = config.variant ?? "control";
  const preset = RRF_PRESETS[variant] ?? RRF_PRESETS.control;
  const k = typeof config.k === "number" && config.k > 0 ? config.k : preset.k;
  const weights: RrfWeights = {
    ...preset.weights,
    ...(config.weights ?? {}),
  };

  return { k, weights, variant };
}

/**
 * Computes RRF score for a single candidate from its ranked positions across signals:
 * RRF(d) = sum_{m in M} ( w_m * 1 / (k + r_m(d)) )
 */
export function calculateRrfItemScore(
  rankings: Array<{ rank: number; weight?: number; signal?: string }>,
  k: number = 60,
): number {
  let score = 0;
  for (const item of rankings) {
    if (item.rank > 0) {
      const weight = item.weight ?? 1.0;
      score += weight * (1 / (k + item.rank));
    }
  }
  return Number(score.toFixed(6));
}

export interface RrfFusedItem<T> {
  item: T;
  rrfScore: number;
  ranks: Record<string, number>;
}

/**
 * Fuses multiple sorted signal lists into a unified RRF-ranked array.
 * Each list in signalLists should be ordered from best (rank 1) to worst.
 */
export function reciprocalRankFusion<T extends { id: string }>(
  signalLists: Map<string, T[]>,
  config: RrfConfig = {},
): RrfFusedItem<T>[] {
  const { k, weights } = resolveRrfConfig(config);
  const itemsById = new Map<string, T>();
  const ranksById = new Map<string, Record<string, number>>();

  for (const [signalName, list] of signalLists.entries()) {
    list.forEach((item, index) => {
      itemsById.set(item.id, item);
      let ranks = ranksById.get(item.id);
      if (!ranks) {
        ranks = {};
        ranksById.set(item.id, ranks);
      }
      ranks[signalName] = index + 1;
    });
  }

  const fused: RrfFusedItem<T>[] = [];

  for (const [id, item] of itemsById.entries()) {
    const ranks = ranksById.get(id) ?? {};
    const rankings = Object.entries(ranks).map(([sig, rank]) => ({
      rank,
      weight: weights[sig] ?? 1.0,
      signal: sig,
    }));
    const rrfScore = calculateRrfItemScore(rankings, k);
    fused.push({ item, rrfScore, ranks });
  }

  fused.sort((a, b) => {
    if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
    return a.item.id.localeCompare(b.item.id);
  });

  return fused;
}
