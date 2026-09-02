import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join, extname, relative } from "node:path";
import type {
  CodeIntelligenceProvider,
  ProviderCapabilities,
  SymbolResolution,
  SymbolReference,
  BlastRadiusResult,
  GraphContext,
} from "../types.ts";

const SOURCE_EXTS = new Set([".ts", ".js", ".tsx", ".jsx", ".py", ".go", ".rs", ".java", ".c", ".cpp"]);

/**
 * Built-in zero-dependency heuristic provider.
 * Uses lightweight regex and text inspection over local workspace files.
 * Always available as the baseline fallback in the provider chain.
 */
export class HeuristicFallbackProvider implements CodeIntelligenceProvider {
  readonly name = "heuristic";

  isAvailable(_workspaceDir: string): boolean {
    return true;
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
    if (!existsSync(workspaceDir) || !query.trim()) return [];

    const files = this.scanFiles(workspaceDir, 50);
    const results: SymbolResolution[] = [];
    const lowerQuery = query.toLowerCase();

    // Regex for functions, classes, interfaces
    const symbolRegex = /(?:function|class|interface|type|const|let|var|def|fn)\s+([a-zA-Z0-9_$]+)/g;

    for (const filePath of files) {
      try {
        const content = readFileSync(filePath, "utf8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          let match: RegExpExecArray | null;
          symbolRegex.lastIndex = 0;

          while ((match = symbolRegex.exec(line)) !== null) {
            const symName = match[1];
            if (symName.toLowerCase().includes(lowerQuery)) {
              results.push({
                name: symName,
                kind: line.includes("class")
                  ? "class"
                  : line.includes("interface")
                  ? "interface"
                  : line.includes("type")
                  ? "type"
                  : "function",
                file: relative(workspaceDir, filePath),
                line: i + 1,
                documentation: line.trim(),
              });
              if (results.length >= 25) return results;
            }
          }
        }
      } catch {}
    }

    return results;
  }

  async getCallers(symbol: string, workspaceDir: string): Promise<SymbolReference[]> {
    if (!existsSync(workspaceDir) || !symbol.trim()) return [];

    const files = this.scanFiles(workspaceDir, 50);
    const references: SymbolReference[] = [];
    const callPattern = new RegExp(`\\b${symbol}\\s*\\(`, "g");

    for (const filePath of files) {
      try {
        const content = readFileSync(filePath, "utf8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          if (callPattern.test(lines[i])) {
            references.push({
              symbol,
              file: relative(workspaceDir, filePath),
              line: i + 1,
            });
            if (references.length >= 20) return references;
          }
        }
      } catch {}
    }

    return references;
  }

  async getCallees(symbol: string, workspaceDir: string): Promise<SymbolReference[]> {
    // Find definition of symbol and inspect calls within its body
    const definitions = await this.resolveSymbols(symbol, workspaceDir);
    if (definitions.length === 0) return [];

    const def = definitions[0];
    const fullPath = join(workspaceDir, def.file);
    if (!existsSync(fullPath)) return [];

    const content = readFileSync(fullPath, "utf8");
    const lines = content.split("\n");
    const startLine = (def.line ?? 1) - 1;
    const block = lines.slice(startLine, startLine + 50).join("\n");

    const callRegex = /([a-zA-Z0-9_$]+)\s*\(/g;
    const callees: SymbolReference[] = [];
    let match: RegExpExecArray | null;

    while ((match = callRegex.exec(block)) !== null) {
      const callee = match[1];
      if (callee !== symbol && !["if", "for", "while", "switch", "catch"].includes(callee)) {
        callees.push({
          symbol: callee,
          file: def.file,
          callerSymbol: symbol,
        });
        if (callees.length >= 15) break;
      }
    }

    return callees;
  }

  async getRelatedFiles(filePath: string, workspaceDir: string): Promise<string[]> {
    const fullPath = join(workspaceDir, filePath);
    if (!existsSync(fullPath)) return [];

    const content = readFileSync(fullPath, "utf8");
    const importRegex = /(?:import|from|require)\s*\(?['"]([^'"]+)['"]/g;
    const related = new Set<string>();
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];
      if (importPath.startsWith(".")) {
        related.add(importPath);
      }
    }

    return Array.from(related);
  }

  async getBlastRadius(symbolOrFile: string, workspaceDir: string): Promise<BlastRadiusResult> {
    const callers = await this.getCallers(symbolOrFile, workspaceDir);
    const affectedFiles = Array.from(new Set(callers.map((c) => c.file)));

    const riskLevel: BlastRadiusResult["riskLevel"] =
      affectedFiles.length > 10 ? "critical" : affectedFiles.length > 5 ? "high" : affectedFiles.length > 1 ? "medium" : "low";

    return {
      target: symbolOrFile,
      affectedFiles,
      affectedSymbols: callers.map((c) => c.symbol),
      riskLevel,
      summary: `Heuristic scan: ${affectedFiles.length} files reference "${symbolOrFile}".`,
    };
  }

  async extractGraphContext(paths: string[], workspaceDir: string): Promise<GraphContext> {
    const nodes: GraphContext["nodes"] = [];
    const edges: GraphContext["edges"] = [];

    for (const p of paths) {
      nodes.push({
        id: p,
        name: p,
        type: "file",
        file: p,
      });

      const related = await this.getRelatedFiles(p, workspaceDir);
      for (const r of related) {
        edges.push({
          source: p,
          target: r,
          relationship: "imports",
        });
      }
    }

    return { nodes, edges };
  }

  private scanFiles(dir: string, maxFiles: number): string[] {
    const files: string[] = [];

    const walk = (currentDir: string) => {
      if (files.length >= maxFiles) return;
      let entries: string[] = [];
      try {
        entries = readdirSync(currentDir);
      } catch {
        return;
      }

      for (const entry of entries) {
        if (
          entry.startsWith(".") ||
          entry === "node_modules" ||
          entry === "dist" ||
          entry === "build" ||
          entry === "coverage"
        ) {
          continue;
        }

        const full = join(currentDir, entry);
        try {
          const stat = statSync(full);
          if (stat.isDirectory()) {
            walk(full);
          } else if (stat.isFile() && SOURCE_EXTS.has(extname(entry))) {
            files.push(full);
            if (files.length >= maxFiles) return;
          }
        } catch {}
      }
    };

    walk(dir);
    return files;
  }
}
