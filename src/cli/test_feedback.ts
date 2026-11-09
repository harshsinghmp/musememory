import { readFileSync } from "node:fs";
import { requireRoot, usageError } from "./shared.ts";
import type { ParsedArgs } from "./shared.ts";
import { parseTestRun, recordTestFeedback } from "../quality/test_feedback.ts";
import { runRegressionSentry } from "../cognition/sentry.ts";

function readLogs(flags: Record<string, string>): string {
  const input = flags["input"];
  if (!input) return "";
  if (input === "-") return readFileSync(0, "utf8");
  return readFileSync(input, "utf8");
}

function parseExitCode(flags: Record<string, string>): number | null {
  const raw = flags["exit-code"];
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isInteger(value) ? value : null;
}

function readMemoryIds(flags: Record<string, string>): string[] {
  return (flags["memory"] ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export async function handleTestFeedbackCommand({ flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;

  const command = flags["command"];
  const exitCode = parseExitCode(flags);
  if (!command) return usageError("test-feedback requires --command \"<test command>\"");
  if (exitCode === null) return usageError("test-feedback requires --exit-code <n> (the real process exit code)");

  let logs: string;
  try {
    logs = readLogs(flags);
  } catch (err) {
    return usageError(`cannot read --input: ${err instanceof Error ? err.message : String(err)}`);
  }

  const project = flags["project"];
  const feedback = recordTestFeedback(
    ctx.store,
    { command, exitCode, stdout: logs },
    { project, memoryIds: readMemoryIds(flags), actor: "cli", sessionId: flags["session"] },
  );
  const sentry = runRegressionSentry(ctx.store, feedback.run.failures, { project, command });

  if (flags["json"] !== undefined) {
    console.log(JSON.stringify({ run: feedback.run, feedback, sentry }, null, 2));
    return 0;
  }

  const run = feedback.run;
  console.log(`test run: ${run.command} (${run.harness}) exit ${run.exit_code} — ${run.passed_count} passed, ${run.failed_count} failed`);
  console.log(`linked memories: ${feedback.updated.length} updated, ${feedback.skipped.length} skipped`);
  for (const entry of feedback.updated) {
    const outcome = entry.success ? "reinforced" : entry.regression ? "REGRESSION" : "failed application";
    const rate = entry.reuse_success_rate !== undefined ? ` rate ${entry.reuse_success_rate.toFixed(2)}` : "";
    console.log(`  ${entry.id} ${entry.status} ${outcome}${rate}`);
  }

  console.log(`sentry: ${sentry.matched.length} match(es), ${sentry.unmatched.length} unmatched failure(s)`);
  for (const match of sentry.matched) {
    const severity = match.severity ? `/${match.severity}` : "";
    console.log(`  [${match.kind}${severity}] ${match.title}`);
    console.log(`    failure: ${match.failure}`);
    console.log(`    why: ${match.reason}${match.reproduction_command ? ` · reproduce: ${match.reproduction_command}` : ""}`);
  }
  return 0;
}

export async function handleSentryCommand({ flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;

  const command = flags["command"] ?? "test";
  const exitCode = parseExitCode(flags) ?? 0;

  let logs: string;
  try {
    logs = readLogs(flags);
  } catch (err) {
    return usageError(`cannot read --input: ${err instanceof Error ? err.message : String(err)}`);
  }

  const run = parseTestRun({ command, exitCode, stdout: logs });
  const report = runRegressionSentry(ctx.store, run.failures, { project: flags["project"], command });

  if (flags["json"] !== undefined) {
    console.log(JSON.stringify({ run, sentry: report }, null, 2));
    return 0;
  }

  console.log(`sentry: ${report.matched.length} match(es), ${report.unmatched.length} unmatched failure(s) among ${report.checked_negatives} negative memories`);
  for (const match of report.matched) {
    console.log(`  [${match.kind}] ${match.title} <- ${match.failure} (${match.reason})`);
  }
  for (const playbook of report.playbooks) {
    console.log(`  playbook: ${playbook.title}`);
    for (const step of playbook.steps) console.log(`    - ${step}`);
  }
  console.log(report.notice);
  return 0;
}
