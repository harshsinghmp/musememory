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
import { hasSecret } from "./secrets.ts";
import { verifyRuntimeFiles, type RuntimeVerificationVerdict } from "./graph.ts";

export interface ScoredEntry {
  entry: MemoryEntry;
  score: number;
  /** T-126: Deterministic reason tokens explaining why this memory was retrieved. */
  why_retrieved?: string[];
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
  source: "live" | "cache" | "degraded";
  stale: boolean;
  fromCache?: boolean;
  totalTokensUsed?: number;
  /** T-075 & T-058: Memories filtered out by trust tiers or read-path re-validation. */
  withheld?: Array<{ id: string; reason: string }>;
  /** T-117: High-water mark timestamp of the most recent memory in the store. */
  watermark?: string;
}

export interface FormattedContext {
  markdown: string;
  entries: ScoredEntry[];
  totalTokensUsed: number;
  constraints: string[];
  userProfile?: string | null;
  fromCache?: boolean;
  stale?: boolean;
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
 * T-061: Compound-token expansion.
 * Splits camelCase (getUserProfile -> get, user, profile, getuserprofile),
 * snake_case (auth_token -> auth, token, auth_token), and kebab-case.
 * Returns unique array containing both the decomposed sub-tokens and the normalized full token.
 */
export function splitCompoundToken(token: string): string[] {
  if (!token || typeof token !== "string") return [];
  const results = new Set<string>();

  const lowerFull = token.toLowerCase();
  results.add(lowerFull);

  const stripped = lowerFull.replace(/[_\-.]+/g, "");
  if (stripped.length > 0) {
    results.add(stripped);
  }

  // Split on camelCase/PascalCase boundaries and delimiter boundaries
  const parts = token
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-.]+/);

  for (const p of parts) {
    const clean = p.toLowerCase().trim();
    if (clean.length > 0) {
      results.add(clean);
    }
  }

  return [...results];
}

/**
 * Unicode-aware lowercase word/number tokens with compound token expansion (T-061, T-311).
 * `\p{L}\p{N}` keeps ASCII behavior identical while giving CJK, Cyrillic and
 * accented words whole tokens. Compound tokens (camelCase, PascalCase) are expanded into sub-tokens.
 */
export function tokenize(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const rawMatches = text.match(/[\p{L}\p{N}]+/gu);
  if (!rawMatches) return [];

  const tokens: string[] = [];
  const seen = new Set<string>();

  for (const raw of rawMatches) {
    // Expand camelCase / PascalCase compound words (e.g., getUserProfile -> getuserprofile, get, user, profile)
    if (/[a-z\p{Ll}][A-Z\p{Lu}]|[A-Z\p{Lu}]{2,}[a-z\p{Ll}]/u.test(raw)) {
      const expanded = splitCompoundToken(raw);
      for (const t of expanded) {
        if (!seen.has(t)) {
          seen.add(t);
          tokens.push(t);
        }
      }
    } else {
      const lower = raw.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        tokens.push(lower);
      }
    }
  }

  return tokens;
}

/**
 * T-310: Matches a query token against text using Unicode-aware word boundaries.
 * Prevents substring false positives such as "race" matching "trace" or "port" matching "report".
 */
export function matchesWordBoundary(text: string, term: string): boolean {
  if (!text || !term) return false;
  const trimmedTerm = term.trim();
  if (!trimmedTerm) return false;
  const escaped = trimmedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}([^\\p{L}\\p{N}_]|$)`, "iu");
  return regex.test(text);
}

const TRIVIAL_GREETINGS = new Set([
  "hi", "hello", "hey", "hey there", "good morning", "good evening", "good afternoon",
  "thank you", "thanks", "ok", "okay", "bye", "goodbye", "yo", "sup",
]);

/**
 * T-070: IDF-weighted relevance gate before FTS5 search (0.3 threshold, identifier-decisive, greeting short-circuit).
 * Returns whether query possesses sufficient informational signal to justify recall passes.
 */
export function evaluateQueryRelevance(query: string): {
  relevant: boolean;
  score: number;
  reason?: string;
} {
  if (!query || typeof query !== "string") {
    return { relevant: false, score: 0, reason: "empty_query" };
  }

  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return { relevant: false, score: 0, reason: "empty_query" };
  }

  // 1. Greeting short-circuit
  const normalized = trimmed.toLowerCase().replace(/[!?.,;:]+$/g, "").trim();
  if (TRIVIAL_GREETINGS.has(normalized)) {
    return { relevant: false, score: 0.05, reason: "trivial_greeting" };
  }

  // 2. Identifier-decisive check: code syntax, paths, camelCase, backticks
  const hasBackticks = /`[^`]+`/.test(trimmed);
  const hasPath = /[\/\\]|\.[a-z0-9]{1,5}\b/i.test(trimmed);
  const hasCamelOrSnake = /[a-z][A-Z]|[A-Z]{2,}[a-z]|_/.test(trimmed);

  if (hasBackticks || hasPath || hasCamelOrSnake) {
    return { relevant: true, score: 0.85 };
  }

  // 3. Informational density scoring over non-stopword tokens
  const tokens = tokenize(trimmed);
  const informativeTokens = tokens.filter((t) => !STOPWORDS.has(t));

  if (informativeTokens.length === 0) {
    return { relevant: false, score: 0.1, reason: "stopwords_only" };
  }

  const informativeRatio = informativeTokens.length / Math.max(1, tokens.length);
  const avgLen = informativeTokens.reduce((sum, t) => sum + t.length, 0) / informativeTokens.length;

  let score = 0.25 * informativeRatio + Math.min(0.5, (avgLen / 10) * 0.5);
  if (informativeTokens.length >= 2) score += 0.15;
  if (informativeTokens.length >= 4) score += 0.15;

  const threshold = 0.30;
  const relevant = score >= threshold;

  return {
    relevant,
    score: Math.min(1.0, score),
    reason: relevant ? undefined : "low_relevance_score",
  };
}

/**
 * T-035: Iterative safe maximum calculation that prevents RangeError call stack overflow on large arrays.
 */
export function safeMax(arr: number[], defaultValue: number = 0): number {
  if (!arr || arr.length === 0) return defaultValue;
  let max = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    const val = arr[i];
    if (val !== undefined && !Number.isNaN(val) && val > max) {
      max = val;
    }
  }
  return max === -Infinity ? defaultValue : max;
}

/**
 * T-035: Iterative safe minimum calculation that prevents RangeError call stack overflow on large arrays.
 */
export function safeMin(arr: number[], defaultValue: number = 0): number {
  if (!arr || arr.length === 0) return defaultValue;
  let min = Infinity;
  for (let i = 0; i < arr.length; i++) {
    const val = arr[i];
    if (val !== undefined && !Number.isNaN(val) && val < min) {
      min = val;
    }
  }
  return min === Infinity ? defaultValue : min;
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

/**
 * T-062: Safely parse and clamp model-supplied limit values within [minVal, maxVal].
 */
export function clampLimit(
  val: unknown,
  defaultVal: number = 10,
  maxVal: number = 100,
  minVal: number = 1,
): number {
  if (typeof val === "number" && Number.isFinite(val)) {
    return Math.max(minVal, Math.min(Math.floor(val), maxVal));
  }
  if (typeof val === "string" && val.trim()) {
    const parsed = parseInt(val.trim(), 10);
    if (Number.isFinite(parsed)) {
      return Math.max(minVal, Math.min(parsed, maxVal));
    }
  }
  return defaultVal;
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

/** T-022: Memoized token, symbol, and path sets per memory entry to avoid redundant re-tokenization. */
const entryTokenSetCache = new WeakMap<MemoryEntry, Set<string>>();
const entrySymbolsCache = new WeakMap<MemoryEntry, Set<string>>();
const entryPathsCache = new WeakMap<MemoryEntry, Set<string>>();

/**
 * Returns or precomputes the set of lowercase lexical tokens for a memory entry.
 */
export function getEntryTokenSet(entry: MemoryEntry): Set<string> {
  let set = entryTokenSetCache.get(entry);
  if (!set) {
    const graphSymbols = (entry.graph?.symbol_names ?? []).join(" ");
    const haystack = tokenize(
      `${entry.content} ${entry.title} ${entry.project} ${(entry.tags ?? []).join(" ")} ${graphSymbols}`,
    );
    set = new Set(haystack);
    entryTokenSetCache.set(entry, set);
  }
  return set;
}

/** Invalidates cached precomputed token and structural sets for an entry. */
export function invalidateEntryTokenSet(entry: MemoryEntry): void {
  entryTokenSetCache.delete(entry);
  entrySymbolsCache.delete(entry);
  entryPathsCache.delete(entry);
}

export function applicability(
  entry: MemoryEntry,
  queryTokens: string[],
  cachedSet?: Set<string>,
): number {
  if (queryTokens.length === 0) return 0;
  const hay = cachedSet || getEntryTokenSet(entry);
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
  /** T-021: Memoized cache of verified entry verdicts across candidate ranking. */
  fileVerificationCache?: Map<string, RuntimeVerificationVerdict>;
  /** T-021: Memoized cache of individual file existence checks. */
  filePathCache?: Map<string, boolean>;
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
  let symbols = entrySymbolsCache.get(entry);
  if (symbols) return symbols;
  symbols = new Set<string>();
  for (const s of entry.graph?.symbol_names ?? []) symbols.add(s.toLowerCase());
  for (const tag of entry.tags ?? []) {
    if (tag.length > 3 && !tag.includes("-") && !tag.includes(" ")) symbols.add(tag.toLowerCase());
  }
  for (const m of `${entry.title} ${entry.content}`.toLowerCase().match(/`([a-z0-9_$]+)`/g) ?? []) {
    symbols.add(m.replace(/`/g, ""));
  }
  entrySymbolsCache.set(entry, symbols);
  return symbols;
}

/** Files an entry touches: AST affected paths plus evidence sources. */
function entryPaths(entry: MemoryEntry): Set<string> {
  let paths = entryPathsCache.get(entry);
  if (paths) return paths;
  paths = new Set<string>();
  for (const p of entry.graph?.affected_paths ?? []) paths.add(p.toLowerCase());
  for (const ev of entry.evidence ?? []) if (ev.source) paths.add(ev.source.toLowerCase());
  entryPathsCache.set(entry, paths);
  return paths;
}

/**
 * Common generic programming verbs and high-frequency terms with near-zero identifier specificity.
 * When matching query tokens against entry symbols, these must not award full symbol match points.
 */
export const GENERIC_COMMON_SYMBOLS = new Set([
  "get", "set", "run", "do", "use", "make", "add", "call", "new", "all",
  "init", "data", "test", "item", "val", "key", "list", "check", "put", "let",
  "has", "is", "log", "req", "res", "out", "err", "msg", "type", "name",
]);

/**
 * T-309: Calculate IDF-weighted specificity score for a symbol match.
 * Prevents generic verbs (`get`, `set`) in tags/backticks from hijacking ranking over lexically-relevant memories.
 */
export function calculateSymbolSpecificity(symbol: string): number {
  if (!symbol || typeof symbol !== "string") return 0;
  const s = symbol.toLowerCase().trim();
  if (STOPWORDS.has(s)) return 0;
  if (GENERIC_COMMON_SYMBOLS.has(s) || s.length <= 2) return 0.05;
  if (s.length <= 3) return 0.15;
  // Compound identifiers (e.g. SessionManager, getUserProfile, auth_token, jwt.verify) have highest specificity
  if (/[_.]|[a-z][A-Z]/.test(symbol)) return 1.0;
  if (s.length >= 8) return 0.85;
  if (s.length >= 5) return 0.60;
  return 0.35;
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

  // T-309: IDF-weighted symbol matching instead of flat binary 1.0
  let exactSymbolMatch = 0;
  if (ctx.targetSymbol && symbols.has(ctx.targetSymbol.toLowerCase())) {
    exactSymbolMatch = 1.0;
  } else {
    for (let i = 0; i < lowerTokens.length; i++) {
      const lt = lowerTokens[i];
      if (symbols.has(lt)) {
        const rawToken = queryTokens[i] || lt;
        const spec = Math.max(
          calculateSymbolSpecificity(rawToken),
          calculateSymbolSpecificity(lt)
        );
        if (spec > exactSymbolMatch) exactSymbolMatch = spec;
      }
    }
  }

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

  // Runtime trust verdict bonus/penalty (SOW-201, T-021 memoized)
  let trustAdjustment = 0;
  if (entry.graph?.affected_paths && entry.graph.affected_paths.length > 0) {
    let verdict: RuntimeVerificationVerdict;
    const cacheKey = ctx.fileVerificationCache ? `${ctx.workspaceRoot || ""}:${entry.id}` : undefined;
    if (cacheKey && ctx.fileVerificationCache?.has(cacheKey)) {
      verdict = ctx.fileVerificationCache.get(cacheKey)!;
    } else {
      verdict = verifyRuntimeFiles(entry, ctx.workspaceRoot, ctx.filePathCache);
      if (cacheKey && ctx.fileVerificationCache) {
        ctx.fileVerificationCache.set(cacheKey, verdict);
      }
    }
    if (verdict.verdict === "STRONG") trustAdjustment = 0.15;
    else if (verdict.verdict === "STALE") trustAdjustment = -0.4;
  }

  const accessBoost = Math.min(0.2, (entry.access_count ?? 0) * 0.02);
  const recentAccessBoost = entry.last_accessed_at && daysSince(entry.last_accessed_at, now) <= 7 ? 0.1 : 0;

  // A query whose tokens match nothing — including a degenerate query that tokenizes
  // to nothing at all — is not evidence of relevance (SOW-202, T-311).
  const zeroMatchPenalty = baseApplicability === 0 && graphOverlap === 0 ? -0.35 : 0;

  // T-071 & T-116: semantic threshold gate before fusion — zero out sub-threshold noise
  const rawSemantic = ctx.semanticScore ?? 0;
  const semanticMatch = rawSemantic >= 0.30 ? rawSemantic : 0;

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

/**
 * T-126: Derives deterministic reason tokens from contributing factors and memory attributes.
 */
export function deriveWhyRetrieved(factors: ScoreFactors, entry: MemoryEntry): string[] {
  const reasons: string[] = [];
  if (factors.exactSymbolMatch > 0) reasons.push("exact_symbol_match");
  if (factors.bm25Match > 0) reasons.push("bm25_fts_hit");
  if (factors.semanticMatch > 0) reasons.push("semantic_vector_match");
  if (factors.graphOverlap > 0) reasons.push("graph_symbol_overlap");
  if (factors.pathMatch > 0) reasons.push("path_proximity");
  if (factors.blastRadius > 0) reasons.push("blast_radius_impact");
  if (factors.verificationBonus > 0 || (entry.verification?.level && entry.verification.level !== "unverified")) {
    reasons.push("verified_memory");
  }
  if (factors.salienceBonus > 0) reasons.push("high_salience");
  if (factors.reinforcementBonus > 0) reasons.push("reinforcement_bonus");
  if (factors.dueBonus > 0) reasons.push("due_date_urgency");
  if (factors.utilityBonus > 0) reasons.push("utility_reward");
  if (
    factors.negativeWarningBonus > 0 ||
    entry.type === "negative" ||
    entry.tags?.includes("anti-pattern") ||
    entry.negative
  ) {
    reasons.push("negative_pattern_warning");
  }
  if (entry.type === "constraint") reasons.push("active_constraint");
  if (entry.temporal_mode === "timeless") reasons.push("timeless_rule");
  if (factors.recentAccessBoost > 0) reasons.push("recent_access");
  if (factors.baseApplicability > 0) reasons.push("lexical_overlap");

  return reasons.sort();
}

/**
 * T-115: Checks whether top candidate scores lack discrimination (tightly clustered spread <= threshold).
 */
export function isLowDiscrimination(scores: number[], threshold: number = 0.04): boolean {
  if (!scores || scores.length < 2) return false;
  const topScore = scores[0];
  const compareIdx = Math.min(2, scores.length - 1);
  return Math.abs(topScore - scores[compareIdx]) <= threshold;
}

/**
 * T-115: Conditional secondary reranking for candidates when primary scores are tightly clustered.
 * Uses verification level, trust tier, recency, and historical access to break ties deterministically.
 */
export function conditionalRerank<T extends { entry: MemoryEntry; score: number }>(candidates: T[]): T[] {
  if (!candidates || candidates.length < 2) return candidates;
  const scores = candidates.map((c) => c.score);
  if (!isLowDiscrimination(scores)) return candidates;

  const vBonus = (e: MemoryEntry) =>
    e.verification?.level === "authoritative" ||
    e.verification?.level === "user-confirmed" ||
    e.verification?.level === "independently-verified"
      ? 0.05
      : e.verification?.level && e.verification.level !== "unverified"
      ? 0.03
      : 0;
  const tBonus = (e: MemoryEntry) => (e.trust === "trusted" ? 0.02 : e.trust === "untrusted" ? -0.05 : 0);
  const recencyBonus = (e: MemoryEntry) => {
    const ts = Date.parse(e.updated_at || e.created_at || "");
    return Number.isNaN(ts) ? 0 : Math.min(0.01, (ts / 2e12) * 0.01);
  };
  const accessBonus = (e: MemoryEntry) => Math.min(0.005, (e.access_count ?? 0) * 0.001);

  return candidates
    .map((c) => {
      const adj = vBonus(c.entry) + tBonus(c.entry) + recencyBonus(c.entry) + accessBonus(c.entry);
      return {
        ...c,
        score: Number((c.score + adj).toFixed(5)),
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * T-117: Retrieves the data high-water mark timestamp from last_memory_seen_at / max(updated_at, created_at).
 * Enables data-driven staleness tracking rather than relying on wall-clock drift.
 */
export function getStoreWatermark(store: Store): string {
  if (store.db) {
    try {
      const row = store.db
        .query<{ watermark: string }>(
          `SELECT MAX(COALESCE(updated_at, created_at)) as watermark FROM memories WHERE (deleted_at IS NULL OR deleted_at = '')`,
        )
        .get();
      if (row?.watermark) return row.watermark;
    } catch {}
  }
  const entries = list(store);
  if (entries.length === 0) return new Date(0).toISOString();
  let maxTs = "";
  for (const e of entries) {
    const ts = e.updated_at || e.created_at || "";
    if (ts > maxTs) maxTs = ts;
  }
  return maxTs || new Date(0).toISOString();
}

/** Sort by score desc, tiebreak updated_at desc then created_at desc, and apply conditional rerank. */
export function sortCandidates(
  candidates: MemoryEntry[],
  queryTokens: string[],
  now: number,
  semanticScores?: Map<string, number>,
  workspaceRoot?: string,
): ScoredEntry[] {
  const fileVerificationCache = new Map<string, RuntimeVerificationVerdict>();
  const filePathCache = new Map<string, boolean>();

  const scored = candidates
    .map((entry) => {
      const factors = computeFactors(entry, queryTokens, {
        now,
        workspaceRoot,
        semanticScore: semanticScores?.get(entry.id) ?? 0,
        fileVerificationCache,
        filePathCache,
      });
      return {
        entry,
        score: factors.totalScore,
        why_retrieved: deriveWhyRetrieved(factors, entry),
      };
    })
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

  return conditionalRerank(scored);
}

/**
 * Deep Context Query Engine:
 * Filters, ranks, and knapsack-packs relevant memories within token budgets.
 */
export const searchMemories = queryContext;

const loggedRevalidationWarnings = new Set<string>();

/**
 * T-058 & T-059: Read-path re-validation defense-in-depth.
 * Excludes prompt injection markup, leaked credentials, and invisible/bidi control characters.
 * Logs a warning at most once per memory ID.
 */
export function validateRecalledEntry(entry: MemoryEntry): { valid: boolean; reason?: string } {
  const text = `${entry.title}\n${entry.content}`;

  // 1. Prompt injection / instruction override markup
  if (
    /(?:<system>|<\/system>|\[INST\]|\[\/INST\]|<memory-context>|<\/memory-context>|ignore previous instructions|disregard earlier instructions|system prompt override)/i.test(
      text,
    )
  ) {
    return { valid: false, reason: "prompt_injection_markup" };
  }

  // 2. Secret credential leak
  if (hasSecret(entry.content) || hasSecret(entry.title)) {
    return { valid: false, reason: "credential_leak" };
  }

  // 3. Invisible / bidi control characters
  if (/[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/.test(text)) {
    return { valid: false, reason: "invisible_control_characters" };
  }

  return { valid: true };
}

export function queryContext(
  store: Store,
  query: string = "",
  options: ContextQueryOptions = {},
): SearchResult {
  const queryTokens = tokenize(query);
  const now = options.now ?? Date.now();
  let entries = list(store);
  const withheld: Array<{ id: string; reason: string }> = [];

  // T-075: Untrusted provenance filter (default excluded, opt-in with includeUntrusted: true)
  if (!options.includeUntrusted) {
    entries = entries.filter((e) => {
      if (e.trust === "untrusted") {
        withheld.push({ id: e.id, reason: "untrusted_source" });
        return false;
      }
      return true;
    });
  }

  // T-058: Defense-in-depth read-path revalidation
  entries = entries.filter((e) => {
    const val = validateRecalledEntry(e);
    if (!val.valid) {
      if (!loggedRevalidationWarnings.has(e.id)) {
        loggedRevalidationWarnings.add(e.id);
        console.warn(`[ReadPathValidation] Withheld memory ${e.id}: detected ${val.reason}`);
      }
      withheld.push({ id: e.id, reason: val.reason! });
      return false;
    }
    return true;
  });

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

  const scored = sortCandidates(entries, queryTokens, now, options.semanticScores, options.workspaceRoot);

  // R23: Record access for top results (updates last_accessed_at and access_count)
  const limit = options.limit !== undefined ? clampLimit(options.limit, 10, 500, 1) : 10;
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
      const packedIds = new Set<string>();
      const isPriorityGuardrail = (e: MemoryEntry) =>
        e.type === "constraint" ||
        e.temporal_mode === "timeless" ||
        e.type === "negative" ||
        e.tags?.includes("anti-pattern") ||
        e.negative;

      // First pass: pack priority guardrails (constraints, timeless rules, negative anti-patterns)
      for (const item of scored) {
        if (results.length >= limit) break;
        if (!isPriorityGuardrail(item.entry)) continue;
        const tokens = estimateEntryTokens(item.entry);
        if (totalTokensUsed + tokens <= options.tokenBudget) {
          results.push(item);
          packedIds.add(item.entry.id);
          totalTokensUsed += tokens;
          recordAccessFor(store, item.entry);
        }
      }

      // Second pass: pack remaining highest-scoring entries
      for (const item of scored) {
        if (results.length >= limit) break;
        if (packedIds.has(item.entry.id)) continue;
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

  const isDegraded = store.circuit?.isDegraded() ?? false;

  return {
    results,
    source: isDegraded ? "degraded" : "live",
    stale: isDegraded,
    fromCache: false,
    totalTokensUsed,
    withheld: withheld.length > 0 ? withheld : undefined,
    watermark: getStoreWatermark(store),
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
    if (cached) {
      const isDegraded = store.circuit?.isDegraded() ?? false;
      return {
        ...cached,
        fromCache: true,
        stale: isDegraded || cached.stale || false,
      };
    }
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
    fromCache: false,
    stale: result.stale,
  };

  if (cacheKey && store.cache) {
    store.cache.setContext(cacheKey, formatted);
  }

  return formatted;
}
