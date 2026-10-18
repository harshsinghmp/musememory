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

/**
 * T-078: Per-type default expiration horizons in days.
 * - fix: 90 days
 * - operation: 180 days
 * - architecture: 365 days
 * - discovery: 30 days
 * - preference: null (never expires)
 * - constraint: null (never expires)
 * - adr: 365 days
 * - negative: 180 days
 */
export const DEFAULT_EXPIRY_DAYS_BY_TYPE: Record<string, number | null> = {
  fix: 90,
  operation: 180,
  architecture: 365,
  discovery: 30,
  preference: null,
  constraint: null,
  adr: 365,
  negative: 180,
};

export function defaultExpiryDays(type?: string): number | null {
  if (!type) return null;
  if (type in DEFAULT_EXPIRY_DAYS_BY_TYPE) {
    return DEFAULT_EXPIRY_DAYS_BY_TYPE[type];
  }
  return stalePolicyDays(type);
}

export function computeDefaultExpiresAt(
  type?: string,
  baseTime: string | number | Date = Date.now(),
): string | undefined {
  const days = defaultExpiryDays(type);
  if (days === null || days === undefined) return undefined;
  const ms =
    baseTime instanceof Date
      ? baseTime.getTime()
      : typeof baseTime === "number"
      ? baseTime
      : Date.parse(baseTime);
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms + days * 86_400_000).toISOString();
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
 * T-077: Trust tier base half-lives (T1 365d → T4 30d).
 * Keyed by trust tier / provenance:
 * - T1 / trusted: 365 days (human / owner / principal / manual)
 * - T2 / verified: 180 days (corroborated candidate)
 * - T3 / candidate: 90 days (default agent / transcript)
 * - T4 / untrusted: 30 days (external / web / scraper)
 */
export const TRUST_TIER_HALF_LIVES: Record<string, number> = {
  "T1": 365,
  "trusted": 365,
  "T2": 180,
  "verified": 180,
  "T3": 90,
  "candidate": 90,
  "T4": 30,
  "untrusted": 30,
};

export function trustTierHalfLife(tier?: string): number | undefined {
  if (!tier) return undefined;
  return (
    TRUST_TIER_HALF_LIVES[tier] ??
    TRUST_TIER_HALF_LIVES[tier.toLowerCase()] ??
    TRUST_TIER_HALF_LIVES[tier.toUpperCase()]
  );
}

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
    trust?: string;
    trustTier?: string;
  },
): number | null {
  const base = defaultHalfLifeDays(type);
  if (base === null) return null;

  const verifyMult = VERIFICATION_STABILITY[opts.verificationLevel ?? "unverified"] ?? 0.5;
  const reinfBoost = (opts.reinforcement ?? 0) * 2; // +2 days per reinforcement level

  // A15: Access-frequency extension with diminishing returns.
  // Each access adds sqrt(accessCount) * 5 days, capped at 30 extra days.
  const accessExtension = Math.min(30, Math.sqrt(opts.accessCount) * 5);

  // T-077: Trust-tier-keyed half-life multiplier (T1 365d -> T4 30d).
  // Relative to T3 / candidate baseline (90 days):
  // - T1 / trusted (365d) => 365 / 90 (~4.055x)
  // - T2 / verified (180d) => 180 / 90 (2.0x)
  // - T3 / candidate (90d) => 90 / 90 (1.0x)
  // - T4 / untrusted (30d) => 30 / 90 (0.333x)
  const tier = opts.trust ?? opts.trustTier;
  const tierHalfLife = trustTierHalfLife(tier);
  const trustMultiplier =
    tierHalfLife !== undefined ? tierHalfLife / DEFAULT_HALF_LIFE_DAYS : 1.0;

  const baseEffective = (base * trustMultiplier) * verifyMult + reinfBoost + accessExtension;

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
 * T-081: Weibull decay curve parameters (shape k, scale multiplier).
 * Formula: R(t) = exp(-(t / lambda)^k)
 * where lambda = halfLife / (ln(2))^(1/k) so that R(halfLife) = 0.5 always holds.
 *
 * Curve dynamics:
 * - k < 1 (Infant mortality / durable tail): Early mortality, but surviving entries have high longevity.
 *   Optimal for architecture, decisions, adrs, constraints.
 * - k = 1 (Constant hazard): Standard memoryless exponential decay.
 *   Optimal for operations, generic sessions.
 * - k > 1 (Wear-out cliff): Freshness plateau with rapid subsequent obsolescence cliff.
 *   Optimal for bugfixes, temporary discoveries, library workarounds.
 */
export interface WeibullParameters {
  /** Shape parameter k (> 0). */
  k: number;
}

export const WEIBULL_TYPE_PROFILES: Record<string, WeibullParameters> = {
  architecture: { k: 0.7 },
  adr: { k: 0.7 },
  decision: { k: 0.8 },
  negative: { k: 0.8 },
  operation: { k: 1.0 },
  fix: { k: 1.6 },
  discovery: { k: 1.5 },
};

/**
 * Returns the Weibull parameters for a given memory type.
 * Defaults to k = 1.0 (exponential) if type is not recognized.
 */
export function weibullParametersForType(type?: string): WeibullParameters {
  if (type && type in WEIBULL_TYPE_PROFILES) {
    return WEIBULL_TYPE_PROFILES[type];
  }
  return { k: 1.0 };
}

/**
 * Re-derived Weibull retention function calibrated to a target half-life.
 * R(t) = exp(-(t / lambda)^k)
 *
 * At t = halfLife, R(halfLife) = exp(-(ln(2))) = 0.5.
 */
export function computeWeibullDecay(
  days: number,
  halfLife: number,
  k: number = 1.0,
): number {
  if (days <= 0) return 1.0;
  if (halfLife <= 0) return 0.0;
  if (k <= 0) return 1.0;

  // lambda = halfLife / (ln(2))^(1/k)
  const lambda = halfLife / Math.pow(Math.LN2, 1 / k);
  const score = Math.exp(-Math.pow(days / lambda, k));
  return Number(Math.max(0, Math.min(1.0, score)).toFixed(4));
}

/**
 * T-074 & T-081: Compute materialized decay score (1.0 = fully fresh, 0.0 = fully decayed)
 * based on elapsed days, importance-gated half-life, and optional Weibull decay curves.
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
    trust?: string;
    trust_tier?: string;
    decay_model?: "exponential" | "weibull";
  },
  now: number = Date.now(),
  options?: {
    decayModel?: "exponential" | "weibull";
    k?: number;
  },
): number {
  if (entry.temporal_mode === "timeless" || entry.type === "constraint") {
    return 1.0;
  }

  const halfLife = computeHalfLife(entry.type, {
    accessCount: entry.access_count ?? 0,
    verificationLevel: entry.verification?.level,
    reinforcement: entry.reinforcement,
    salience: entry.salience,
    trust: entry.trust ?? entry.trust_tier,
  });

  if (halfLife === null) return 1.0; // never decays

  const referenceTime = entry.valid_from ?? entry.last_accessed_at ?? entry.updated_at ?? entry.created_at;
  const ms = Date.parse(referenceTime);
  if (Number.isNaN(ms)) return 1.0;

  const days = Math.max(0, (now - ms) / 86_400_000);
  if (days <= 0) return 1.0;

  const model = options?.decayModel ?? entry.decay_model ?? "exponential";

  if (model === "weibull") {
    const k = options?.k ?? weibullParametersForType(entry.type).k;
    return computeWeibullDecay(days, halfLife, k);
  }

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
    trust?: string;
    trust_tier?: string;
  },
  now: number = Date.now(),
): number {
  const halfLife = computeHalfLife(entry.type, {
    accessCount: entry.access_count ?? 0,
    verificationLevel: entry.verification?.level,
    reinforcement: entry.reinforcement,
    salience: entry.salience,
    trust: entry.trust ?? entry.trust_tier,
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
    trust?: string;
    trust_tier?: string;
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
    salience?: number;
    trust?: string;
    trust_tier?: string;
  },
  now: number = Date.now(),
  threshold: number = DEFAULT_STALENESS_THRESHOLD,
): number {
  const halfLife = computeHalfLife(entry.type, {
    accessCount: entry.access_count ?? 0,
    verificationLevel: entry.verification?.level,
    reinforcement: entry.reinforcement,
    salience: entry.salience,
    trust: entry.trust ?? entry.trust_tier,
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

export * from "./retention/expiry_policy.ts";
