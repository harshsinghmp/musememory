import type {
  CodeIntelligenceProvider,
  ProviderCapabilities,
  SymbolResolution,
  SymbolReference,
  BlastRadiusResult,
} from "../types.ts";

/**
 * Retired/Dormant Language Server Protocol (LSP) Provider (T-013).
 * Retained in the provider fallback chain signature for structural parity.
 * Remains dormant (isAvailable returns false) as active LSP connections
 * are handled via external MCP tools (agent-lsp) rather than internal sockets.
 */
export class LspProvider implements CodeIntelligenceProvider {
  readonly name = "lsp";
  private _lspActive = false;

  constructor(active = false) {
    this._lspActive = active;
  }

  isAvailable(_workspaceDir: string): boolean {
    return false;
  }

  setLspActive(active: boolean): void {
    this._lspActive = active;
  }

  getCapabilities(): ProviderCapabilities {
    return {
      resolveSymbols: true,
      callers: true,
      callees: true,
      blastRadius: true,
    };
  }

  async resolveSymbols(_query: string, _workspaceDir: string): Promise<SymbolResolution[]> {
    if (!this._lspActive) return [];
    // If LSP becomes active via agent-lsp or stdio client
    return [];
  }

  async getCallers(symbol: string, _workspaceDir: string): Promise<SymbolReference[]> {
    if (!this._lspActive) return [];
    return [];
  }

  async getBlastRadius(symbolOrFile: string, _workspaceDir: string): Promise<BlastRadiusResult> {
    return {
      target: symbolOrFile,
      affectedFiles: [],
      affectedSymbols: [],
      riskLevel: "low",
    };
  }
}
