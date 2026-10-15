import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "./store.ts";
import { list } from "./store.ts";
import { getCurrent, syncConstraints, getSessionHandoff, parseCurrentFile } from "./governor.ts";
import { listWikiPages } from "./wiki/compiler.ts";
import { getUserProfile } from "./user.ts";
import { formatCoreBlock } from "./core.ts";
import type { MemoryEntry, SearchOptions } from "./types.ts";
import { STATUS_PENALTY, VERIFICATION_BONUS } from "./types.ts";
import { nowIso } from "./store.ts";

export interface ScoredEntry {
  entry: MemoryEntry;
  score: number;
}

export type DisclosureDepth = "L1" | "L2" | "L3";

export interface ContextQueryOptions extends SearchOptions {
  query?: string;
  includeExpired?: boolean;
  now?: number;
  /** Progressive disclosure tier for formatted context (default L2). */
  depth?: DisclosureDepth;
  /** R21: precomputed semantic cosine scores by entry id (ranking dim #12). */
  semanticScores?: Map<string, number>;
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

/** Stopwords filtered out during tokenization */
const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
  "any", "are", "aren't", "as", "at", "be", "because", "been", "before", "being",
  "below", "between", "both", "but", "by", "can't", "cannot", "could", "couldn't",
  "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down", "during",
  "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't",
  "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here",
  "here's", "hers", "herself", "him", "himself", "his", "how", "how's", "i",
  "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it", "it's",
  "its", "itself", "let's", "me", "more", "most", "mustn't", "my", "myself",
  "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought",
  "our", "ours", "ourselves", "out", "over", "own", "same", "shan't", "she",
  "she'd", "she'll", "she's", "should", "shouldn't", "so", "some", "such",
  "than", "that", "that's", "the", "their", "theirs", "them", "themselves",
  "then", "there", "there's", "these", "they", "they'd", "they'll", "they're",
  "they've", "this", "those", "through", "to", "too", "under", "until", "up",
  "very", "was", "wasn't", "we", "we'd", "we'll", "we're", "we've", "were",
  "weren't", "what", "what's", "when", "when's", "where", "where's", "which",
  "while", "who", "who's", "whom", "why", "why's", "with", "won't", "would",
  "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours",
  "yourself", "yourselves",
]);

/**
 * Unicode-aware lowercase word/number tokens, split on everything else.
 * `\p{L}\p{N}` keeps ASCII behavior identical while giving CJK, Cyrillic and
 * accented words whole tokens instead of fragments (T-311).
 * Shortcut: scripts without word delimiters (Han) yield one token per run, so
 * recall there relies on the entry containing the same run.
 */
export function tokenize(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Compute token overlap ratio: matched non-stopword query tokens / total non-stopword query tokens. */
export function computeApplicability(entryTokens: Set<string>, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0.5; // neutral when no query
  let matched = 0;
  for (const t of queryTokens) {
    if (entryTokens.has(t)) matched++;
  }
  return matched / queryTokens.length;
}

/** Staleness policy in days per memory type. null = never stale. */
export { stalePolicyDays } from "./retention.ts";

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
 * Due-date urgency bonus (SOW-104): overdue +0.35, due within 7 days +0.25.
 * Entries without a parseable due_at score no bonus.
 */
export function dueDateBonus(entry: MemoryEntry, now: number): number {
  if (!entry.due_at) return 0;
  const t = Date.parse(entry.due_at);
  if (Number.isNaN(t)) return 0;
  const days = (t - now) / 86_400_000;
  if (days < 0) return 0.35;
  if (days <= 7) return 0.25;
  return 0;
}

/** True when entry.expires_at is set and in the past (unparseable dates never expire). */
export function isExpired(entry: MemoryEntry, now: number): boolean {
  if (!entry.expires_at) return false;
  const t = Date.parse(entry.expires_at);
  return !Number.isNaN(t) && t <= now;
}

/**
 * AST Graph symbol overlap bonus (SOW-107): awards up to +0.2 bonus when query references
 * symbols that match the memory's indexed graph symbols.
 */
export function graphSymbolOverlapBonus(entry: MemoryEntry, queryTokens: string[]): number {
  const symbols = entry.graph?.symbol_names;
  if (!symbols || symbols.length === 0 || queryTokens.length === 0) return 0;
  const symSet = new Set(symbols.map((s) => s.toLowerCase()));
  const matches = queryTokens.filter((t) => symSet.has(t.toLowerCase())).length;
  if (matches === 0) return 0;
  return Math.min(0.2, (matches / queryTokens.length) * 0.2);
}

/** Default deterministic relevance cutoff threshold (SOW-202). Entries below this score are dropped from prompt injection. */
export const DEFAULT_MIN_RELEVANCE_SCORE = 0.45;

/**
 * Filters scored entries by minimum relevance threshold (SOW-202).
 */
export function filterByRelevanceThreshold(
  entries: ScoredEntry[],
  minScore = DEFAULT_MIN_RELEVANCE_SCORE,
): ScoredEntry[] {
  return entries.filter((e) => e.score >= minScore);
}

/** Inputs the single scorer accepts. Code-context signals are only supplied by muse_context. */
export interface ScoreContext {
  now: number;
  workspaceRoot?: string;
  /** Precomputed semantic cosine in [-1, 1] (R21 embedder), already looked up by entry id. */
  semanticScore?: number;
  activeFilePath?: string;
  targetSymbol?: string;
  ftsMatchIds?: Set<string>;
  blastRadiusFiles?: Set<string>;
}

/** Every factor the unified scorer computes. One scorer, one factor set, one ordering (T-308). */
export interface ScoreFactors {
  /** Lexical applicability: matched query tokens / query tokens. */
  baseApplicability: number;
  exactSymbolMatch: number;
  graphOverlap: number;
  pathMatch: number;
  bm25Match: number;
  blastRadius: number;
  statusPenalty: number;
  verificationBonus: number;
  salienceBonus: number;
  reinforcementBonus: number;
  dueBonus: number;
  utilityBonus: number;
  negativeWarningBonus: number;
  timelessBoost: number;
  recencyDecay: number;
  trustAdjustment: number;
  accessBoost: number;
  recentAccessBoost: number;
  zeroMatchPenalty: number;
  semanticMatch: number;
  totalScore: number;
}

/** Symbol-like identifiers an entry declares: AST symbols, single-word tags, backticked code. */
function entrySymbols(entry: MemoryEntry): Set<string> {
  const symbols = new Set<string>();
  for (const s of entry.graph?.symbol_names ?? []) symbols.add(s.toLowerCase());
  for (const tag of entry.tags ?? []) {
    if (tag.length > 3 && !tag.includes("-") && !tag.includes(" ")) symbols.add(tag.toLowerCase());
  }
  for (const m of `${entry.title} ${entry.content}`.toLowerCase().match(/`([a-z0-9_$]+)`/g) ?? []) {
    symbols.add(m.replace(/`/g, ""));
  }
  return symbols;
}

/** Files an entry touches: AST affected paths plus evidence sources. */
function entryPaths(entry: MemoryEntry): Set<string> {
  const paths = new Set<string>();
  for (const p of entry.graph?.affected_paths ?? []) paths.add(p.toLowerCase());
  for (const ev of entry.evidence ?? []) if (ev.source) paths.add(ev.source.toLowerCase());
  return paths;
}

/**
 * The single multi-factor scorer behind every retrieval path (T-308).
 * get_context scores through it via scoreEntry, muse_context through
 * calculateMultiFactorScore — same store, same factors, same order.
 *
 * score = applicability + exactSymbol + graphOverlap + pathMatch + bm25 + blastRadius
 *       + statusPenalty + verificationBonus + salience + reinforcement + dueDate
 *       + utility + negativeWarning + timeless + recencyDecay + trust + access
 *       + recentAccess + zeroMatchPenalty + 0.5 * cosine
 *
 * Bi-temporal: recency decays from valid_from (event time) when set, else updated_at.
 */
export function computeFactors(
  entry: MemoryEntry,
  queryTokens: string[],
  ctx: ScoreContext,
): ScoreFactors {
  const now = ctx.now;
  const lowerTokens = queryTokens.map((t) => t.toLowerCase());

  const baseApplicability = applicability(entry, queryTokens);
  const symbols = entrySymbols(entry);
  const pathList = [...entryPaths(entry)];

  const exactSymbolMatch =
    (ctx.targetSymbol ? symbols.has(ctx.targetSymbol.toLowerCase()) : false) ||
    lowerTokens.some((t) => symbols.has(t))
      ? 1.0
      : 0;

  let pathMatch = 0;
  if (ctx.activeFilePath) {
    const active = ctx.activeFilePath.toLowerCase();
    if (pathList.some((p) => active.includes(p) || p.includes(active))) pathMatch = 0.4;
  }
  if (pathMatch === 0) {
    for (const token of lowerTokens) {
      if (token.includes("/") || /\.(ts|js|py)$/.test(token)) {
        if (pathList.some((p) => p.includes(token))) {
          pathMatch = 0.4;
          break;
        }
      }
    }
  }

  const graphOverlap = graphSymbolOverlapBonus(entry, queryTokens);
  const bm25Match = ctx.ftsMatchIds?.has(entry.id) ? 0.3 : 0;
  const blastRadius =
    ctx.blastRadiusFiles && ctx.blastRadiusFiles.size > 0 && pathList.some((p) => ctx.blastRadiusFiles!.has(p))
      ? 0.25
      : 0;

  const statusPenalty = STATUS_PENALTY[entry.status] ?? 0;
  const verificationBonus = VERIFICATION_BONUS[entry.verification?.level ?? "unverified"] ?? 0;
  const salienceBonus = entry.salience !== undefined ? Math.max(0, Math.min(1, entry.salience)) * 0.1 : 0;
  const reinforcement = entry.reinforcement ?? 0;
  const reinforcementBonus = Math.sign(reinforcement) * 0.05 * Math.min(Math.abs(reinforcement), 5);
  const dueBonus = dueDateBonus(entry, now);

  let utilityBonus = 0;
  if (entry.utility && entry.utility.application_count >= 1) {
    const successRate = entry.utility.reuse_success_rate ?? 1.0;
    if (successRate >= 0.75) utilityBonus = 0.25;
    else if (successRate < 0.4) utilityBonus = -0.25;
  }

  const isNegative = entry.type === "negative" || entry.tags?.includes("anti-pattern") || entry.negative;
  const negativeWarningBonus =
    isNegative && (baseApplicability > 0 || exactSymbolMatch > 0 || pathMatch > 0) ? 0.3 : 0;
  const timelessBoost = entry.temporal_mode === "timeless" || entry.type === "constraint" ? 0.2 : 0;

  const recencyDecay =
    entry.temporal_mode !== "timeless" && entry.type !== "constraint"
      ? -0.05 * Math.min(Math.floor(daysSince(entry.valid_from ?? entry.updated_at, now) / 30), 6)
      : 0;

  // Runtime trust verdict bonus/penalty (SOW-201)
  let trustAdjustment = 0;
  if (entry.graph?.affected_paths && entry.graph.affected_paths.length > 0) {
    const { verifyRuntimeFiles } = require("./graph.ts");
    const verdict = verifyRuntimeFiles(entry, ctx.workspaceRoot);
    if (verdict.verdict === "STRONG") trustAdjustment = 0.15;
    else if (verdict.verdict === "STALE") trustAdjustment = -0.4;
  }

  const accessBoost = Math.min(0.2, (entry.access_count ?? 0) * 0.02);
  const recentAccessBoost = entry.last_accessed_at && daysSince(entry.last_accessed_at, now) <= 7 ? 0.1 : 0;

  // A query whose tokens match nothing — including a degenerate query that tokenizes
  // to nothing at all — is not evidence of relevance (SOW-202, T-311).
  const zeroMatchPenalty = baseApplicability === 0 && graphOverlap === 0 ? -0.35 : 0;

  const semanticMatch = ctx.semanticScore ?? 0;

  const totalScore =
    baseApplicability +
    exactSymbolMatch +
    graphOverlap +
    pathMatch +
    bm25Match +
    blastRadius +
    statusPenalty +
    verificationBonus +
    salienceBonus +
    reinforcementBonus +
    dueBonus +
    utilityBonus +
    negativeWarningBonus +
    timelessBoost +
    recencyDecay +
    trustAdjustment +
    accessBoost +
    recentAccessBoost +
    zeroMatchPenalty +
    0.5 * semanticMatch;

  return {
    baseApplicability,
    exactSymbolMatch,
    graphOverlap,
    pathMatch,
    bm25Match,
    blastRadius,
    statusPenalty,
    verificationBonus,
    salienceBonus,
    reinforcementBonus,
    dueBonus,
    utilityBonus,
    negativeWarningBonus,
    timelessBoost,
    recencyDecay,
    trustAdjustment,
    accessBoost,
    recentAccessBoost,
    zeroMatchPenalty,
    semanticMatch,
    totalScore,
  };
}

/**
 * Total score for a single entry — the get_context entry point into computeFactors.
 * Signature is unchanged; only the shared factor set behind it is (T-308).
 */
export function scoreEntry(
  entry: MemoryEntry,
  queryTokens: string[],
  now: number = Date.now(),
  workspaceRoot?: string,
  semanticScore: number = 0,
): number {
  return computeFactors(entry, queryTokens, { now, workspaceRoot, semanticScore }).totalScore;
}

/** Sort by score desc, tiebreak updated_at desc then created_at desc. */
export function sortCandidates(
  candidates: MemoryEntry[],
  queryTokens: string[],
  now: number,
  semanticScores?: Map<string, number>,
): ScoredEntry[] {
  return candidates
    .map((entry) => ({ entry, score: scoreEntry(entry, queryTokens, now, undefined, semanticScores?.get(entry.id) ?? 0) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const bU = Date.parse(b.entry.updated_at);
      const aU = Date.parse(a.entry.updated_at);
      const u = (Number.isNaN(bU) ? 0 : bU) - (Number.isNaN(aU) ? 0 : aU);
      if (u !== 0) return u;
      const bC = Date.parse(b.entry.created_at);
      const aC = Date.parse(a.entry.created_at);
      return (Number.isNaN(bC) ? 0 : bC) - (Number.isNaN(aC) ? 0 : aC);
    });
}

/**
 * Deep Context Query Engine:
 * Filters, ranks, and knapsack-packs relevant memories within token budgets.
 */
export const searchMemories = queryContext;

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
  if (!options.includeArchived && options.status !== "archived") {
    entries = entries.filter((e) => e.status !== "archived");
  }
  if (options.type) {
    entries = entries.filter((e) => e.type === options.type);
  }
  if (options.types?.length) {
    entries = entries.filter((e) => e.type !== undefined && options.types!.includes(e.type));
  }
  if (options.tags?.length) {
    entries = entries.filter((e) => (e.tags ?? []).some((t) => options.tags!.includes(t)));
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
  if (!options.includeExpired) {
    entries = entries.filter((e) => !isExpired(e, now));
  }

  const scored = sortCandidates(entries, queryTokens, now, options.semanticScores);

  // R23: Record access for top results (updates last_accessed_at and access_count)
  const limit = options.limit ?? 10;
  const results: ScoredEntry[] = [];
  let totalTokensUsed = 0;

  const recordAccessFor = (store: Store | undefined, entry: MemoryEntry) => {
    if (!store) return;
    const now = nowIso();
    const currentCount = entry.access_count ?? 0;
    entry.last_accessed_at = now;
    entry.access_count = currentCount + 1;
    if (store.db) {
      try {
        store.db.run(
          `UPDATE memories SET last_accessed_at = ?, access_count = ? WHERE id = ?`,
          [now, entry.access_count, entry.id],
        );
      } catch {}
    }
  };

  if (options.tokenBudget !== undefined) {
    if (options.tokenBudget > 0) {
      for (const item of scored) {
        if (results.length >= limit) break;
        const tokens = estimateEntryTokens(item.entry);
        if (totalTokensUsed + tokens <= options.tokenBudget) {
          results.push(item);
          totalTokensUsed += tokens;
          recordAccessFor(store, item.entry);
        }
      }
    }
  } else {
    for (const item of scored.slice(0, limit)) {
      results.push(item);
      totalTokensUsed += estimateEntryTokens(item.entry);
      recordAccessFor(store, item.entry);
    }
  }

  if (options.autoRehydrate) {
    const { rehydrateMemory } = require("./promotion/archival.ts");
    for (const item of results) {
      if ((item.entry.status === "archived" || item.entry.status === "dormant" || item.entry.status === "cold") && item.score >= 0.65) {
        try {
          rehydrateMemory(store, item.entry.id, item.score, `Auto-rehydrated during search query '${query}'`);
          item.entry.status = item.entry.verification?.level && item.entry.verification.level !== "unverified" ? "confirmed" : "active";
        } catch {}
      }
    }
  }

  return {
    results,
    source: "live",
    stale: false,
    totalTokensUsed,
  };
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
  const cacheKey = store.cache
    ? `ctx:${query}:${options.project || ""}:${options.depth || "L2"}:${options.limit ?? 5}:${options.tokenBudget ?? ""}:${options.type || ""}:${options.status || ""}:${options.verified ? "1" : "0"}`
    : undefined;

  if (cacheKey && store.cache) {
    const cached = store.cache.getContext(cacheKey);
    if (cached) return cached;
  }

  const result = queryContext(store, query, options);
  const constraints = memoryDir ? syncConstraints(memoryDir, store) : [];
  const userProfile = getUserProfile(memoryDir, { query });
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

  const currentData = memoryDir ? parseCurrentFile(memoryDir) : null;
  if (currentData?.workstreams && currentData.workstreams.length > 0) {
    const activeWs = currentData.workstreams.filter((w) => w.status === "IN-PROGRESS" || w.status === "BLOCKED");
    if (activeWs.length > 0) {
      parts.push("### Active Concurrent Agent Workstreams (CURRENT.md)");
      for (const w of activeWs) {
        const scope = w.targetScope ? ` | Target: \`${w.targetScope}\`` : "";
        parts.push(`- Agent \`${w.agent}\` [${w.status}]: ${w.task}${scope} (Active: ${w.lastActive})`);
      }
      parts.push("");
    }
  }

  const handoff = memoryDir ? getSessionHandoff(memoryDir) : null;
  if (handoff && (handoff.status === "IN-PROGRESS" || handoff.task || handoff.lastQuery)) {
    parts.push("### Active In-Flight Context & Session Handoff (CURRENT.md)");
    parts.push(`- **Status**: [${handoff.status}]`);
    if (handoff.agent) parts.push(`- **Previous / Active Agent**: ${handoff.agent}`);
    if (handoff.task) parts.push(`- **Last Active Task**: ${handoff.task}`);
    if (handoff.lastQuery) parts.push(`- **Last Query / Instruction**: "${handoff.lastQuery}"`);
    if (handoff.updatedAt) parts.push(`- **Last Checkpoint**: ${handoff.updatedAt}`);
    if (handoff.progress && handoff.progress.length > 0) {
      parts.push("- **Recent Progress**:");
      for (const pr of handoff.progress) parts.push(`  - ${pr}`);
    }
    if (handoff.discoveries && handoff.discoveries.length > 0) {
      parts.push("- **Learned Discoveries in Previous Session**:");
      for (const disc of handoff.discoveries) parts.push(`  - ${disc}`);
    }
    parts.push("");
  }

  if (memoryDir && existsSync(join(memoryDir, "wiki"))) {
    try {
      const wikiPages = listWikiPages(memoryDir, { detailLevel: "l1", project: options.project });
      if (wikiPages.length > 0) {
        const queryTokens = tokenize(query);
        const relevantWiki = wikiPages
          .filter((p: any) => p.type === "concept" && (!query || tokenize(p.title + " " + (p.summary || "")).some((t: string) => queryTokens.includes(t))))
          .slice(0, 3);
        if (relevantWiki.length > 0) {
          parts.push("### Compiled Knowledge & Concepts (Wiki L1)");
          for (const wp of relevantWiki) {
            const sum = (wp as any).summary;
            parts.push(`- [[${wp.slug}]]: ${wp.title}${sum ? ` — ${sum}` : ""}`);
          }
          parts.push("");
        }
      }
    } catch {}
  }

  if (result.results.length > 0) {
    const depth = options.depth ?? "L2";
    parts.push("### Relevant Memories & Learned Patterns");
    if (depth === "L1") {
      // One line per memory: id + title only
      for (const r of result.results) {
        parts.push(`- ${r.entry.id} ${r.entry.title}`);
      }
      parts.push("");
    } else {
      for (const r of result.results) {
        const e = r.entry;
        const typeBadge = e.type ? ` [${e.type.toUpperCase()}]` : "";
        const statusBadge = e.status === "confirmed" ? " (Confirmed)" : "";
        parts.push(`#### ${e.title}${typeBadge}${statusBadge}`);
        parts.push(e.content);
        if (depth === "L3") {
          // Full raw entry metadata
          const meta: string[] = [`id: ${e.id}`, `status: ${e.status}`, `project: ${e.project}`];
          if (e.type) meta.push(`type: ${e.type}`);
          if (e.created_at) meta.push(`created_at: ${e.created_at}`);
          if (e.updated_at) meta.push(`updated_at: ${e.updated_at}`);
          if (e.tags?.length) meta.push(`tags: ${e.tags.join(", ")}`);
          if (e.verification?.level) meta.push(`verification: ${e.verification.level}`);
          if (e.related_memory_ids?.length) meta.push(`related: ${e.related_memory_ids.join(", ")}`);
          if (e.session_id) meta.push(`session: ${e.session_id}`);
          if (e.salience !== undefined) meta.push(`salience: ${e.salience}`);
          parts.push("<raw>");
          for (const m of meta) parts.push(m);
          parts.push("</raw>");
        }
        if (e.tags && e.tags.length > 0) {
          parts.push(`*Tags: ${e.tags.join(", ")}*`);
        }
        parts.push("");
      }
    }
  }

  parts.push("---");
  parts.push("*Memory Directive: When learning durable facts, bug resolutions, or user preferences, call `memory_capture` immediately.*");

  const formatted: FormattedContext = {
    markdown: parts.join("\n").trim(),
    entries: result.results,
    totalTokensUsed: result.totalTokensUsed ?? 0,
    constraints,
    userProfile,
  };

  if (cacheKey && store.cache) {
    store.cache.setContext(cacheKey, formatted);
  }

  return formatted;
}
