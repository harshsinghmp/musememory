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

export type RetrievalTier = 0 | 1 | 2;

export interface TieredContextOptions extends ContextQueryOptions {
  tier?: RetrievalTier;
}

/**
 * Deterministic Tiered Retrieval Engine:
 * - Tier 0 (Manifest): Ultra-compact index of memory IDs, types, and titles (~50 tokens).
 * - Tier 1 (Routing Set): Active USER.md, CURRENT.md, and routed invariant headers (~300 tokens).
 * - Tier 2 (Bounded Bodies): Full memory bodies fitted greedily into token knapsack budget.
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
  };
}
