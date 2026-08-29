import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { GraphMetadata } from "./types.ts";

export type GraphProviderType = "codegraph" | "graphify" | "none";

export interface GraphStatus {
  provider: GraphProviderType;
  available: boolean;
  root: string;
  graphRevision?: string;
  symbolCount?: number;
}

export interface GraphIndex {
  provider: GraphProviderType;
  indexedAt: string;
  symbolCount: number;
  symbols: Record<string, string>; // symbolName -> relativeFilePath
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
  if (existsSync(join(projectRoot, ".graphify"))) {
    return "graphify";
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

  if (provider === "graphify") {
    const graphifyDir = join(projectRoot, ".graphify");
    let symbolCount: number | undefined;
    let graphRevision: string | undefined;

    try {
      if (existsSync(graphifyDir)) {
        const files = readdirSync(graphifyDir);
        symbolCount = files.length;
        const metaPath = join(graphifyDir, "meta.json");
        if (existsSync(metaPath)) {
          const meta = JSON.parse(readFileSync(metaPath, "utf8"));
          graphRevision = meta.revision ?? meta.commit ?? meta.version;
        }
      }
    } catch {
      // Non-fatal, graceful fallback
    }

    return {
      provider: "graphify",
      available: true,
      root: graphifyDir,
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

/** Path to cached symbol index in .memory/ */
export function graphSymbolsPath(memoryDir: string): string {
  return join(memoryDir, "graph-symbols.json");
}

/**
 * Indexes the AST symbol graph from the detected provider (.codegraph or .graphify)
 * and caches a symbol -> file_path map in .memory/graph-symbols.json.
 */
export function indexGraph(projectRoot: string, memoryDir: string): GraphIndex {
  const status = getGraphStatus(projectRoot);
  const symbols: Record<string, string> = {};

  if (status.provider === "codegraph") {
    const codegraphDir = join(projectRoot, ".codegraph");
    try {
      // 1. Check for symbols.json or index.json
      const candidates = [
        join(codegraphDir, "symbols.json"),
        join(codegraphDir, "index.json"),
        join(codegraphDir, "graph.json"),
      ];
      for (const c of candidates) {
        if (existsSync(c)) {
          const data = JSON.parse(readFileSync(c, "utf8"));
          if (Array.isArray(data)) {
            for (const item of data) {
              if (item.name && item.path) {
                symbols[String(item.name)] = String(item.path);
              }
            }
          } else if (typeof data === "object" && data !== null) {
            if (data.symbols && typeof data.symbols === "object") {
              for (const [k, v] of Object.entries(data.symbols)) {
                symbols[k] = typeof v === "string" ? v : (v as any)?.path || "";
              }
            } else {
              for (const [k, v] of Object.entries(data)) {
                if (typeof v === "string") symbols[k] = v;
              }
            }
          }
        }
      }

      // 2. Scan definition JSON files if symbols map is empty
      if (Object.keys(symbols).length === 0 && existsSync(codegraphDir)) {
        const files = readdirSync(codegraphDir);
        for (const file of files) {
          if (file.endsWith(".json") && file !== "meta.json") {
            try {
              const content = JSON.parse(readFileSync(join(codegraphDir, file), "utf8"));
              if (content.name && content.path) {
                symbols[String(content.name)] = String(content.path);
              } else if (content.symbols && Array.isArray(content.symbols)) {
                for (const s of content.symbols) {
                  if (s.name && (s.path || content.path)) {
                    symbols[String(s.name)] = String(s.path || content.path);
                  }
                }
              }
            } catch {}
          }
        }
      }
    } catch {}
  } else if (status.provider === "graphify") {
    const graphifyDir = join(projectRoot, ".graphify");
    try {
      const candidates = [
        join(graphifyDir, "graph.json"),
        join(graphifyDir, "symbols.json"),
      ];
      for (const c of candidates) {
        if (existsSync(c)) {
          const data = JSON.parse(readFileSync(c, "utf8"));
          if (data.nodes && Array.isArray(data.nodes)) {
            for (const node of data.nodes) {
              if (node.name && node.path) {
                symbols[String(node.name)] = String(node.path);
              }
            }
          }
        }
      }
    } catch {}
  }

  const index: GraphIndex = {
    provider: status.provider,
    indexedAt: new Date().toISOString(),
    symbolCount: Object.keys(symbols).length,
    symbols,
  };

  try {
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(graphSymbolsPath(memoryDir), JSON.stringify(index, null, 2), "utf8");
  } catch {}

  return index;
}

/**
 * Loads the cached AST symbol index from .memory/graph-symbols.json.
 */
export function loadGraphSymbolIndex(memoryDir: string): GraphIndex | null {
  const p = graphSymbolsPath(memoryDir);
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, "utf8");
    return JSON.parse(raw) as GraphIndex;
  } catch {
    return null;
  }
}

/**
 * Extracts referenced AST symbols from text by matching against indexed symbols.
 */
export function extractReferencedSymbols(
  text: string,
  memoryDir: string,
): { symbol_names: string[]; affected_paths: string[]; provider: GraphProviderType } {
  const index = loadGraphSymbolIndex(memoryDir);
  if (!index || index.symbolCount === 0) {
    return { symbol_names: [], affected_paths: [], provider: "none" };
  }

  const matchedSymbols = new Set<string>();
  const affectedPaths = new Set<string>();

  // Tokenize text into identifiers
  const words = text.match(/[a-zA-Z_$][a-zA-Z0-9_$]*/g) || [];
  const wordSet = new Set(words);

  for (const [symbol, path] of Object.entries(index.symbols)) {
    if (wordSet.has(symbol)) {
      matchedSymbols.add(symbol);
      if (path) affectedPaths.add(path);
    }
  }

  return {
    symbol_names: Array.from(matchedSymbols),
    affected_paths: Array.from(affectedPaths),
    provider: index.provider,
  };
}

/**
 * Automatically stamps graph metadata on a proposed or harvested memory entry if symbols are referenced.
 */
export function autoStampGraphMetadata(
  text: string,
  memoryDir: string,
): GraphMetadata | undefined {
  const extracted = extractReferencedSymbols(text, memoryDir);
  if (extracted.symbol_names.length === 0) return undefined;

  return {
    provider: extracted.provider,
    symbol_names: extracted.symbol_names,
    affected_paths: extracted.affected_paths,
    graph_verified_at: new Date().toISOString(),
  };
}
