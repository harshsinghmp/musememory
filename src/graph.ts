import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GraphMetadata, MemoryEntry } from "./types.ts";
import { tokenize } from "./rank.ts";

export type GraphProviderType = "codegraph" | "none";

export interface GraphStatus {
  provider: GraphProviderType;
  available: boolean;
  root: string;
  graphRevision?: string;
  symbolCount?: number;
}

/**
 * Detect available graph provider in the project root.
 * Defaults to "none" if no supported provider index is detected.
 */
export function detectProvider(projectRoot: string): GraphProviderType {
  if (!projectRoot || !existsSync(projectRoot)) return "none";
  if (existsSync(join(projectRoot, ".codegraph"))) {
    return "codegraph";
  }
  return "none";
}

export const detectGraphProvider = detectProvider;

/**
 * Check provider status and availability.
 */
export function getGraphStatus(projectRoot: string): GraphStatus {
  const provider = detectProvider(projectRoot);
  if (provider === "codegraph") {
    const codegraphDir = join(projectRoot, ".codegraph");
    let symbolCount: number | undefined;
    let graphRevision: string | undefined;

    try {
      if (existsSync(codegraphDir)) {
        const files = readdirSync(codegraphDir);
        symbolCount = files.length;
        const metaPath = join(codegraphDir, "meta.json");
        if (existsSync(metaPath)) {
          const meta = JSON.parse(readFileSync(metaPath, "utf8"));
          graphRevision = meta.revision ?? meta.commit ?? meta.version;
        }
      }
    } catch {
      // Non-fatal, graceful fallback
    }

    return {
      provider: "codegraph",
      available: true,
      root: codegraphDir,
      graphRevision,
      symbolCount,
    };
  }

  return {
    provider: "none",
    available: false,
    root: projectRoot,
  };
}

/**
 * Calculates a capped relevance bonus (+0.10 max) if memory entry's graph symbols overlap with query tokens.
 * Never overrides verification or status penalties.
 */
export function graphSymbolOverlapBonus(entry: MemoryEntry, queryTokens: string[]): number {
  if (!entry.graph?.symbol_names || entry.graph.symbol_names.length === 0 || queryTokens.length === 0) {
    return 0;
  }
  const symbolTokens = new Set(tokenize(entry.graph.symbol_names.join(" ")));
  const matches = queryTokens.filter((t) => symbolTokens.has(t)).length;
  if (matches === 0) return 0;
  return Math.min(0.1, (matches / Math.max(1, queryTokens.length)) * 0.1);
}

/**
 * Helper to construct valid GraphMetadata object.
 */
export function createGraphMetadata(
  provider: string,
  opts: {
    symbol_names?: string[];
    node_ids?: string[];
    affected_paths?: string[];
    impact_query?: string;
    graph_revision?: string;
    graph_verified_at?: string;
  } = {},
): GraphMetadata {
  return {
    provider,
    graph_revision: opts.graph_revision,
    node_ids: opts.node_ids,
    symbol_names: opts.symbol_names,
    affected_paths: opts.affected_paths,
    impact_query: opts.impact_query,
    graph_verified_at: opts.graph_verified_at ?? new Date().toISOString(),
  };
}
