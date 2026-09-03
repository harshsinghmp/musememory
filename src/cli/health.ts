import { join } from "node:path";
import { openStore } from "../store.ts";
import { evaluateProjectHealth } from "../health/index.ts";
import { requireRoot, type ParsedArgs } from "./shared.ts";

export async function handleHealthCommand(parsed: ParsedArgs): Promise<number> {
  const ctx = requireRoot(parsed.flags);
  if (!ctx) {
    console.error("Error: Could not resolve project root or initialize .memory directory.");
    return 1;
  }
  const { root, store } = ctx;

  const report = evaluateProjectHealth(store, root);

  if (parsed.flags.json) {
    console.log(JSON.stringify(report, null, 2));
    return report.gate_status === "FAIL" ? 1 : 0;
  }

  const statusColor =
    report.gate_status === "PASS"
      ? "\x1b[32m"
      : report.gate_status === "WARN"
      ? "\x1b[33m"
      : "\x1b[31m";
  const reset = "\x1b[0m";
  const bold = "\x1b[1m";

  console.log(`\n${bold}🏥 MUSE MEMORY 5-PILLAR PROJECT HEALTH GATE${reset}`);
  console.log(`${"=".repeat(50)}`);
  console.log(`Project:       ${bold}${report.project}${reset}`);
  console.log(`Overall Grade: ${bold}${report.overall_grade}${reset} (${report.overall_score}/100)`);
  console.log(`Gate Status:   ${statusColor}${bold}${report.gate_status}${reset}\n`);

  console.log(`${bold}PILLAR BREAKDOWN:${reset}`);
  const pillars = [
    report.pillars.store_integrity,
    report.pillars.code_anchors,
    report.pillars.doc_code_alignment,
    report.pillars.negative_anti_patterns,
    report.pillars.technical_debt,
  ];

  for (let i = 0; i < pillars.length; i++) {
    const p = pillars[i];
    const pColor = p.status === "PASS" ? "\x1b[32m" : p.status === "WARN" ? "\x1b[33m" : "\x1b[31m";
    const num = i + 1;
    const namePadded = p.name.padEnd(36, " ");
    console.log(`  ${num}. ${namePadded} [${bold}${p.grade}${reset}] ${String(p.score).padStart(3, " ")}/100 (${pColor}${p.status}${reset})`);
  }

  console.log(`\n${bold}Summary:${reset}\n  ${report.summary}`);

  if (report.actionable_checklist.length > 0) {
    console.log(`\n${bold}Actionable Remediation Checklist:${reset}`);
    for (const item of report.actionable_checklist) {
      console.log(`  • ${item}`);
    }
  } else {
    console.log(`\n${bold}Actionable Remediation Checklist:${reset}\n  ✅ Zero remediation needed — repository meets highest hardening standards.`);
  }

  console.log("");
  return report.gate_status === "FAIL" ? 1 : 0;
}

export async function handleReconcileCommand(parsed: ParsedArgs): Promise<number> {
  const ctx = requireRoot(parsed.flags);
  if (!ctx) {
    console.error("Error: Could not resolve project root or initialize .memory directory.");
    return 1;
  }
  const { root, store } = ctx;

  const prune = parsed.flags["prune"] === "true" || parsed.flags["p"] === "true";
  const markStale = parsed.flags["mark-stale"] === "true" || parsed.flags["stale"] === "true";
  const updateHashes = parsed.flags["update-hashes"] === "true";
  const dryRun = parsed.flags["dry-run"] === "true" || (!prune && !markStale && !updateHashes);

  const { reconcileCodeAnchors, formatReconcileReport } = await import("../health/index.ts");
  const report = await reconcileCodeAnchors(store, {
    prune,
    markStale,
    updateHashes,
    dryRun,
    workspaceRoot: root,
  });

  if (parsed.flags.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  console.log(formatReconcileReport(report, dryRun));
  return 0;
}

export async function handleBenchmarkCommand(parsed: ParsedArgs): Promise<number> {
  const ctx = requireRoot(parsed.flags);
  if (!ctx) {
    console.error("Error: Could not resolve project root or initialize .memory directory.");
    return 1;
  }
  const { root, store } = ctx;

  const iterations = parsed.flags["iterations"] ? parseInt(parsed.flags["iterations"], 10) : 30;
  const query = parsed.positional[0] || (parsed.flags["query"] as string);
  const tokenBudget = parsed.flags["budget"] ? parseInt(parsed.flags["budget"], 10) : undefined;

  const { runMemoryBenchmark, formatBenchmarkScoreboard } = await import("../benchmark/index.ts");
  const report = await runMemoryBenchmark(store, {
    iterations,
    query,
    tokenBudget,
    workspaceRoot: root,
  });

  if (parsed.flags.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  console.log(formatBenchmarkScoreboard(report));
  return 0;
}

export async function handleCodeImpactCommand(parsed: ParsedArgs): Promise<number> {
  const ctx = requireRoot(parsed.flags);
  if (!ctx) {
    console.error("Error: Could not resolve project root or initialize .memory directory.");
    return 1;
  }
  const { root, store } = ctx;

  const filePath = parsed.positional[0];
  if (!filePath) {
    console.error("Usage: memory code-impact <file> [--symbol <name>] [--json]");
    return 1;
  }
  const symbolName = parsed.flags["symbol"] as string | undefined;

  const { analyzeMemoryCodeImpact, formatImpactReport } = await import("../intelligence/index.ts");
  const result = await analyzeMemoryCodeImpact(store, {
    filePath,
    symbolName,
    workspaceRoot: root,
  });

  if (parsed.flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.risk === "CRITICAL" ? 1 : 0;
  }

  console.log(formatImpactReport(result));
  return result.risk === "CRITICAL" ? 1 : 0;
}

export async function handlePrContextCommand(parsed: ParsedArgs): Promise<number> {
  const ctx = requireRoot(parsed.flags);
  if (!ctx) {
    console.error("Error: Could not resolve project root or initialize .memory directory.");
    return 1;
  }
  const { root, store } = ctx;

  const baseBranch = parsed.positional[0] || (parsed.flags["base"] as string) || "main";
  const { generatePrContext } = await import("../compaction/index.ts");
  const result = await generatePrContext(store, {
    baseBranch,
    workspaceRoot: root,
  });

  const outFile = parsed.flags["out"] as string | undefined;
  if (outFile) {
    const { writeFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    writeFileSync(resolve(root, outFile), result.bodyMarkdown, "utf8");
    console.log(`[+] Wrote PR context description to ${outFile}`);
    return 0;
  }

  if (parsed.flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  console.log(`\nPR Title: ${result.title}\n`);
  console.log(result.bodyMarkdown);
  return 0;
}
