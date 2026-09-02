import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CodeIntelligenceProvider,
  ProviderCapabilities,
  SymbolResolution,
  BlastRadiusResult,
  GraphContext,
} from "../types.ts";

/**
 * Optional Graphify Provider.
 * Integrates with Graphify graph indexing (.graphify directory or graph.json).
 * If Graphify is not configured in the workspace, this provider quietly reports isAvailable = false.
 */
export class GraphifyProvider implements CodeIntelligenceProvider {
  readonly name = "graphify";

  isAvailable(workspaceDir: string): boolean {
    if (!workspaceDir) return false;
    return existsSync(join(workspaceDir, ".graphify"));
  }

  getCapabilities(): ProviderCapabilities {
    return {
      resolveSymbols: true,
      relatedFiles: true,
      blastRadius: true,
      graphContext: true,
    };
  }

  async resolveSymbols(query: string, workspaceDir: string): Promise<SymbolResolution[]> {
    if (!this.isAvailable(workspaceDir) || !query.trim()) return [];

    const graphPath = join(workspaceDir, ".graphify", "graph.json");
    if (!existsSync(graphPath)) return [];

    try {
      const data = JSON.parse(readFileSync(graphPath, "utf8"));
      const nodes = Array.isArray(data.nodes) ? data.nodes : [];
      const lowerQuery = query.toLowerCase();

      return nodes
        .filter((n: any) => (n.label || n.name || "").toLowerCase().includes(lowerQuery))
        .map((n: any) => ({
          name: n.label || n.name,
          kind: n.type || "function",
          file: n.file || n.path || "",
          line: n.line,
        }))
        .slice(0, 25);
    } catch {
      return [];
    }
  }

  async getRelatedFiles(filePath: string, workspaceDir: string): Promise<string[]> {
    if (!this.isAvailable(workspaceDir)) return [];

    const graphPath = join(workspaceDir, ".graphify", "graph.json");
    if (!existsSync(graphPath)) return [];

    try {
      const data = JSON.parse(readFileSync(graphPath, "utf8"));
      const edges = Array.isArray(data.edges) ? data.edges : [];
      const related = new Set<string>();

      for (const edge of edges) {
        if (edge.source === filePath && edge.target) related.add(edge.target);
        if (edge.target === filePath && edge.source) related.add(edge.source);
      }

      return Array.from(related);
    } catch {
      return [];
    }
  }

  async extractGraphContext(paths: string[], workspaceDir: string): Promise<GraphContext> {
    if (!this.isAvailable(workspaceDir)) return { nodes: [], edges: [] };

    const graphPath = join(workspaceDir, ".graphify", "graph.json");
    if (!existsSync(graphPath)) return { nodes: [], edges: [] };

    try {
      const data = JSON.parse(readFileSync(graphPath, "utf8"));
      const allNodes = Array.isArray(data.nodes) ? data.nodes : [];
      const allEdges = Array.isArray(data.edges) ? data.edges : [];
      const pathSet = new Set(paths);

      const relevantNodes = allNodes.filter((n: any) => pathSet.has(n.file || n.path || n.id));
      const relevantNodeIds = new Set(relevantNodes.map((n: any) => n.id));

      const relevantEdges = allEdges.filter(
        (e: any) => relevantNodeIds.has(e.source) || relevantNodeIds.has(e.target),
      );

      return {
        nodes: relevantNodes.map((n: any) => ({
          id: n.id,
          name: n.label || n.name || n.id,
          type: n.type || "file",
          file: n.file || n.path || "",
        })),
        edges: relevantEdges.map((e: any) => ({
          source: e.source,
          target: e.target,
          relationship: e.relationship || "relates_to",
        })),
      };
    } catch {
      return { nodes: [], edges: [] };
    }
  }

  async getBlastRadius(symbolOrFile: string, workspaceDir: string): Promise<BlastRadiusResult> {
    const relatedFiles = await this.getRelatedFiles(symbolOrFile, workspaceDir);
    const riskLevel: BlastRadiusResult["riskLevel"] =
      relatedFiles.length > 8 ? "critical" : relatedFiles.length > 4 ? "high" : relatedFiles.length > 0 ? "medium" : "low";

    return {
      target: symbolOrFile,
      affectedFiles: relatedFiles,
      affectedSymbols: [],
      riskLevel,
      summary: `Graphify network: ${relatedFiles.length} connected files.`,
    };
  }
}
