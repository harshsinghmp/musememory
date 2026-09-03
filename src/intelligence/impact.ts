import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import type { Store } from "../store.ts";
import { resolveMemoryForCode } from "../orchestrator/bidirectional.ts";
import { listAdrs } from "../adrs/engine.ts";
import { defaultRegistry } from "./registry.ts";
import type { BlastRadiusResult } from "./types.ts";

export interface CodeImpactDetails {
  targetFile: string;
  targetSymbol?: string;
  callers: string[];
  affectedModules: string[];
  affectedTests: string[];
  affectedRoutes: string[];
  totalCodeEntities: number;
}

export interface MemoryImpactDetails {
  linkedMemories: Array<{ id: string; title: string; type: string; salience: number }>;
  adrs: Array<{ id: string; title: string; status: string; consequences?: string[] }>;
  knownBugs: Array<{ id: string; title: string; rootCause?: string }>;
  negativeWarnings: Array<{ id: string; title: string; pattern: string }>;
  activeConstraints: string[];
  totalMemoryEntities: number;
}

export interface DocImpactDetails {
  relatedDocs: string[];
  totalDocs: number;
}

export interface MemoryCodeImpactResult {
  target: {
    file: string;
    symbol?: string;
  };
  risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  riskScore: number; // 0 to 100
  riskFactors: string[];
  code: CodeImpactDetails;
  memory: MemoryImpactDetails;
  docs: DocImpactDetails;
  recommendations: string[];
  analyzedAt: string;
}

export interface AnalyzeImpactOptions {
  filePath: string;
  symbolName?: string;
  project?: string;
  workspaceRoot?: string;
}

/**
 * Synthesizes AST code callers, linked memories, living ADRs, negative warnings,
 * and documentation references into a comprehensive blast radius and risk assessment.
 */
export async function analyzeMemoryCodeImpact(
  store: Store,
  options: AnalyzeImpactOptions
): Promise<MemoryCodeImpactResult> {
  const root = options.workspaceRoot || store.dir || process.cwd();
  const targetFile = options.filePath;
  const targetSymbol = options.symbolName;

  // 1. Resolve Code Impact via Code Intelligence Provider
  let blast: BlastRadiusResult | undefined;
  const queryTarget = targetSymbol || targetFile;

  try {
    blast = await defaultRegistry.getBlastRadiusWithFallback(queryTarget, root);
  } catch {
    // Fallback gracefully
  }

  const affectedFiles = blast?.affectedFiles || [];
  const callers = blast?.affectedSymbols || [];

  const affectedTests: string[] = [];
  const affectedRoutes: string[] = [];
  const affectedModules: string[] = [];

  for (const f of affectedFiles) {
    const lower = f.toLowerCase();
    if (lower.includes("test") || lower.includes("spec")) {
      affectedTests.push(f);
    } else if (
      lower.includes("routes") ||
      lower.includes("api") ||
      lower.includes("endpoint") ||
      lower.includes("controller")
    ) {
      affectedRoutes.push(f);
    } else {
      affectedModules.push(f);
    }
  }

  const codeDetails: CodeImpactDetails = {
    targetFile,
    targetSymbol,
    callers,
    affectedModules,
    affectedTests,
    affectedRoutes,
    totalCodeEntities: callers.length + affectedFiles.length,
  };

  // 2. Resolve Memory Impact
  const memoryRes = resolveMemoryForCode(store, {
    filePath: targetFile,
    symbolName: targetSymbol,
  });

  const linkedMemories = memoryRes.associated_memories.map((m) => ({
    id: m.id,
    title: m.title,
    type: (m.type as string) || "knowledge",
    salience: m.salience ?? 1.0,
  }));

  const negativeWarnings = memoryRes.negative_lessons.map((m) => ({
    id: m.id,
    title: m.title,
    pattern: m.negative?.failed_approach || m.content.slice(0, 100),
  }));

  const knownBugs = memoryRes.associated_memories
    .filter((m) => m.type === "fix" || m.tags?.some((t) => t.includes("bug")))
    .map((m) => ({
      id: m.id,
      title: m.title,
      rootCause: m.content.slice(0, 100),
    }));

  // Fetch relevant ADRs
  const allAdrs = listAdrs(store);
  const matchedAdrs: Array<{ id: string; title: string; status: string; consequences?: string[] }> = [];

  const fileBase = basename(targetFile).toLowerCase();
  for (const adr of allAdrs) {
    const text = `${adr.title} ${adr.content}`.toLowerCase();
    const hasAnchor = adr.anchors?.some((a) =>
      a.file_path.toLowerCase().includes(fileBase) ||
      (targetSymbol && a.symbol_name?.toLowerCase() === targetSymbol.toLowerCase())
    );

    if (hasAnchor || text.includes(fileBase) || (targetSymbol && text.includes(targetSymbol.toLowerCase()))) {
      matchedAdrs.push({
        id: adr.id,
        title: adr.title,
        status: adr.adr?.status || "accepted",
        consequences: adr.adr?.consequences
          ? [...(adr.adr.consequences.positive || []), ...(adr.adr.consequences.negative || [])]
          : undefined,
      });
    }
  }

  // Active constraints from CURRENT.md
  const activeConstraints: string[] = memoryRes.constraints.map((c) => c.title);
  const currentMdPath = join(store.memoryDir || join(root, ".memory"), "CURRENT.md");
  if (existsSync(currentMdPath)) {
    try {
      const currentContent = readFileSync(currentMdPath, "utf8");
      const lines = currentContent.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("- [ ]") || trimmed.startsWith("- [x]")) {
          activeConstraints.push(trimmed.replace(/^-\s*\[[ x]\]\s*/, ""));
        }
      }
    } catch {}
  }

  const memoryDetails: MemoryImpactDetails = {
    linkedMemories,
    adrs: matchedAdrs,
    knownBugs,
    negativeWarnings,
    activeConstraints: Array.from(new Set(activeConstraints)),
    totalMemoryEntities:
      linkedMemories.length + matchedAdrs.length + negativeWarnings.length + activeConstraints.length,
  };

  // 3. Resolve Documentation Impact
  const relatedDocs: string[] = [];
  const docsDir = join(root, "docs");
  if (existsSync(docsDir)) {
    try {
      const docFiles = readdirSync(docsDir, { recursive: true }) as string[];
      for (const df of docFiles) {
        if (typeof df === "string" && (df.endsWith(".md") || df.endsWith(".mdx"))) {
          const fullPath = join(docsDir, df);
          const content = readFileSync(fullPath, "utf8").toLowerCase();
          if (content.includes(fileBase) || (targetSymbol && content.includes(targetSymbol.toLowerCase()))) {
            relatedDocs.push(`docs/${df}`);
          }
        }
      }
    } catch {}
  }

  const readmePath = join(root, "README.md");
  if (existsSync(readmePath)) {
    try {
      const readmeContent = readFileSync(readmePath, "utf8").toLowerCase();
      if (readmeContent.includes(fileBase) || (targetSymbol && readmeContent.includes(targetSymbol.toLowerCase()))) {
        relatedDocs.push("README.md");
      }
    } catch {}
  }

  const docDetails: DocImpactDetails = {
    relatedDocs: Array.from(new Set(relatedDocs)),
    totalDocs: relatedDocs.length,
  };

  // 4. Compute Composite Risk Score
  let score = 10; // Baseline
  score += Math.min(25, callers.length * 4);
  score += Math.min(15, affectedTests.length * 5);
  score += Math.min(25, matchedAdrs.length * 15);
  score += Math.min(20, negativeWarnings.length * 10);
  score += Math.min(15, knownBugs.length * 8);
  score += Math.min(15, memoryDetails.activeConstraints.length * 5);

  const riskScore = Math.min(100, Math.max(0, score));
  let risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  if (riskScore >= 80) {
    risk = "CRITICAL";
  } else if (riskScore >= 55) {
    risk = "HIGH";
  } else if (riskScore >= 25) {
    risk = "MEDIUM";
  } else {
    risk = "LOW";
  }

  // 5. Formulate Risk Factors & Recommendations
  const riskFactors: string[] = [];
  const recommendations: string[] = [];

  if (callers.length > 0) {
    riskFactors.push(`${callers.length} external caller(s) depend on this code`);
  }
  if (affectedTests.length > 0) {
    riskFactors.push(`${affectedTests.length} test suite(s) cover this module`);
    recommendations.push(`Run test suites: ${affectedTests.slice(0, 3).join(", ")}`);
  }
  if (matchedAdrs.length > 0) {
    riskFactors.push(`${matchedAdrs.length} living Architecture Decision Record(s) govern this code`);
    for (const adr of matchedAdrs) {
      recommendations.push(`Adhere to ADR '${adr.title}' (${adr.status})`);
    }
  }
  if (negativeWarnings.length > 0) {
    riskFactors.push(`${negativeWarnings.length} negative warning pattern(s) / past bug regression(s) recorded`);
    for (const neg of negativeWarnings) {
      recommendations.push(`Avoid negative pattern: ${neg.title}`);
    }
  }
  if (memoryDetails.activeConstraints.length > 0) {
    riskFactors.push(`${memoryDetails.activeConstraints.length} active project constraint(s) apply`);
    recommendations.push(`Check active constraints in CURRENT.md`);
  }
  if (docDetails.relatedDocs.length > 0) {
    recommendations.push(`Verify documentation alignment: ${docDetails.relatedDocs.join(", ")}`);
  }

  if (recommendations.length === 0) {
    recommendations.push("Standard edits permitted: ensure test coverage is maintained.");
  }

  return {
    target: {
      file: targetFile,
      symbol: targetSymbol,
    },
    risk,
    riskScore,
    riskFactors,
    code: codeDetails,
    memory: memoryDetails,
    docs: docDetails,
    recommendations,
    analyzedAt: new Date().toISOString(),
  };
}

/**
 * Formats a clean, human-readable terminal report for memory & code impact.
 */
export function formatImpactReport(result: MemoryCodeImpactResult): string {
  const symbolStr = result.target.symbol ? ` :: ${result.target.symbol}` : "";
  const header = `\n┌─────────────────────────────────────────────────────────────┐\n│ 💥 UNIFIED CODE & MEMORY IMPACT ANALYSIS                    │\n└─────────────────────────────────────────────────────────────┘\n`;

  const riskColor =
    result.risk === "CRITICAL"
      ? "\x1b[31m"
      : result.risk === "HIGH"
      ? "\x1b[33m"
      : result.risk === "MEDIUM"
      ? "\x1b[36m"
      : "\x1b[32m";

  let out = header;
  out += `\nTarget:      ${result.target.file}${symbolStr}\n`;
  out += `Risk Level:  ${riskColor}[${result.risk}] (Risk Score: ${result.riskScore}/100)\x1b[0m\n`;

  out += `\n📐 CODE IMPACT:\n`;
  out += `  * Direct Callers:      ${result.code.callers.length} (${result.code.callers.slice(0, 5).join(", ") || "none detected"})\n`;
  out += `  * Affected Modules:    ${result.code.affectedModules.length}\n`;
  out += `  * Affected Test Suites:${result.code.affectedTests.length} (${result.code.affectedTests.slice(0, 3).join(", ") || "none"})\n`;
  out += `  * Affected Routes:     ${result.code.affectedRoutes.length}\n`;

  out += `\n🧠 MEMORY & GOVERNANCE IMPACT:\n`;
  out += `  * Linked Memories:     ${result.memory.linkedMemories.length}\n`;
  out += `  * Governing ADRs:      ${result.memory.adrs.length} (${result.memory.adrs.map((a) => a.title).join(", ") || "none"})\n`;
  out += `  * Negative Warnings:   ${result.memory.negativeWarnings.length}\n`;
  out += `  * Known Bug Fixes:     ${result.memory.knownBugs.length}\n`;
  out += `  * Active Constraints:  ${result.memory.activeConstraints.length}\n`;

  out += `\n📑 DOCUMENTATION IMPACT:\n`;
  out += `  * Related Docs:        ${result.docs.totalDocs} (${result.docs.relatedDocs.join(", ") || "none"})\n`;

  if (result.riskFactors.length > 0) {
    out += `\n⚠️ RISK FACTORS:\n`;
    for (const factor of result.riskFactors) {
      out += `  ! ${factor}\n`;
    }
  }

  out += `\n💡 PRE-FLIGHT RECOMMENDATIONS:\n`;
  for (const rec of result.recommendations) {
    out += `  ✓ ${rec}\n`;
  }

  out += `\n`;
  return out;
}
