/**
 * R23: Retention scheduling with access-weighted half-life decay curves.
 *
 * A15: Access-frequency retention — entries accessed more frequently are
 *      retained longer; each access extends the decay curve.
 * A18: Decay-stability coupling — entries with higher reinforcement and
 *      verification levels have longer half-lives, preventing premature eviction.
 *
 * The half-life formula uses a base half-life per memory type, extended by
 * access frequency (diminishing returns) and verification/reinforcement boosts.
 */

import { DEFAULT_STALE_DAYS } from "./types.ts";

/** Baseline half-life for types with no explicit entry in DECAY_POLICIES. */
export const DEFAULT_HALF_LIFE_DAYS = 90;

/** Staleness score (0-1) at or above which an entry is considered stale. */
export const DEFAULT_STALENESS_THRESHOLD = 0.7;

/**
 * Per-type decay policy — the SINGLE source of truth for R23 decay curves.
 *
 * Two deliberately distinct horizons:
 * - `half_life_days`: soft decay (A15/A18). Drives computeHalfLife /
 *   computeStaleness, and is extended at runtime by access frequency and
 *   verification level. `null` = never decays.
 * - `stale_after_days`: hard TTL used by `memory stale`, schema validation
 *   warnings, and archival promotion. `null` = never flagged stale.
 *
 * These are different concepts, so they carry different numbers. Both live
 * here so they cannot drift apart again — do NOT redeclare a policy table in
 * types.ts or retrieval.ts; import from this module instead.
 */
export interface DecayPolicy {
  half_life_days: number | null;
  stale_after_days: number | null;
}

export const DECAY_POLICIES: Record<string, DecayPolicy> = {
  fix: { half_life_days: 120, stale_after_days: 90 },
  operation: { half_life_days: DEFAULT_HALF_LIFE_DAYS, stale_after_days: 180 },
  architecture: { half_life_days: 365, stale_after_days: 365 },
  discovery: { half_life_days: 45, stale_after_days: 30 },
  preference: { half_life_days: null, stale_after_days: null },
  adr: { half_life_days: 365, stale_after_days: DEFAULT_STALE_DAYS },
  constraint: { half_life_days: 365, stale_after_days: DEFAULT_STALE_DAYS },
  negative: { half_life_days: 180, stale_after_days: DEFAULT_STALE_DAYS },
};

/** Default half-life in days for a memory type. null = never decays. */
export function defaultHalfLifeDays(type?: string): number | null {
  const policy = type ? DECAY_POLICIES[type] : undefined;
  return policy ? policy.half_life_days : DEFAULT_HALF_LIFE_DAYS;
}

/**
 * Hard staleness TTL in days per memory type. null = never stale.
 * Consumed by `memory stale`, schema validation, archival, and the governor.
 */
export function stalePolicyDays(type?: string): number | null {
  const policy = type ? DECAY_POLICIES[type] : undefined;
  return policy ? policy.stale_after_days : DEFAULT_STALE_DAYS;
}

export interface StalenessPolicy {
  /** Base half-life in days (null = never stale). */
  halfLifeDays: number | null;
  /** Multiplier from verification level (0.5 = half as stable, 2.0 = double). */
  verificationMultiplier: number;
  /** Boost per reinforcement level (confirmations). */
  reinforcementBoost: number;
}

/** Verification-level stability multipliers (A18). */
export const VERIFICATION_STABILITY: Record<string, number> = {
  "unverified": 0.5,
  "observed": 0.8,
  "reproducible": 1.0,
  "user-confirmed": 1.2,
  "authoritative": 1.5,
  "independently-verified": 2.0,
};

/**
 * Compute the effective half-life in days for a memory entry.
 * Combines base half-life (A15, A18) with access-frequency extension and
 * verification/reinforcement boosts.
 */
export function computeHalfLife(
  type: string | undefined,
  opts: {
    accessCount: number;
    verificationLevel?: string;
    reinforcement?: number;
    salience?: number;
    importance?: number;
  },
): number | null {
  const base = defaultHalfLifeDays(type);
  if (base === null) return null;

  const verifyMult = VERIFICATION_STABILITY[opts.verificationLevel ?? "unverified"] ?? 0.5;
  const reinfBoost = (opts.reinforcement ?? 0) * 2; // +2 days per reinforcement level

  // A15: Access-frequency extension with diminishing returns.
  // Each access adds sqrt(accessCount) * 5 days, capped at 30 extra days.
  const accessExtension = Math.min(30, Math.sqrt(opts.accessCount) * 5);

  const baseEffective = base * verifyMult + reinfBoost + accessExtension;

  // T-074: Importance-gated half-life multiplier.
  // Salience / importance ranges from 0.0 to 1.0.
  // When explicitly provided, low salience (e.g. 0.1) shrinks half-life,
  // while high salience (e.g. 1.0) extends half-life up to 2.5x.
  const imp =
    typeof opts.salience === "number"
      ? opts.salience
      : typeof opts.importance === "number"
      ? opts.importance
      : undefined;
  const importanceMultiplier =
    imp !== undefined ? Math.max(0.4, Math.min(3.0, 0.5 + imp * 2.0)) : 1.0;

  return Math.round(baseEffective * importanceMultiplier);
}

/**
 * T-074: Compute materialized decay score (1.0 = fully fresh, 0.0 = fully decayed)
 * based on elapsed days and importance-gated half-life.
 */
export function computeDecayScore(
  entry: {
    type?: string;
    last_accessed_at?: string | null;
    created_at: string;
    updated_at: string;
    valid_from?: string;
    verification?: { level?: string; [key: string]: any };
    reinforcement?: number;
    access_count?: number | null;
    salience?: number;
    temporal_mode?: string;
  },
  now: number = Date.now(),
): number {
  if (entry.temporal_mode === "timeless" || entry.type === "constraint") {
    return 1.0;
  }

  const halfLife = computeHalfLife(entry.type, {
    accessCount: entry.access_count ?? 0,
    verificationLevel: entry.verification?.level,
    reinforcement: entry.reinforcement,
    salience: entry.salience,
  });

  if (halfLife === null) return 1.0; // never decays

  const referenceTime = entry.valid_from ?? entry.last_accessed_at ?? entry.updated_at ?? entry.created_at;
  const ms = Date.parse(referenceTime);
  if (Number.isNaN(ms)) return 1.0;

  const days = Math.max(0, (now - ms) / 86_400_000);
  if (days <= 0) return 1.0;

  // Exponential retention: decay_score = exp(-ln(2) * days / halfLife) = 0.5^(days / halfLife)
  const score = Math.exp((-Math.LN2 * days) / halfLife);
  return Number(Math.max(0, Math.min(1.0, score)).toFixed(4));
}

/**
 * Compute a staleness score (0–1) for an entry.
 * 0 = fresh (recently confirmed), 1 = stale (long past half-life).
 *
 * Uses exponential decay: staleness = 1 - exp(-days / halfLife)
 */
export function computeStaleness(
  entry: {
    type?: string;
    last_accessed_at?: string | null;
    created_at: string;
    updated_at: string;
    verification?: { level?: string };
    reinforcement?: number;
    access_count?: number | null;
    salience?: number;
  },
  now: number = Date.now(),
): number {
  const halfLife = computeHalfLife(entry.type, {
    accessCount: entry.access_count ?? 0,
    verificationLevel: entry.verification?.level,
    reinforcement: entry.reinforcement,
    salience: entry.salience,
  });

  if (halfLife === null) return 0; // never decays

  // Use last_accessed_at if available, fall back to created_at
  const referenceTime = entry.last_accessed_at ?? entry.created_at;
  const ms = Date.parse(referenceTime);
  if (Number.isNaN(ms)) return 0.5; // neutral if unparseable

  const days = Math.max(0, (now - ms) / 86_400_000);
  if (days === 0) return 0;

  // Exponential decay: at half-life, staleness ≈ 0.632
  return 1 - Math.exp(-days / halfLife);
}

/**
 * Determine if an entry should be considered stale for archival purposes.
 */
export function isStale(
  entry: {
    type?: string;
    last_accessed_at?: string | null;
    created_at: string;
    updated_at: string;
    verification?: { level?: string };
    reinforcement?: number;
    access_count?: number | null;
  },
  now: number = Date.now(),
  threshold: number = DEFAULT_STALENESS_THRESHOLD,
): boolean {
  return computeStaleness(entry, now) >= threshold;
}

/**
 * Compute staleness days remaining before an entry hits threshold.
 * Returns negative if already past the staleness threshold.
 */
export function stalenessDaysRemaining(
  entry: {
    type?: string;
    last_accessed_at?: string | null;
    created_at: string;
    updated_at: string;
    verification?: { level?: string };
    reinforcement?: number;
    access_count?: number | null;
  },
  now: number = Date.now(),
  threshold: number = DEFAULT_STALENESS_THRESHOLD,
): number {
  const halfLife = computeHalfLife(entry.type, {
    accessCount: entry.access_count ?? 0,
    verificationLevel: entry.verification?.level,
    reinforcement: entry.reinforcement,
  });

  if (halfLife === null) return Infinity;

  const referenceTime = entry.last_accessed_at ?? entry.created_at;
  const ms = Date.parse(referenceTime);
  if (Number.isNaN(ms)) return 0;

  const currentStaleness = computeStaleness(entry, now);
  if (currentStaleness >= threshold) return -1;

  // Solve for the time when staleness = threshold:
  // 1 - exp(-T/halfLife) = threshold
  // T = -halfLife * ln(1 - threshold)
  const targetDays = -halfLife * Math.log(1 - threshold);
  const currentDays = (now - ms) / 86_400_000;

  return Math.ceil(targetDays - currentDays);
}
