import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Store } from "../store.ts";
import { listForProject } from "../store.ts";
import { verifyCodeAnchor } from "../anchors/resolver.ts";
import type { DriftReport, DriftItem, DriftState } from "./types.ts";

/**
 * Recursively discovers TypeScript and JavaScript source files within workspace.
 */
function findSourceFiles(dir: string, maxFiles: number = 50): string[] {
  const files: string[] = [];

  function scan(currentDir: string) {
    if (files.length >= maxFiles) return;
    if (!existsSync(currentDir)) return;

    const entries = readdirSync(currentDir);
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (entry === "node_modules" || entry === ".git" || entry === ".memory" || entry === "dist") {
        continue;
      }

      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath, { throwIfNoEntry: false });
      if (!stat) continue;

      if (stat.isDirectory()) {
        scan(fullPath);
      } else if (entry.endsWith(".ts") || entry.endsWith(".js")) {
        if (!entry.endsWith(".test.ts") && !entry.endsWith(".spec.ts")) {
          files.push(fullPath);
        }
      }
    }
  }

  scan(dir);
  return files;
}

/**
 * Extracts exported symbol names from a TypeScript/JavaScript file.
 */
function extractExportedSymbols(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf8");
  const symbols: string[] = [];

  const exportRegex = /export\s+(?:async\s+)?(?:function|class|interface|type|const)\s+([a-zA-Z0-9_$]+)/g;
  let match: RegExpExecArray | null;

  while ((match = exportRegex.exec(content)) !== null) {
    symbols.push(match[1]);
  }

  return symbols;
}

/**
 * Bidirectional documentation <-> code drift engine.
 * Classifies items into:
 * DOCUMENTED | IMPLEMENTED | PARTIAL | CONFLICTING | STALE | MISSING
 */
export function detectDocumentationCodeDrift(
  store: Store,
  workspaceRoot: string,
  options?: { project?: string },
): DriftReport {
  const allEntries = listForProject(store, options?.project);
  const items: DriftItem[] = [];

  let documentedCount = 0;
  let implementedCount = 0;
  let partialCount = 0;
  let conflictingCount = 0;
  let staleCount = 0;
  let missingCount = 0;

  const documentedSymbols = new Set<string>();
  const documentedFiles = new Set<string>();

  // 1. DOCS / ADRs -> CODE VERIFICATION
  for (const entry of allEntries) {
    if (entry.status === "archived" || entry.status === "superseded") continue;

    // Check code anchors
    if (entry.anchors && entry.anchors.length > 0) {
      for (const anc of entry.anchors) {
        if (anc.symbol_name) documentedSymbols.add(anc.symbol_name.toLowerCase());
        if (anc.file_path) documentedFiles.add(anc.file_path.toLowerCase());

        const verification = verifyCodeAnchor(workspaceRoot, anc);
        let state: DriftState = "IMPLEMENTED";
        let remediation = "Documentation matches code implementation";

        if (verification.status === "orphaned") {
          state = "STALE";
          remediation = `Documentation reference '${anc.file_path}${anc.symbol_name ? `#${anc.symbol_name}` : ""}' was deleted or renamed in code. Update or archive this memory.`;
          staleCount++;
        } else if (verification.status === "drifted") {
          const isConflicted = entry.status === "conflicted" || entry.tags?.includes("conflict");
          state = isConflicted ? "CONFLICTING" : "PARTIAL";
          remediation = isConflicted
            ? `Code implementation directly contradicts documentation for symbol '${anc.symbol_name}'. Resolve contradiction via memory_conflict_resolve.`
            : `Code signature or body drifted from documented hash for symbol '${anc.symbol_name}'. Verify implementation alignment.`;
          if (isConflicted) conflictingCount++;
          else partialCount++;
        } else {
          state = entry.type === "adr" ? "IMPLEMENTED" : "DOCUMENTED";
          if (state === "IMPLEMENTED") implementedCount++;
          else documentedCount++;
        }

        items.push({
          id: `${entry.id}_${anc.id}`,
          source: entry.type === "adr" ? "adr" : "doc",
          title: entry.title,
          drift_state: state,
          claimed_symbol: anc.symbol_name,
          claimed_path: anc.file_path,
          evidence: verification.drift_details,
          remediation_suggestion: remediation,
        });
      }
    }
  }

  // 2. CODE -> DOCS VERIFICATION (Detecting missing documentation for major exports)
  const sourceFiles = findSourceFiles(workspaceRoot, 30);

  // Precompute lowercased corpus of active memories once to avoid O(exports * memories) scan
  const activeEntriesCorpus = allEntries
    .filter((e) => e.status !== "archived")
    .map((e) => `${e.title}\n${e.content}`.toLowerCase())
    .join("\n\n");

  for (const srcFile of sourceFiles) {
    const relPath = relative(workspaceRoot, srcFile);
    const exports = extractExportedSymbols(srcFile);

    for (const sym of exports) {
      const symLower = sym.toLowerCase();
      const isDocumented =
        documentedSymbols.has(symLower) ||
        activeEntriesCorpus.includes(symLower);

      if (!isDocumented) {
        missingCount++;
        items.push({
          id: `code_${relPath}_${sym}`,
          source: "code",
          title: `Exported symbol '${sym}' in '${relPath}'`,
          drift_state: "MISSING",
          claimed_symbol: sym,
          claimed_path: relPath,
          evidence: `Export '${sym}' found in source code with zero memory or ADR documentation`,
          remediation_suggestion: `Capture architectural decision or convention documenting '${sym}' using memory_capture or memory_adr_record`,
        });
      }
    }
  }

  const total = items.length;
  const aligned = documentedCount + implementedCount;
  const alignmentScore = total > 0 ? Number((aligned / total).toFixed(2)) : 1.0;

  const report: DriftReport = {
    total_items: total,
    documented_count: documentedCount,
    implemented_count: implementedCount,
    partial_count: partialCount,
    conflicting_count: conflictingCount,
    stale_count: staleCount,
    missing_count: missingCount,
    alignment_score: alignmentScore,
    items,
  };

  return report;
}
