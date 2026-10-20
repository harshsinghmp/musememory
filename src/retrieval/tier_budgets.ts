export type RetrievalTier = 0 | 1 | 2;

export interface BudgetProvenance {
  origin: string;
  rationale: string;
  targetSlaMs: number;
  authoritativeStandard: string;
}

export interface TierBudgetDefinition {
  tier: RetrievalTier;
  name: string;
  defaultTokens: number;
  maxTokens: number;
  provenance: BudgetProvenance;
}

/**
 * T-125: Authoritative Tier Budgets & Provenance Standard.
 * Named constants with origins, architectural rationales, token ceilings, and target SLAs.
 */
export const TIER_BUDGET_PROVENANCE: Record<`TIER_${RetrievalTier}`, TierBudgetDefinition> & {
  USER_PROFILE_RESERVED: {
    name: string;
    ratio: number;
    defaultTokens: number;
    maxTokens: number;
    provenance: BudgetProvenance;
  };
} = {
  TIER_0: {
    tier: 0,
    name: "Tier 0 (Manifest)",
    defaultTokens: 80,
    maxTokens: 200,
    provenance: {
      origin: "ADR-012 / T-125 Tier Budgets Provenance Standard",
      rationale: "Ultra-compact single-line memory ID, type, and title index for instant routing without body loading",
      targetSlaMs: 2,
      authoritativeStandard: "RFC-MUSE-TIER-0",
    },
  },
  TIER_1: {
    tier: 1,
    name: "Tier 1 (Routing Set)",
    defaultTokens: 400,
    maxTokens: 1000,
    provenance: {
      origin: "ADR-012 / T-125 Tier Budgets Provenance Standard",
      rationale: "Working context set with active USER profile, CURRENT invariants, and L0 routing abstracts",
      targetSlaMs: 10,
      authoritativeStandard: "RFC-MUSE-TIER-1",
    },
  },
  TIER_2: {
    tier: 2,
    name: "Tier 2 (Bounded Bodies)",
    defaultTokens: 4000,
    maxTokens: 16000,
    provenance: {
      origin: "ADR-012 / T-125 Tier Budgets Provenance Standard",
      rationale: "Full multi-factor ranked memory bodies fitted greedily into knapsack token budget",
      targetSlaMs: 50,
      authoritativeStandard: "RFC-MUSE-TIER-2",
    },
  },
  USER_PROFILE_RESERVED: {
    name: "User Profile Reserved Ratio",
    ratio: 0.20,
    defaultTokens: 400,
    maxTokens: 800,
    provenance: {
      origin: "T-094 Persona Guideline Reservation",
      rationale: "Guaranteed headroom for USER.md persona rules before body knapsack fills",
      targetSlaMs: 1,
      authoritativeStandard: "RFC-MUSE-PROFILE-RESERVE",
    },
  },
};

export const TIER_0_DEFAULT_BUDGET = TIER_BUDGET_PROVENANCE.TIER_0.defaultTokens;
export const TIER_0_MAX_BUDGET = TIER_BUDGET_PROVENANCE.TIER_0.maxTokens;

export const TIER_1_DEFAULT_BUDGET = TIER_BUDGET_PROVENANCE.TIER_1.defaultTokens;
export const TIER_1_MAX_BUDGET = TIER_BUDGET_PROVENANCE.TIER_1.maxTokens;

export const TIER_2_DEFAULT_BUDGET = TIER_BUDGET_PROVENANCE.TIER_2.defaultTokens;
export const TIER_2_MAX_BUDGET = TIER_BUDGET_PROVENANCE.TIER_2.maxTokens;

export const USER_PROFILE_DEFAULT_BUDGET = TIER_BUDGET_PROVENANCE.USER_PROFILE_RESERVED.defaultTokens;
export const USER_PROFILE_MAX_BUDGET = TIER_BUDGET_PROVENANCE.USER_PROFILE_RESERVED.maxTokens;
export const USER_PROFILE_BUDGET_RATIO = TIER_BUDGET_PROVENANCE.USER_PROFILE_RESERVED.ratio;

/**
 * Resolves effective token budget for a retrieval tier with optional custom override.
 */
export function resolveTierBudget(tier: RetrievalTier | number = 2, customBudget?: number): number {
  const normTier: RetrievalTier = tier === 0 ? 0 : tier === 1 ? 1 : 2;
  const def = TIER_BUDGET_PROVENANCE[`TIER_${normTier}`];
  if (customBudget !== undefined && customBudget > 0) {
    return Math.min(customBudget, def.maxTokens);
  }
  return def.defaultTokens;
}

/**
 * Retrieves the full provenance record for a retrieval tier.
 */
export function getTierBudgetProvenance(tier: RetrievalTier | number): TierBudgetDefinition {
  const normTier: RetrievalTier = tier === 0 ? 0 : tier === 1 ? 1 : 2;
  return TIER_BUDGET_PROVENANCE[`TIER_${normTier}`];
}
