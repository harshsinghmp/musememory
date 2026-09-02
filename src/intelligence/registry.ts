import type {
  CodeIntelligenceProvider,
  SymbolResolution,
  SymbolReference,
  BlastRadiusResult,
  GraphContext,
} from "./types.ts";
import { CodeGraphProvider } from "./adapters/codegraph.ts";
import { GraphifyProvider } from "./adapters/graphify.ts";
import { LspProvider } from "./adapters/lsp.ts";
import { HeuristicFallbackProvider } from "./adapters/heuristic.ts";

export class ProviderRegistry {
  private providers: CodeIntelligenceProvider[] = [];

  constructor(customProviders?: CodeIntelligenceProvider[]) {
    if (customProviders) {
      this.providers = [...customProviders];
    } else {
      // Default fallback chain: CodeGraph -> Graphify -> LSP -> Heuristic
      this.providers = [
        new CodeGraphProvider(),
        new GraphifyProvider(),
        new LspProvider(),
        new HeuristicFallbackProvider(),
      ];
    }
  }

  registerProvider(provider: CodeIntelligenceProvider): void {
    // Unshift so custom providers take priority before fallback
    this.providers.unshift(provider);
  }

  async getAvailableProviders(workspaceDir: string): Promise<CodeIntelligenceProvider[]> {
    const available: CodeIntelligenceProvider[] = [];
    for (const p of this.providers) {
      try {
        if (await p.isAvailable(workspaceDir)) {
          available.push(p);
        }
      } catch {
        // Silently skip broken providers
      }
    }
    return available;
  }

  async resolveSymbolsWithFallback(
    query: string,
    workspaceDir: string,
  ): Promise<SymbolResolution[]> {
    const available = await this.getAvailableProviders(workspaceDir);
    for (const provider of available) {
      if (!provider.getCapabilities().resolveSymbols) continue;
      try {
        const results = await provider.resolveSymbols(query, workspaceDir);
        if (results && results.length > 0) {
          return results;
        }
      } catch {
        // Degrade to next provider in fallback chain
      }
    }
    return [];
  }

  async getCallersWithFallback(
    symbol: string,
    workspaceDir: string,
  ): Promise<SymbolReference[]> {
    const available = await this.getAvailableProviders(workspaceDir);
    for (const provider of available) {
      if (!provider.getCapabilities().callers || !provider.getCallers) continue;
      try {
        const results = await provider.getCallers(symbol, workspaceDir);
        if (results && results.length > 0) {
          return results;
        }
      } catch {}
    }
    return [];
  }

  async getCalleesWithFallback(
    symbol: string,
    workspaceDir: string,
  ): Promise<SymbolReference[]> {
    const available = await this.getAvailableProviders(workspaceDir);
    for (const provider of available) {
      if (!provider.getCapabilities().callees || !provider.getCallees) continue;
      try {
        const results = await provider.getCallees(symbol, workspaceDir);
        if (results && results.length > 0) {
          return results;
        }
      } catch {}
    }
    return [];
  }

  async getRelatedFilesWithFallback(
    filePath: string,
    workspaceDir: string,
  ): Promise<string[]> {
    const available = await this.getAvailableProviders(workspaceDir);
    for (const provider of available) {
      if (!provider.getCapabilities().relatedFiles || !provider.getRelatedFiles) continue;
      try {
        const results = await provider.getRelatedFiles(filePath, workspaceDir);
        if (results && results.length > 0) {
          return results;
        }
      } catch {}
    }
    return [];
  }

  async getBlastRadiusWithFallback(
    symbolOrFile: string,
    workspaceDir: string,
  ): Promise<BlastRadiusResult> {
    const available = await this.getAvailableProviders(workspaceDir);
    for (const provider of available) {
      if (!provider.getCapabilities().blastRadius || !provider.getBlastRadius) continue;
      try {
        const result = await provider.getBlastRadius(symbolOrFile, workspaceDir);
        if (result && result.affectedFiles.length > 0) {
          return result;
        }
      } catch {}
    }
    return {
      target: symbolOrFile,
      affectedFiles: [],
      affectedSymbols: [],
      riskLevel: "low",
      summary: "No dependent references discovered.",
    };
  }

  async extractGraphContextWithFallback(
    paths: string[],
    workspaceDir: string,
  ): Promise<GraphContext> {
    const available = await this.getAvailableProviders(workspaceDir);
    for (const provider of available) {
      if (!provider.getCapabilities().graphContext || !provider.extractGraphContext) continue;
      try {
        const result = await provider.extractGraphContext(paths, workspaceDir);
        if (result && result.nodes.length > 0) {
          return result;
        }
      } catch {}
    }
    return { nodes: [], edges: [] };
  }
}

// Global default registry singleton
export const defaultRegistry = new ProviderRegistry();
