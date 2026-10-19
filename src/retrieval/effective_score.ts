import type { MemoryEntry } from "../types.ts";

/**
 * T-119: Computes reinforcement multiplier based on explicit confirmation reinforcement
 * and empirical application utility outcomes.
 * Baseline: 1.0. Bounded between [0.2, 2.0].
 */
export function computeReinforcementMultiplier(entry: MemoryEntry): number {
  let multiplier = 1.0;

  // 1. Explicit reinforcement counter (+1 per confirmation, -1 per rejection/stale)
  if (typeof entry.reinforcement === "number") {
    // Each positive unit adds +0.05 (up to +0.25 at 5+), negative drops -0.05 per unit
    multiplier += Math.sign(entry.reinforcement) * 0.05 * Math.min(Math.abs(entry.reinforcement), 5);
  }

  // 2. Application utility feedback
  if (entry.utility && entry.utility.application_count >= 1) {
    const successRate = entry.utility.reuse_success_rate ?? 1.0;
    if (successRate >= 0.75) {
      multiplier += 0.20;
    } else if (successRate < 0.40) {
      multiplier -= 0.20;
    }
  }

  // 3. Clamped to [0.2, 2.0]
  return Number(Math.max(0.2, Math.min(2.0, multiplier)).toFixed(4));
}

/**
 * T-119: Unified closed-form composite formula:
 * effective_score = base × reinforcement × decay
 *
 * @param base Raw query relevance and code context score (clamped >= 0).
 * @param reinforcement Utility & reinforcement multiplier in [0.2, 2.0].
 * @param decay Materialized retention decay factor in (0.0, 1.0].
 */
export function computeEffectiveScore(
  base: number,
  reinforcement: number,
  decay: number,
): number {
  const clampedBase = Math.max(0, base);
  const clampedReinforcement = Math.max(0.2, Math.min(2.0, reinforcement));
  const clampedDecay = Math.max(0.05, Math.min(1.0, decay));

  return Number((clampedBase * clampedReinforcement * clampedDecay).toFixed(4));
}
