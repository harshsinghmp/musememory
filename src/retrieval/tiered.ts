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
import { formatDegradedFaultNotice } from "./faults.ts";


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

  // T-125: the tier budget is a standard with named provenance, so it has to
  // actually bound the output. It used to be declared and never applied:
  // Tier 0 was budgeted at 200 tokens and routinely emitted 327.
  const budgetTokens = resolveTierBudget(tier, options.tokenBudget);

  if (tier === 0) {
    const parts: string[] = [];
    if (queryResult.degraded && queryResult.degraded_notes && queryResult.degraded_notes.length > 0) {
      parts.push(formatDegradedFaultNotice(queryResult.degraded_notes));
    }
    parts.push("### Memory Manifest (Tier 0)");
    if (queryResult.results.length === 0) {
      parts.push("*(No matching memories)*");
    } else {
      const candidates = queryResult.results.map(
        (item) => `- \`${item.entry.id}\` ${item.entry.type ? `[${item.entry.type}] ` : ""}${item.entry.title}`,
      );
      parts.push(...fitToBudget(parts, candidates, budgetTokens));
    }
    const { markdown, totalTokensUsed } = clampMarkdown(parts, budgetTokens);
    return {
      markdown,
      entries: queryResult.results,
      totalTokensUsed,
      constraints,
      userProfile,
      fromCache: false,
      stale: queryResult.stale,
      degraded: queryResult.degraded,
      degraded_notes: queryResult.degraded_notes,
      fault_notes: queryResult.fault_notes,
      mode: queryResult.mode,
      no_confident_match: queryResult.no_confident_match,
      confident_answers: queryResult.confident_answers,
      draft_answers: queryResult.draft_answers,
    };
  }

  // Tier 1: Routing Set
  const parts: string[] = [];
  if (queryResult.degraded && queryResult.degraded_notes && queryResult.degraded_notes.length > 0) {
    parts.push(formatDegradedFaultNotice(queryResult.degraded_notes));
  }
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
    const candidates = queryResult.results.map((item) => {
      const t = item.entry.type ? `[${item.entry.type}] ` : "";
      const tags =
        item.entry.tags && item.entry.tags.length > 0
          ? ` (tags: ${item.entry.tags.join(", ")})`
          : "";
      return `- \`${item.entry.id}\` ${t}${item.entry.title}${tags}`;
    });
    parts.push(...fitToBudget(parts, candidates, budgetTokens));
  }

  const { markdown, totalTokensUsed } = clampMarkdown(parts, budgetTokens);
  return {
    markdown,
    entries: queryResult.results,
    totalTokensUsed,
    constraints,
    userProfile,
    fromCache: false,
    stale: queryResult.stale,
    degraded: queryResult.degraded,
    degraded_notes: queryResult.degraded_notes,
    fault_notes: queryResult.fault_notes,
    mode: queryResult.mode,
    no_confident_match: queryResult.no_confident_match,
    confident_answers: queryResult.confident_answers,
    draft_answers: queryResult.draft_answers,
  };
}

/** Token estimate, matching the convention used by this module. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Adds as many candidate lines as fit in the remaining budget, then reports
 * how many were left out. Dropping whole lines keeps the output well-formed
 * (no half-cut entries) and honest about the omission.
 */
function fitToBudget(base: string[], candidates: string[], budgetTokens: number): string[] {
  const used = estimateTokens(base.join("\n"));
  const out: string[] = [];
  let current = used;
  for (const line of candidates) {
    const cost = estimateTokens(line) + 1;
    if (current + cost > budgetTokens) {
      const omitted = candidates.length - out.length;
      if (omitted > 0) {
        out.push(`- _… ${omitted} more entr${omitted === 1 ? "y" : "ies"} omitted (tier budget reached)_`);
      }
      break;
    }
    out.push(line);
    current += cost;
  }
  return out;
}

/**
 * Hard cap on the rendered markdown. The candidate-fitting above handles the
 * part that grows with the store; this catches the case where the fixed
 * blocks alone already exceed the budget.
 */
function clampMarkdown(parts: string[], budgetTokens: number): { markdown: string; totalTokensUsed: number } {
  const markdown = parts.join("\n");
  const totalTokensUsed = estimateTokens(markdown);
  if (totalTokensUsed <= budgetTokens) return { markdown, totalTokensUsed };
  const maxChars = Math.max(0, budgetTokens * 4 - 40);
  const marker = "\n\n_[truncated to fit the tier token budget]_";
  const clipped = markdown.slice(0, maxChars) + marker;
  return { markdown: clipped, totalTokensUsed: estimateTokens(clipped) };
}
