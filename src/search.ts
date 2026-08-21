import type { Store } from "./store.ts";
import { list, maxMtime } from "./store.ts";
import { tokenize, sortCandidates, type ScoredEntry } from "./rank.ts";
import type { MemoryEntry } from "./types.ts";

export interface SearchOptions {
  limit?: number;
  project?: string;
  includeSuperseded?: boolean;
  type?: string;
  status?: string;
  verified?: boolean;
}

export interface SearchResult {
  results: ScoredEntry[];
  source: "live";
  stale: boolean;
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
  const results = scored.slice(0, limit);

  return {
    results,
    source: "live",
    stale: false,
  };
}
