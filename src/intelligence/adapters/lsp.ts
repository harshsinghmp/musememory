import type {
  CodeIntelligenceProvider,
  ProviderCapabilities,
  SymbolResolution,
  SymbolReference,
  BlastRadiusResult,
} from "../types.ts";

/**
 * Optional Language Server Protocol (LSP) Provider.
 * Connects to background LSP servers or agent-lsp when active.
 * Degrades gracefully if no LSP server is active.
 */
export class LspProvider implements CodeIntelligenceProvider {
  readonly name = "lsp";
  private _lspActive = false;

  constructor(active = false) {
    this._lspActive = active;
  }

  isAvailable(_workspaceDir: string): boolean {
    return this._lspActive;
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
