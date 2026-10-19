import type { MemoryEntry } from "../types.ts";

export type TaskIntent =
  | "feature"
  | "bugfix"
  | "refactor"
  | "review"
  | "architecture"
  | "general";

export interface IntentBiasConfig {
  types?: Record<string, number>;
  tags?: Record<string, number>;
  hasGraphBonus?: number;
  negativeBonus?: number;
}

/**
 * T-118: Deterministic query-intent bias multiplier configurations.
 * Multipliers prioritize memory types matching developer intent.
 */
export const INTENT_BIAS_TABLE: Record<TaskIntent, IntentBiasConfig> = {
  architecture: {
    types: { decision: 1.25, adr: 1.25, architecture: 1.25, constraint: 1.10 },
    tags: { adr: 1.25, architecture: 1.25, pattern: 1.15, design: 1.15 },
  },
  bugfix: {
    types: { fix: 1.25, failure: 1.25, negative: 1.25 },
    tags: { bug: 1.25, "anti-pattern": 1.25, gotcha: 1.20, fix: 1.20, error: 1.15 },
    negativeBonus: 1.25,
  },
  refactor: {
    types: { operation: 1.20, decision: 1.15, architecture: 1.15 },
    tags: { refactor: 1.20, convention: 1.20, standard: 1.15, migration: 1.15 },
    hasGraphBonus: 1.15,
  },
  review: {
    types: { constraint: 1.25, negative: 1.25 },
    tags: { security: 1.25, constraint: 1.25, "anti-pattern": 1.25, audit: 1.20, policy: 1.20 },
    negativeBonus: 1.25,
  },
  feature: {
    types: { decision: 1.15, discovery: 1.10 },
    tags: { feature: 1.15, pattern: 1.10, spec: 1.10 },
  },
  general: {},
};

/**
 * Heuristically detects task intent from query text if not explicitly provided.
 */
export function detectQueryIntent(query: string): TaskIntent {
  if (!query || typeof query !== "string") return "general";
  const lower = query.toLowerCase();

  // Architecture / design patterns
  if (/\b(why|architect|architecture|design|adr|pattern|tradeoff|decision|rfc|rationale)\b/.test(lower)) {
    return "architecture";
  }

  // Bugfix / debugging patterns
  if (/\b(fix|bug|broken|error|exception|crash|fail|fails|failing|failed|issue|panic|regress|regression|gotcha)\b/.test(lower)) {
    return "bugfix";
  }

  // Refactor patterns
  if (/\b(refactor|cleanup|clean up|restructure|reorganize|deprecate|modernize|split|extract)\b/.test(lower)) {
    return "refactor";
  }

  // Review / audit / security patterns
  if (/\b(review|audit|security|cve|vulnerability|flaw|leak|sanitize|check|verify|compliance)\b/.test(lower)) {
    return "review";
  }

  // Feature / implementation patterns
  if (/\b(add|implement|feature|create|build|support|new|extend|scaffold)\b/.test(lower)) {
    return "feature";
  }

  return "general";
}

/**
 * Computes query-intent bias multiplier for a memory candidate given an active intent.
 * Returns a value >= 1.0 (max 1.25).
 */
export function computeIntentMultiplier(intent: TaskIntent | undefined, entry: MemoryEntry): number {
  if (!intent || intent === "general") return 1.0;

  const config = INTENT_BIAS_TABLE[intent];
  if (!config) return 1.0;

  let maxMultiplier = 1.0;

  // 1. Type match
  if (entry.type && config.types && config.types[entry.type]) {
    maxMultiplier = Math.max(maxMultiplier, config.types[entry.type]);
  }

  // 2. Tag match
  if (entry.tags && config.tags) {
    for (const tag of entry.tags) {
      const lowerTag = tag.toLowerCase();
      if (config.tags[lowerTag]) {
        maxMultiplier = Math.max(maxMultiplier, config.tags[lowerTag]);
      }
    }
  }

  // 3. Negative pattern match
  if (config.negativeBonus && (entry.type === "negative" || entry.tags?.includes("anti-pattern") || entry.negative)) {
    maxMultiplier = Math.max(maxMultiplier, config.negativeBonus);
  }

  // 4. Graph structure match
  if (config.hasGraphBonus && entry.graph && ((entry.graph.affected_paths && entry.graph.affected_paths.length > 0) || (entry.graph.symbol_names && entry.graph.symbol_names.length > 0))) {
    maxMultiplier = Math.max(maxMultiplier, config.hasGraphBonus);
  }

  return Number(maxMultiplier.toFixed(2));
}
