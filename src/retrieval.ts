import type { Store } from "./store.ts";
import { list } from "./store.ts";
import { getCurrent } from "./current.ts";
import { getUserProfile } from "./user.ts";
import { formatCoreBlock } from "./core.ts";
import { graphSymbolOverlapBonus } from "./graph.ts";
import type { MemoryEntry, MemoryType, MemoryStatus, SearchOptions } from "./types.ts";
import { STATUS_PENALTY, VERIFICATION_BONUS, DEFAULT_STALE_DAYS } from "./types.ts";

export interface ScoredEntry {
  entry: MemoryEntry;
  score: number;
}

export interface ContextQueryOptions extends SearchOptions {
  query?: string;
  project?: string;
  limit?: number;
  tokenBudget?: number;
  includeSuperseded?: boolean;
  type?: MemoryType | string;
  status?: MemoryStatus | string;
  verified?: boolean;
  now?: number;
}

export interface SearchResult {
  results: ScoredEntry[];
  source: "live";
  stale: boolean;
  totalTokensUsed?: number;
}

export interface FormattedContext {
  markdown: string;
  entries: ScoredEntry[];
  totalTokensUsed: number;
  constraints: string[];
  userProfile?: string | null;
}

/** Per-type staleness policy in days; null = never stale. */
export function stalePolicyDays(type?: string): number | null {
  switch (type) {
    case "fix":
      return 90;
    case "operation":
      return 180;
    case "architecture":
      return 365;
    case "discovery":
      return 30;
    case "preference":
      return null;
    default:
      return DEFAULT_STALE_DAYS;
  }
}

/** Lowercase alphanumeric-only tokens, split on non-alphanumeric. */
export function tokenize(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Estimates prompt token count for a memory entry (~4 characters per token heuristic). */
export function estimateEntryTokens(entry: MemoryEntry): number {
  const text = `${entry.id} ${entry.status} ${entry.project} ${entry.title}\n${entry.content}\n${(entry.tags ?? []).join(" ")} ${entry.type ?? ""} ${entry.verification?.level ?? ""}`;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function daysSince(iso: string, now: number): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (now - t) / 86_400_000);
}

export function applicability(entry: MemoryEntry, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const graphSymbols = (entry.graph?.symbol_names ?? []).join(" ");
  const haystack = tokenize(
    `${entry.content} ${entry.title} ${entry.project} ${(entry.tags ?? []).join(" ")} ${graphSymbols}`,
  );
  const hay = new Set(haystack);
  const overlap = queryTokens.filter((t) => hay.has(t)).length;
  return overlap / Math.max(1, queryTokens.length);
}

/**
 * Multi-factor score formula:
 * score = 1.0 * applicability + statusPenalty + verificationBonus + graphBonus + salienceBonus
 *       + reinforcementBonus + 0.3 * exp(-daysSince(decayBase)/90)
 *
 * Bi-temporal: decay uses valid_from (event time) when set, else updated_at (system time).
 * Reinforcement: +0.05 per confirm up to 5; negative reinforcement applies a matching penalty.
 */
export function scoreEntry(entry: MemoryEntry, queryTokens: string[], now: number): number {
  const app = applicability(entry, queryTokens);
  const statusPenalty = STATUS_PENALTY[entry.status] ?? 0;
  const vLevel = entry.verification?.level ?? "unverified";
  const verificationBonus = VERIFICATION_BONUS[vLevel] ?? 0;
  const graphBonus = graphSymbolOverlapBonus(entry, queryTokens);
  const salienceBonus = entry.salience !== undefined ? Math.max(0, Math.min(1, entry.salience)) * 0.1 : 0;
  const r = entry.reinforcement ?? 0;
  const reinforcementBonus = Math.sign(r) * 0.05 * Math.min(Math.abs(r), 5);
  const decayBase = entry.valid_from ?? entry.updated_at;
  const decay = 0.3 * Math.exp(-daysSince(decayBase, now) / 90);
  return app + statusPenalty + verificationBonus + graphBonus + salienceBonus + reinforcementBonus + decay;
}

/** Sort by score desc, tiebreak updated_at desc then created_at desc. */
export function sortCandidates(candidates: MemoryEntry[], queryTokens: string[], now: number): ScoredEntry[] {
  return candidates
    .map((entry) => ({ entry, score: scoreEntry(entry, queryTokens, now) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const u = Date.parse(b.entry.updated_at) - Date.parse(a.entry.updated_at);
      if (u !== 0) return u;
      return Date.parse(b.entry.created_at) - Date.parse(a.entry.created_at);
    });
}

/**
 * Deep Context Query Engine:
 * Filters, ranks, and knapsack-packs relevant memories within token budgets.
 */
export function queryContext(
  store: Store,
  query: string = "",
  options: ContextQueryOptions = {},
): SearchResult {
  const queryTokens = tokenize(query);
  const now = options.now ?? Date.now();
  let entries = list(store);

  if (options.project) {
    entries = entries.filter((e) => e.project === options.project);
  }
  if (!options.includeSuperseded) {
    entries = entries.filter((e) => e.status !== "superseded" && e.status !== "rejected");
  }
  if (options.type) {
    entries = entries.filter((e) => e.type === options.type);
  }
  if (options.status) {
    entries = entries.filter((e) => e.status === options.status);
  }
  if (options.verified) {
    entries = entries.filter(
      (e) =>
        e.verification?.level &&
        e.verification.level !== "unverified" &&
        e.status !== "candidate",
    );
  }

  const scored = sortCandidates(entries, queryTokens, now);
  const limit = options.limit ?? 10;
  const results: ScoredEntry[] = [];
  let totalTokensUsed = 0;

  if (options.tokenBudget && options.tokenBudget > 0) {
    for (const item of scored) {
      if (results.length >= limit) break;
      const tokens = estimateEntryTokens(item.entry);
      if (totalTokensUsed + tokens <= options.tokenBudget) {
        results.push(item);
        totalTokensUsed += tokens;
      }
    }
  } else {
    for (const item of scored.slice(0, limit)) {
      results.push(item);
      totalTokensUsed += estimateEntryTokens(item.entry);
    }
  }

  return {
    results,
    source: "live",
    stale: false,
    totalTokensUsed,
  };
}

/** Backwards-compatible search wrapper */
export function search(
  store: Store,
  _memoryDir: string,
  query: string,
  opts: SearchOptions = {},
): SearchResult {
  return queryContext(store, query, opts);
}

/**
 * Formats top-ranked context into a clean Markdown block ready for LLM prompt injection.
 * Integrates active constraints from CURRENT.md if memoryDir is available.
 */
export function formatPromptContext(
  store: Store,
  memoryDir?: string,
  query: string = "",
  options: ContextQueryOptions = {},
): FormattedContext {
  const result = queryContext(store, query, options);
  const constraints = memoryDir ? getCurrent(memoryDir) : [];
  const userProfile = getUserProfile(memoryDir);
  const coreBlock = formatCoreBlock(memoryDir);

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

  if (result.results.length > 0) {
    parts.push("### Relevant Memories & Learned Patterns");
    for (const r of result.results) {
      const typeBadge = r.entry.type ? ` [${r.entry.type.toUpperCase()}]` : "";
      const statusBadge = r.entry.status === "confirmed" ? " (Confirmed)" : "";
      parts.push(`#### ${r.entry.title}${typeBadge}${statusBadge}`);
      parts.push(r.entry.content);
      if (r.entry.tags && r.entry.tags.length > 0) {
        parts.push(`*Tags: ${r.entry.tags.join(", ")}*`);
      }
      parts.push("");
    }
  }

  parts.push("---");
  parts.push("*Memory Directive: When learning durable facts, bug resolutions, or user preferences, call `memory_capture` immediately.*");

  return {
    markdown: parts.join("\n").trim(),
    entries: result.results,
    totalTokensUsed: result.totalTokensUsed ?? 0,
    constraints,
    userProfile,
  };
}
