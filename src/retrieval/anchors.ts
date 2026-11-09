import type { Store } from "../store.ts";
import { list } from "../store.ts";
import type { ScoredEntry } from "../retrieval.ts";

export interface AnchorRecallInput {
  files?: string[];
  symbols?: string[];
  project?: string;
  includeUntrusted?: boolean;
  limit?: number;
}

const PRIORITY: Record<string, number> = {
  constraint: 1.0,
  adr: 0.95,
  architecture: 0.9,
  failure: 0.85,
  negative: 0.85,
};

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.?\//, "");
}

function fileMatches(anchorPath: string, queryPath: string): boolean {
  const a = normalizePath(anchorPath);
  const b = normalizePath(queryPath);
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

/**
 * T-435: AST-anchored invariant auto-recall. Given the files/symbols being
 * edited, surface the constraints, ADRs and architecture memories anchored to
 * them before the agent changes anything.
 */
export function recallAnchoredMemories(store: Store, input: AnchorRecallInput): ScoredEntry[] {
  const files = input.files ?? [];
  const symbols = input.symbols ?? [];
  if (files.length === 0 && symbols.length === 0) return [];

  const matches: ScoredEntry[] = [];
  for (const entry of list(store)) {
    if (entry.status !== "active" && entry.status !== "confirmed") continue;
    if (input.project && entry.project !== input.project) continue;
    if (!input.includeUntrusted && entry.trust === "untrusted") continue;
    if (entry.valid_to && Date.parse(entry.valid_to) <= Date.now()) continue;
    if (entry.expires_at && Date.parse(entry.expires_at) <= Date.now()) continue;
    const hit = entry.anchors?.find((anchor) => {
      if (anchor.status === "orphaned" || anchor.status === "drifted") return false;
      if (anchor.file_path && files.some((file) => fileMatches(anchor.file_path, file))) return true;
      const name = anchor.symbol_name ?? anchor.qualified_name;
      return Boolean(name && symbols.some((symbol) => symbol.toLowerCase() === name.toLowerCase()));
    });
    if (!hit) continue;
    const base = entry.type ? PRIORITY[entry.type] ?? 0.7 : 0.7;
    const verified = entry.verification?.level && entry.verification.level !== "unverified" ? 0.05 : 0;
    matches.push({
      entry,
      score: Math.min(1, base + verified),
      why_retrieved: [`anchor:${hit.kind}:${hit.file_path || hit.symbol_name || hit.qualified_name || hit.id}`],
    });
  }

  return matches
    .sort((a, b) => {
      const byScore = b.score - a.score;
      if (byScore !== 0) return byScore;
      const at = Date.parse(a.entry.updated_at);
      const bt = Date.parse(b.entry.updated_at);
      return (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at);
    })
    .slice(0, Math.min(Math.max(input.limit ?? 10, 1), 50));
}
