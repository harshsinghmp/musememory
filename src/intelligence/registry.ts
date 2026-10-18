import type {
  CodeIntelligenceProvider,
  SymbolResolution,
  BlastRadiusResult,
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
}

// Global default registry singleton
export const defaultRegistry = new ProviderRegistry();
