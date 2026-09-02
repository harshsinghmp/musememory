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
