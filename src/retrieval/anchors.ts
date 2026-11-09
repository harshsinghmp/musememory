import type { Store } from "../store.ts";
import type { ScoredEntry } from "../retrieval.ts";
import { resolveMemoriesForCode, inferProject } from "./code_context.ts";

export interface AnchorRecallInput {
  files?: string[];
  symbols?: string[];
  project?: string;
  includeUntrusted?: boolean;
  limit?: number;
}

/**
 * T-435: anchored invariants for pre-flight. Adapter over the canonical
 * resolver (W26-1) with anchor-only matching and freshness enforced.
 */
export function recallAnchoredMemories(store: Store, input: AnchorRecallInput): ScoredEntry[] {
  return resolveMemoriesForCode(store, {
    files: input.files,
    symbols: input.symbols,
    project: input.project ?? inferProject(store),
    includeUntrusted: input.includeUntrusted,
    enforceFreshness: true,
    skipStaleAnchors: true,
    includeMentions: false,
    limit: input.limit,
  });
}
