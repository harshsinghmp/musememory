import type { Store } from "../store.ts";
import { get } from "../store.ts";
import { recordAuditEvent } from "../audit.ts";
import { recordApplicationOutcome } from "./utility.ts";
import { isMemoryRelevantToFailure } from "../learning/feedback.ts";

/** Test runners whose output shapes have a parser here. */
export type TestHarness = "bun" | "vitest" | "jest" | "cargo" | "pytest" | "go" | "unknown";

export interface TestFailure {
  name: string;
  message?: string;
  file?: string;
}

export interface TestRunResult {
  harness: TestHarness;
  command: string;
  exit_code: number;
  /** Exit code is authoritative: 0 means green even when output was truncated. */
  passed: boolean;
  total: number;
  passed_count: number;
  failed_count: number;
  failures: TestFailure[];
}

export interface TestRunInput {
  command: string;
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

/** Detect the runner from the command, most specific pattern first. */
export function detectTestHarness(command: string): TestHarness {
  const c = command.trim();
  if (!c) return "unknown";
  if (/\bvitest\b/i.test(c)) return "vitest";
  if (/\bjest\b/i.test(c)) return "jest";
  if (/\bcargo\s+test\b/i.test(c)) return "cargo";
  if (/\b(?:pytest|py\.test)\b/i.test(c)) return "pytest";
  if (/\bgo\s+test\b/i.test(c)) return "go";
  if (/\bbun(?:x)?\s+test\b/i.test(c)) return "bun";
  return "unknown";
}

function cleanName(name: string): string {
  return name
    .trim()
    .replace(/\s+\[[\d.]+\s*m?s\]$/, "")
    .replace(/\s+\(\d+\s*m?s\)$/, "")
    .trim();
}

function nearbyMessage(lines: string[], index: number): string | undefined {
  for (let i = index + 1; i < Math.min(lines.length, index + 7); i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/error:|AssertionError|Expected:|Received:|TypeError|panic:/i.test(line)) {
      return line.slice(0, 300);
    }
  }
  return undefined;
}

function firstErrorLine(text: string): string | undefined {
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/error:|AssertionError|Expected:|Received:|TypeError|panic:|FAILED/i.test(line)) {
      return line.slice(0, 300);
    }
  }
  return undefined;
}

interface ParsedCounts {
  passed_count: number;
  failed_count: number;
  failures: TestFailure[];
}

function result(passed: number, failed: number, failures: TestFailure[]): ParsedCounts {
  return { passed_count: passed, failed_count: failed, failures };
}

function parseBun(text: string): ParsedCounts {
  const lines = text.split("\n");
  const failures: TestFailure[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*\(fail\)\s+(.+?)\s*$/.exec(lines[i]);
    if (match) failures.push({ name: cleanName(match[1]), message: nearbyMessage(lines, i) });
  }
  const pass = /^\s*(\d+)\s+pass\s*$/m.exec(text);
  const fail = /^\s*(\d+)\s+fail\s*$/m.exec(text);
  return result(pass ? Number(pass[1]) : 0, fail ? Number(fail[1]) : failures.length, failures);
}

function parseVitest(text: string): ParsedCounts {
  const lines = text.split("\n");
  const failures: TestFailure[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*(?:×|✗)\s+(.+?)\s*$/.exec(lines[i]);
    if (match) failures.push({ name: cleanName(match[1]), message: nearbyMessage(lines, i) });
  }
  const counts = /Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed/.exec(text);
  const failed = counts?.[1] ? Number(counts[1]) : failures.length;
  const passed = counts?.[2] ? Number(counts[2]) : 0;
  return result(passed, failed, failures);
}

function parseJest(text: string): ParsedCounts {
  const lines = text.split("\n");
  const failures: TestFailure[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*(?:×|✕|✗)\s+(.+?)\s*$/.exec(lines[i]);
    if (match) failures.push({ name: cleanName(match[1]), message: nearbyMessage(lines, i) });
  }
  const counts = /Tests:\s+(?:(\d+)\s+failed,\s*)?(\d+)\s+passed(?:,\s*(\d+)\s+total)?/.exec(text);
  const failed = counts?.[1] ? Number(counts[1]) : failures.length;
  const passed = counts?.[2] ? Number(counts[2]) : 0;
  return result(passed, failed, failures);
}

function parseCargo(text: string): ParsedCounts {
  const failures: TestFailure[] = [];
  for (const match of text.matchAll(/^test\s+(.+?)\s+\.\.\.\s+FAILED\s*$/gm)) {
    failures.push({ name: cleanName(match[1]) });
  }
  const counts = /test result: (?:ok|FAILED)\.\s+(\d+) passed;\s+(\d+) failed/.exec(text);
  return result(counts ? Number(counts[1]) : 0, counts ? Number(counts[2]) : failures.length, failures);
}

function parsePytest(text: string): ParsedCounts {
  const failures: TestFailure[] = [];
  for (const match of text.matchAll(/^FAILED\s+(\S+?)(?:\s+-\s+(.+))?$/gm)) {
    failures.push({ name: cleanName(match[1]), message: match[2]?.trim() });
  }
  const failedFirst = /(\d+) failed,\s*(\d+) passed/.exec(text);
  const passedFirst = /(\d+) passed,\s*(\d+) failed/.exec(text);
  const failed = failedFirst ? Number(failedFirst[1]) : passedFirst ? Number(passedFirst[2]) : failures.length;
  const passed = failedFirst ? Number(failedFirst[2]) : passedFirst ? Number(passedFirst[1]) : 0;
  return result(passed, failed, failures);
}

function parseGo(text: string): ParsedCounts {
  const failures: TestFailure[] = [];
  for (const match of text.matchAll(/^--- FAIL:\s+(\S+)/gm)) failures.push({ name: cleanName(match[1]) });
  const passed = [...text.matchAll(/^--- PASS:\s+(\S+)/gm)].length;
  return result(passed, failures.length, failures);
}

function parseUnknown(text: string): ParsedCounts {
  const failures: TestFailure[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*(?:FAIL|✗|×)\s+(.+?)\s*$/.exec(lines[i]);
    if (match) failures.push({ name: cleanName(match[1]), message: nearbyMessage(lines, i) });
  }
  return result(0, failures.length, failures);
}

function parseHarness(harness: TestHarness, text: string): ParsedCounts {
  switch (harness) {
    case "bun":
      return parseBun(text);
    case "vitest":
      return parseVitest(text);
    case "jest":
      return parseJest(text);
    case "cargo":
      return parseCargo(text);
    case "pytest":
      return parsePytest(text);
    case "go":
      return parseGo(text);
    default:
      return parseUnknown(text);
  }
}

/**
 * Parse a runner's output into a structured result. Counts are best-effort;
 * the exit code decides pass/fail, and a failing run with no parsable failure
 * line still yields one synthetic failure so downstream matching has a target.
 */
export function parseTestRun(input: TestRunInput): TestRunResult {
  const command = input.command ?? "";
  const harness = detectTestHarness(command);
  const text = [input.stdout, input.stderr].filter(Boolean).join("\n");
  const parsed = parseHarness(harness, text);
  const passed = input.exitCode === 0;

  let failures = parsed.failures;
  if (!passed && failures.length === 0) {
    failures = [{ name: command || "test run", message: firstErrorLine(text) }];
  }
  const failed_count = Math.max(parsed.failed_count, failures.length);
  const passed_count = parsed.passed_count;
  return {
    harness,
    command,
    exit_code: input.exitCode,
    passed,
    total: passed_count + failed_count,
    passed_count,
    failed_count,
    failures,
  };
}

export interface TestFeedbackOptions {
  project?: string;
  memoryIds?: string[];
  actor?: string;
  sessionId?: string;
  now?: number;
}

export interface TestFeedbackUpdate {
  id: string;
  title: string;
  status: string;
  success: boolean;
  regression: boolean;
  reuse_success_rate?: number;
}

export interface TestFeedbackResult {
  run: TestRunResult;
  updated: TestFeedbackUpdate[];
  skipped: string[];
}

/**
 * Bind a real test run to the memories that were applied. Green runs reinforce
 * every linked memory; a red run records a failed application and marks a
 * regression only for memories whose anchors/symbols/reproduction command
 * correlate with the failure output (the T-313 relevance rule).
 */
export function recordTestFeedback(
  store: Store,
  input: TestRunInput,
  options: TestFeedbackOptions = {},
): TestFeedbackResult {
  const run = parseTestRun(input);
  const ids = Array.from(new Set(options.memoryIds ?? [])).slice(0, 200);
  const failureLog = run.failures.map((failure) => `${failure.name} ${failure.message ?? ""}`).join("\n");
  const updated: TestFeedbackUpdate[] = [];
  const skipped: string[] = [];

  for (const id of ids) {
    const entry = get(store, id);
    if (!entry) {
      skipped.push(id);
      continue;
    }
    const regression = !run.passed && isMemoryRelevantToFailure(entry, {
      command: run.command,
      logs: failureLog,
      exitCode: run.exit_code,
      project: options.project,
    });
    const next = recordApplicationOutcome(store, {
      memoryId: id,
      success: run.passed,
      regression,
      notes: `Test run (${run.harness}) ${run.passed_count}/${run.total}: ${run.command}`,
      actor: options.actor ?? "test_feedback",
      sessionId: options.sessionId,
      now: options.now,
    });
    updated.push({
      id: next.id,
      title: next.title,
      status: next.status,
      success: run.passed,
      regression,
      reuse_success_rate: next.utility?.reuse_success_rate,
    });
  }

  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "test_feedback",
      entry_id: "test-run",
      project: options.project,
      actor: options.actor ?? "test_feedback",
      reason: run.command,
      details: {
        harness: run.harness,
        exit_code: run.exit_code,
        passed: run.passed,
        passed_count: run.passed_count,
        failed_count: run.failed_count,
        failures: run.failures.map((failure) => failure.name).slice(0, 20),
        updated: updated.map((entry) => entry.id),
        skipped,
      },
    });
  }

  return { run, updated, skipped };
}
