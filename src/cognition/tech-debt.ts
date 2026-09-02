import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Store } from "../store.ts";
import { list } from "../store.ts";
import { verifyCodeAnchor } from "../anchors/resolver.ts";
import type { TechnicalDebtReport, DebtItem } from "./types.ts";

function scanFiles(dir: string, maxFiles: number = 50): string[] {
  const files: string[] = [];

  function walk(currentDir: string) {
    if (files.length >= maxFiles) return;
    if (!existsSync(currentDir)) return;

    const entries = readdirSync(currentDir);
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (entry === "node_modules" || entry === ".git" || entry === ".memory" || entry === "dist") {
        continue;
      }

      const full = join(currentDir, entry);
      const stat = statSync(full);

      if (stat.isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".ts") || entry.endsWith(".js")) {
        if (!entry.endsWith(".test.ts") && !entry.endsWith(".spec.ts")) {
          files.push(full);
        }
      }
    }
  }

  walk(dir);
  return files;
}

/**
 * Scans the workspace and memory store for technical debt indicators:
 * TODO/FIXME/HACK comments, dangerous type casts ('as any'), and drifted code anchors.
 */
export function analyzeTechnicalDebt(
  store: Store,
  workspaceRoot: string
): TechnicalDebtReport {
  const items: DebtItem[] = [];
  const hotspotMap = new Map<string, number>();

  // 1. Source Code Scanning
  const sourceFiles = scanFiles(workspaceRoot, 40);

  for (const file of sourceFiles) {
    const rel = relative(workspaceRoot, file);
    const content = readFileSync(file, "utf8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Check for TODO / FIXME / HACK / WORKAROUND
      const todoMatch = line.match(/\/\/\s*(TODO|FIXME|HACK|WORKAROUND)\b:?(.*)/i);
      if (todoMatch) {
        const tag = todoMatch[1].toUpperCase();
        const desc = todoMatch[2].trim() || `Unresolved ${tag}`;
        const severity = tag === "FIXME" || tag === "HACK" ? "high" : tag === "WORKAROUND" ? "medium" : "low";

        items.push({
          id: `debt_code_${rel}_${lineNum}`,
          file_path: rel,
          line_number: lineNum,
          type: "todo_fixme",
          snippet: line.trim(),
          description: `[${tag}] ${desc}`,
          severity,
          remediation_proposal: `Address marked ${tag} debt or convert to formal issue / ADR`,
        });

        hotspotMap.set(rel, (hotspotMap.get(rel) || 0) + 1);
      }

      // Check for 'as any' casting
      if (/\bas\s+any\b/.test(line) && !line.trim().startsWith("//")) {
        items.push({
          id: `debt_cast_${rel}_${lineNum}`,
          file_path: rel,
          line_number: lineNum,
          type: "type_assertion",
          snippet: line.trim(),
          description: "Unsafe 'as any' type assertion bypasses static type checker",
          severity: "medium",
          remediation_proposal: "Replace 'as any' with narrow discriminating union or typed generic parameter",
        });

        hotspotMap.set(rel, (hotspotMap.get(rel) || 0) + 1);
      }
    }
  }

  // 2. Memory Store Drifted Anchors as Architectural Debt
  const allEntries = list(store);
  for (const entry of allEntries) {
    if (entry.status === "archived" || entry.status === "superseded") continue;

    if (entry.anchors) {
      for (const anc of entry.anchors) {
        const verification = verifyCodeAnchor(workspaceRoot, anc);
        if (verification.status === "drifted") {
          items.push({
            id: `debt_drift_${entry.id}_${anc.id}`,
            file_path: anc.file_path,
            type: "drifted_anchor",
            snippet: anc.signature || anc.symbol_name || anc.file_path,
            description: `Drifted architectural contract on memory '${entry.title}'`,
            severity: "high",
            remediation_proposal: "Synchronize memory definition with live implementation or refactor drifted code",
          });

          hotspotMap.set(anc.file_path, (hotspotMap.get(anc.file_path) || 0) + 1);
        }
      }
    }
  }

  // 3. Score Calculation
  let totalPoints = 0;
  for (const item of items) {
    if (item.severity === "high") totalPoints += 15;
    else if (item.severity === "medium") totalPoints += 7;
    else totalPoints += 3;
  }

  const debtScore = Math.min(100, totalPoints);

  // 4. Hotspots
  const hotspotFiles = Array.from(hotspotMap.entries())
    .map(([file_path, debt_count]) => ({ file_path, debt_count }))
    .sort((a, b) => b.debt_count - a.debt_count)
    .slice(0, 10);

  // 5. Refactoring Recommendations
  const recommendations: string[] = [];
  if (hotspotFiles.length > 0) {
    recommendations.push(
      `Prioritize refactoring top hotspot '${hotspotFiles[0].file_path}' (${hotspotFiles[0].debt_count} debt items)`
    );
  }

  const highSeverityCount = items.filter((i) => i.severity === "high").length;
  if (highSeverityCount > 0) {
    recommendations.push(`Resolve ${highSeverityCount} high-severity FIXME/HACK comments and drifted code anchors`);
  }

  const typeAssertionCount = items.filter((i) => i.type === "type_assertion").length;
  if (typeAssertionCount > 0) {
    recommendations.push(`Eliminate ${typeAssertionCount} unsafe 'as any' casts to restore compile-time verification`);
  }

  return {
    total_debt_items: items.length,
    debt_score: debtScore,
    hotspot_files: hotspotFiles,
    items,
    refactoring_recommendations: recommendations,
  };
}
