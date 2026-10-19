import type { Store } from "../store.ts";
import {
  queryContext,
  formatPromptContext,
  type ContextQueryOptions,
  type FormattedContext,
  type ScoredEntry,
} from "../retrieval.ts";
import { syncConstraints } from "../governor.ts";
import { getUserProfile } from "../user.ts";
import { formatCoreBlock } from "../core.ts";

import {
  type RetrievalTier,
  resolveTierBudget,
  TIER_0_DEFAULT_BUDGET,
  TIER_1_DEFAULT_BUDGET,
  TIER_2_DEFAULT_BUDGET,
  getTierBudgetProvenance,
} from "./tier_budgets.ts";

export type { RetrievalTier };
export { resolveTierBudget, getTierBudgetProvenance };

export interface TieredContextOptions extends ContextQueryOptions {
  tier?: RetrievalTier;
}

/**
 * Deterministic Tiered Retrieval Engine:
 * - Tier 0 (Manifest): Ultra-compact index of memory IDs, types, and titles (default: ~80 tokens).
 * - Tier 1 (Routing Set): Active USER.md, CURRENT.md, and routed invariant headers (default: ~400 tokens).
 * - Tier 2 (Bounded Bodies): Full memory bodies fitted greedily into token knapsack budget (default: ~4000 tokens).
 */
export function queryTieredContext(
  store: Store,
  memoryDir?: string,
  query: string = "",
  options: TieredContextOptions = {},
): FormattedContext {
  const tier = options.tier ?? 2;

  if (tier === 2) {
    return formatPromptContext(store, memoryDir, query, options);
  }

  const queryResult = queryContext(store, query, options);
  const constraints = memoryDir ? syncConstraints(memoryDir, store) : [];
  const userProfile = getUserProfile(memoryDir, { query });
  const coreBlock = formatCoreBlock(memoryDir);

  if (tier === 0) {
    const parts: string[] = [];
    parts.push("### Memory Manifest (Tier 0)");
    if (queryResult.results.length === 0) {
      parts.push("*(No matching memories)*");
    } else {
      for (const item of queryResult.results) {
        const t = item.entry.type ? `[${item.entry.type}] ` : "";
        parts.push(`- \`${item.entry.id}\` ${t}${item.entry.title}`);
      }
    }
    const markdown = parts.join("\n");
    const totalTokensUsed = Math.ceil(markdown.length / 4);
    return {
      markdown,
      entries: queryResult.results,
      totalTokensUsed,
      constraints,
      userProfile,
      fromCache: false,
      stale: queryResult.stale,
      mode: queryResult.mode,
      no_confident_match: queryResult.no_confident_match,
      confident_answers: queryResult.confident_answers,
      draft_answers: queryResult.draft_answers,
    };
  }

  // Tier 1: Routing Set
  const parts: string[] = [];
  if (userProfile) {
    parts.push("### User Profile & Preferences (USER.md)");
    parts.push(userProfile);
    parts.push("");
  }
  if (coreBlock) {
    parts.push("### Core Memory (CORE.md)");
    parts.push(coreBlock);
    parts.push("");
  }
  if (constraints.length > 0) {
    parts.push("### Active Working Constraints (CURRENT.md)");
    for (const c of constraints) {
      parts.push(`- ${c}`);
    }
    parts.push("");
  }

  parts.push("### Domain Routing Invariants (Tier 1)");
  if (queryResult.results.length === 0) {
    parts.push("*(No matching invariant routes)*");
  } else {
    for (const item of queryResult.results) {
      const t = item.entry.type ? `[${item.entry.type}] ` : "";
      const tags =
        item.entry.tags && item.entry.tags.length > 0
          ? ` (tags: ${item.entry.tags.join(", ")})`
          : "";
      parts.push(`- \`${item.entry.id}\` ${t}${item.entry.title}${tags}`);
    }
  }

  const markdown = parts.join("\n");
  const totalTokensUsed = Math.ceil(markdown.length / 4);
  return {
    markdown,
    entries: queryResult.results,
    totalTokensUsed,
    constraints,
    userProfile,
    fromCache: false,
    stale: queryResult.stale,
    mode: queryResult.mode,
    no_confident_match: queryResult.no_confident_match,
    confident_answers: queryResult.confident_answers,
    draft_answers: queryResult.draft_answers,
  };
}
