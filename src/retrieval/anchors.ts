import type { Store } from "../store.ts";
import { list } from "../store.ts";
import type { ScoredEntry } from "../retrieval.ts";

export interface AnchorRecallInput {
  files?: string[];
  symbols?: string[];
  limit?: number;
}

const PRIORITY: Record<string, number> = {
  constraint: 1.0,
  adr: 0.95,
  architecture: 0.9,
  failure: 0.85,
  negative: 0.85,
};

function fileMatches(anchorPath: string, queryPath: string): boolean {
  const a = anchorPath.replace(/^\.\//, "");
  const b = queryPath.replace(/^\.\//, "");
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
    const hit = entry.anchors?.find((anchor) => {
      if (anchor.file_path && files.some((file) => fileMatches(anchor.file_path, file))) return true;
      const name = anchor.symbol_name ?? anchor.qualified_name;
      return Boolean(name && symbols.includes(name));
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
    .sort((a, b) => b.score - a.score || Date.parse(b.entry.updated_at) - Date.parse(a.entry.updated_at))
    .slice(0, Math.min(Math.max(input.limit ?? 10, 1), 50));
}
