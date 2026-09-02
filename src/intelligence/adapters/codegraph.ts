import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  CodeIntelligenceProvider,
  ProviderCapabilities,
  SymbolResolution,
  SymbolReference,
  BlastRadiusResult,
  GraphContext,
} from "../types.ts";

/**
 * Optional CodeGraph Provider.
 * Integrates with CodeGraph indexing (.codegraph directory or codegraph CLI).
 * If CodeGraph is not indexed in the workspace, this provider quietly reports isAvailable = false.
 */
export class CodeGraphProvider implements CodeIntelligenceProvider {
  readonly name = "codegraph";

  isAvailable(workspaceDir: string): boolean {
    if (!workspaceDir) return false;
    return existsSync(join(workspaceDir, ".codegraph"));
  }

  getCapabilities(): ProviderCapabilities {
    return {
      resolveSymbols: true,
      callers: true,
      callees: true,
      relatedFiles: true,
      blastRadius: true,
      graphContext: true,
    };
  }

  async resolveSymbols(query: string, workspaceDir: string): Promise<SymbolResolution[]> {
    if (!this.isAvailable(workspaceDir) || !query.trim()) return [];

    try {
      // Execute codegraph explore via Bun.spawn if available
      const proc = Bun.spawn(["codegraph", "explore", query], {
        cwd: workspaceDir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      if (exitCode !== 0 || !output.trim()) return [];

      const symbols: SymbolResolution[] = [];
      const lines = output.split("\n");

      for (const line of lines) {
        // e.g. "symbolName (function) in src/foo.ts:42"
        const match = line.match(/^([a-zA-Z0-9_$]+)\s+\(([^)]+)\)\s+in\s+([^:]+)(?::(\d+))?/);
        if (match) {
          symbols.push({
            name: match[1],
            kind: (match[2] as any) || "function",
            file: match[3],
            line: match[4] ? parseInt(match[4], 10) : undefined,
          });
        }
      }

      return symbols;
    } catch {
      return [];
    }
  }

  async getCallers(symbol: string, workspaceDir: string): Promise<SymbolReference[]> {
    if (!this.isAvailable(workspaceDir) || !symbol.trim()) return [];

    try {
      const proc = Bun.spawn(["codegraph", "callers", symbol], {
        cwd: workspaceDir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      if (exitCode !== 0 || !output.trim()) return [];

      const references: SymbolReference[] = [];
      const lines = output.split("\n");

      for (const line of lines) {
        const match = line.match(/^([^:]+):(\d+)(?::\s*([a-zA-Z0-9_$]+))?/);
        if (match) {
          references.push({
            symbol,
            file: match[1],
            line: parseInt(match[2], 10),
            callerSymbol: match[3],
          });
        }
      }

      return references;
    } catch {
      return [];
    }
  }

  async getBlastRadius(symbolOrFile: string, workspaceDir: string): Promise<BlastRadiusResult> {
    if (!this.isAvailable(workspaceDir)) {
      return {
        target: symbolOrFile,
        affectedFiles: [],
        affectedSymbols: [],
        riskLevel: "low",
      };
    }

    try {
      const callers = await this.getCallers(symbolOrFile, workspaceDir);
      const affectedFiles = Array.from(new Set(callers.map((c) => c.file)));
      const riskLevel: BlastRadiusResult["riskLevel"] =
        affectedFiles.length > 8 ? "critical" : affectedFiles.length > 4 ? "high" : affectedFiles.length > 0 ? "medium" : "low";

      return {
        target: symbolOrFile,
        affectedFiles,
        affectedSymbols: callers.map((c) => c.symbol),
        riskLevel,
        summary: `CodeGraph analysis: ${affectedFiles.length} dependent files detected.`,
      };
    } catch {
      return {
        target: symbolOrFile,
        affectedFiles: [],
        affectedSymbols: [],
        riskLevel: "low",
      };
    }
  }
}
