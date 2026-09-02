export interface ProviderCapabilities {
  resolveSymbols?: boolean;
  callers?: boolean;
  callees?: boolean;
  relatedFiles?: boolean;
  blastRadius?: boolean;
  graphContext?: boolean;
}

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "variable"
  | "type"
  | "file"
  | "method"
  | "other";

export interface SymbolResolution {
  name: string;
  kind: SymbolKind;
  file: string;
  line?: number;
  character?: number;
  documentation?: string;
  containerName?: string;
}

export interface SymbolReference {
  symbol: string;
  file: string;
  line?: number;
  callerSymbol?: string;
  calleeSymbol?: string;
}

export interface BlastRadiusResult {
  target: string;
  affectedFiles: string[];
  affectedSymbols: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
  summary?: string;
}

export interface GraphNode {
  id: string;
  name: string;
  type: string;
  file: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  relationship: string;
}

export interface GraphContext {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Standard contract for optional code intelligence providers.
 * All external tools (CodeGraph, Graphify, LSP, etc.) implement this interface.
 * MuseMemory MUST operate completely and identically if ZERO providers are present.
 */
export interface CodeIntelligenceProvider {
  /** Human-readable provider identifier (e.g. "codegraph", "graphify", "lsp", "heuristic") */
  readonly name: string;

  /** Checks if the provider is installed and ready for the given workspace */
  isAvailable(workspaceDir: string): Promise<boolean> | boolean;

  /** Declares what this specific provider supports */
  getCapabilities(): ProviderCapabilities;

  /** Resolves symbols matching a query */
  resolveSymbols(query: string, workspaceDir: string): Promise<SymbolResolution[]>;

  /** Finds callers of a given symbol */
  getCallers?(symbol: string, workspaceDir: string): Promise<SymbolReference[]>;

  /** Finds symbols called by a given symbol */
  getCallees?(symbol: string, workspaceDir: string): Promise<SymbolReference[]>;

  /** Finds files closely related to a given file (imports, dependencies, co-edits) */
  getRelatedFiles?(filePath: string, workspaceDir: string): Promise<string[]>;

  /** Calculates blast radius / downstream ripple effects of modifying a symbol or file */
  getBlastRadius?(symbolOrFile: string, workspaceDir: string): Promise<BlastRadiusResult>;

  /** Extracts sub-graph context around given files or symbols */
  extractGraphContext?(paths: string[], workspaceDir: string): Promise<GraphContext>;
}
