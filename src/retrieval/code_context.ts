import type { Store } from "../store.ts";
import { list } from "../store.ts";
import type { ScoredEntry } from "../retrieval.ts";
import type { MemoryEntry } from "../types.ts";

export interface CodeContextInput {
  files?: string[];
  symbols?: string[];
  project?: string;
  includeMentions?: boolean;
  includeUntrusted?: boolean;
  /** Apply anchor freshness, validity and expiry gates (pre-flight default). */
  enforceFreshness?: boolean;
  limit?: number;
}

const PRIORITY: Record<string, number> = {
  constraint: 1.0,
  adr: 0.95,
  architecture: 0.9,
  failure: 0.85,
  negative: 0.85,
};

const HIDDEN_STATUSES = new Set(["superseded", "rejected", "conflicted"]);

export function normalizeCodePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();
}

function fileMatches(anchorPath: string, queryPath: string): boolean {
  const a = normalizeCodePath(anchorPath);
  const b = normalizeCodePath(queryPath);
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function isUnfresh(entry: MemoryEntry, now: number): boolean {
  if (entry.valid_to && Date.parse(entry.valid_to) <= now) return true;
  if (entry.expires_at && Date.parse(entry.expires_at) <= now) return true;
  return (entry.anchors ?? []).some((anchor) => anchor.status === "orphaned" || anchor.status === "drifted");
}

/**
 * W26-1: the single file/symbol → memory resolver. Both the pre-flight
 * anchored-invariant surface and the PR-context resolver are adapters over
 * this function, so matching, ranking and reason tokens cannot drift apart.
 */
export function resolveMemoriesForCode(store: Store, input: CodeContextInput): ScoredEntry[] {
  const files = input.files ?? [];
  const symbols = input.symbols ?? [];
  if (files.length === 0 && symbols.length === 0) return [];
  const now = Date.now();
  const matched: ScoredEntry[] = [];

  for (const entry of list(store)) {
    if (entry.status === "archived") continue;
    if (HIDDEN_STATUSES.has(entry.status)) continue;
    if (input.project && entry.project !== input.project) continue;
    if (!input.includeUntrusted && entry.trust === "untrusted") continue;
    if (input.enforceFreshness !== false && isUnfresh(entry, now)) continue;

    let reason: string | undefined;
    const anchor = (entry.anchors ?? []).find((candidate) => {
      if (candidate.status === "orphaned" || candidate.status === "drifted") return false;
      if (candidate.file_path && files.some((file) => fileMatches(candidate.file_path, file))) return true;
      const name = candidate.symbol_name ?? candidate.qualified_name;
      return Boolean(name && symbols.some((symbol) => symbol.toLowerCase() === name.toLowerCase()));
    });
    if (anchor) {
      reason = `anchor:${anchor.kind}:${anchor.file_path || anchor.symbol_name || anchor.qualified_name || anchor.id}`;
    } else if (input.includeMentions) {
      const haystack = `${entry.title} ${entry.content}`.toLowerCase();
      const file = files.find((candidate) => haystack.includes(normalizeCodePath(candidate)));
      const symbol = symbols.find((candidate) => haystack.includes(candidate.toLowerCase()));
      if (file) reason = `mention:file:${file}`;
      else if (symbol) reason = `mention:symbol:${symbol}`;
    }
    if (!reason) continue;

    const base = entry.type ? PRIORITY[entry.type] ?? 0.7 : 0.7;
    const anchorBoost = reason.startsWith("anchor:") ? 0.1 : 0;
    const verified = entry.verification?.level && entry.verification.level !== "unverified" ? 0.05 : 0;
    matched.push({ entry, score: Math.min(1, base + anchorBoost + verified), why_retrieved: [reason] });
  }

  return matched
    .sort((a, b) => {
      const byScore = b.score - a.score;
      if (byScore !== 0) return byScore;
      const at = Date.parse(a.entry.updated_at);
      const bt = Date.parse(b.entry.updated_at);
      return (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at);
    })
    .slice(0, Math.min(Math.max(input.limit ?? 10, 1), 50));
}
