import type { Store } from "./store.ts";
import { list } from "./store.ts";
import { tokenize, sortCandidates, estimateEntryTokens, type ScoredEntry } from "./rank.ts";
import type { SearchOptions } from "./types.ts";

export type { SearchOptions };

export interface SearchResult {
  results: ScoredEntry[];
  source: "live";
  stale: boolean;
  totalTokensUsed?: number;
}

export function search(store: Store, _memoryDir: string, query: string, opts: SearchOptions = {}): SearchResult {
  const queryTokens = tokenize(query);
  const now = Date.now();
  let entries = list(store);

  if (opts.project) {
    entries = entries.filter((e) => e.project === opts.project);
  }
  if (!opts.includeSuperseded) {
    entries = entries.filter((e) => e.status !== "superseded" && e.status !== "rejected");
  }
  if (opts.type) {
    entries = entries.filter((e) => e.type === opts.type);
  }
  if (opts.status) {
    entries = entries.filter((e) => e.status === opts.status);
  }
  if (opts.verified) {
    entries = entries.filter(
      (e) =>
        e.verification?.level &&
        e.verification.level !== "unverified" &&
        e.status !== "candidate",
    );
  }

  const scored = sortCandidates(entries, queryTokens, now);
  const limit = opts.limit ?? 10;
  let results: ScoredEntry[] = [];
  let totalTokensUsed = 0;

  if (opts.tokenBudget && opts.tokenBudget > 0) {
    for (const item of scored) {
      if (results.length >= limit) break;
      const tokens = estimateEntryTokens(item.entry);
      if (totalTokensUsed + tokens <= opts.tokenBudget) {
        results.push(item);
        totalTokensUsed += tokens;
      }
    }
  } else {
    results = scored.slice(0, limit);
    totalTokensUsed = results.reduce((acc, r) => acc + estimateEntryTokens(r.entry), 0);
  }

  return {
    results,
    source: "live",
    stale: false,
    totalTokensUsed,
  };
}

