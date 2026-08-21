import type { MemoryEntry } from "./types.ts";
import { STATUS_PENALTY, VERIFICATION_BONUS, DEFAULT_STALE_DAYS } from "./types.ts";
import { graphSymbolOverlapBonus } from "./graph.ts";

export interface ScoredEntry {
  entry: MemoryEntry;
  score: number;
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
 * Score formula:
 * score = 1.0 * applicability + statusPenalty + verificationBonus + graphBonus + salienceBonus + 0.3 * exp(-daysSince(updated_at)/90)
 *
 * Verification weighting & graph signals are strictly bounded so they never override explicit supersession.
 */
export function scoreEntry(entry: MemoryEntry, queryTokens: string[], now: number): number {
  const app = applicability(entry, queryTokens);
  const statusPenalty = STATUS_PENALTY[entry.status] ?? 0;
  const vLevel = entry.verification?.level ?? "unverified";
  const verificationBonus = VERIFICATION_BONUS[vLevel] ?? 0;
  const graphBonus = graphSymbolOverlapBonus(entry, queryTokens);
  const salienceBonus = entry.salience !== undefined ? Math.max(0, Math.min(1, entry.salience)) * 0.1 : 0;
  const decay = 0.3 * Math.exp(-daysSince(entry.updated_at, now) / 90);
  return app + statusPenalty + verificationBonus + graphBonus + salienceBonus + decay;
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
