import type { Store } from "../store.ts";
import { extractTestRuns, type TestRunSignal } from "../doctor/flaky.ts";
import { runRegressionSentry } from "./sentry.ts";
import { listPlaybooks, savePlaybook, type Playbook, type PlaybookInput, type PlaybookStep } from "./playbooks.ts";

export interface RemediationCandidate {
  signature: string;
  command: string;
  occurrences: number;
  episodes: number;
  last_failed_at: string;
  /** A green run of the same command exists after the last failure. */
  resolved: boolean;
  matched_memory_id?: string;
  match_kind?: string;
  playbook: PlaybookInput;
}

export interface RemediationReport {
  runs: number;
  candidates: RemediationCandidate[];
  existing_titles: string[];
  notice: string;
}

export interface RemediationOptions {
  project?: string;
  /** Minimum recorded failures before a signature is considered recurring (default 2). */
  minRecurrences?: number;
  limit?: number;
}

function groupByCommand(runs: TestRunSignal[]): Map<string, TestRunSignal[]> {
  const groups = new Map<string, TestRunSignal[]>();
  for (const run of runs) {
    const key = run.command || "(unknown)";
    const list = groups.get(key);
    if (list) list.push(run);
    else groups.set(key, [run]);
  }
  return groups;
}

function buildPlaybook(
  name: string,
  command: string,
  occurrences: number,
  match: ReturnType<typeof runRegressionSentry>["matched"][number] | undefined,
): PlaybookInput {
  const reproduce = match?.reproduction_command ?? (command || "test");
  const steps: PlaybookStep[] = [
    { action: "Reproduce the failure", command: reproduce },
  ];
  if (match) {
    steps.push({
      action: "Re-read the governing negative memory",
      description: `${match.memory_id}: ${match.title}`,
    });
    if (match.recommendation) {
      steps.push({ action: "Apply the recommended alternative", description: match.recommendation });
    }
    steps.push({ action: "Avoid the recorded anti-pattern", description: `See ${match.memory_id}` });
  } else {
    steps.push({
      action: "Inspect the latest failure output",
      description: "No negative memory matched; capture the root cause with memory_negative_capture after fixing it.",
    });
  }
  steps.push({ action: "Re-run the failing check", command: reproduce });

  const tags = ["remediation", "auto-generated", "test-failure"];
  if (match) tags.push(match.kind.toLowerCase());

  return {
    title: `Remediate: ${name}`,
    goal: `Stop the recurring failure "${name}" and prove it with a green run.`,
    steps,
    preconditions: [
      `"${name}" has failed in ${occurrences} recorded run(s)`,
      "A reproduction command is available",
    ],
    verification: [reproduce],
    rollback: ["Revert the fix if the verification still fails"],
    tags,
  };
}

/**
 * Read-only: turn recurring recorded failures into playbook candidates. A
 * candidate is `resolved` when a green run of the same command follows its
 * last failure; only those are persisted by `applyRemediationPlaybooks`
 * unless the caller explicitly includes unresolved ones.
 */
export function synthesizeRemediationPlaybooks(
  memoryDir: string,
  store: Store,
  options: RemediationOptions = {},
): RemediationReport {
  const runs = extractTestRuns(memoryDir, { project: options.project, limit: options.limit });
  const minRecurrences = Math.max(2, options.minRecurrences ?? 2);
  const existingTitles = listPlaybooks(memoryDir).map((playbook) => playbook.title);
  const candidates: RemediationCandidate[] = [];

  for (const [command, series] of groupByCommand(runs)) {
    const names = new Set(series.flatMap((run) => run.failures));
    for (const name of names) {
      let occurrences = 0;
      let episodes = 0;
      let inEpisode = false;
      let lastFailedAt = "";
      let lastFailureIndex = -1;
      series.forEach((run, index) => {
        const present = run.failures.includes(name);
        if (!present) {
          inEpisode = false;
          return;
        }
        occurrences++;
        if (!inEpisode) episodes++;
        inEpisode = true;
        lastFailedAt = run.timestamp;
        lastFailureIndex = index;
      });
      if (occurrences < minRecurrences) continue;

      const resolved = series.slice(lastFailureIndex + 1).some((run) => run.passed);
      const sentry = runRegressionSentry(store, [{ name }], {
        project: options.project,
        command,
        limit: 3,
      });
      const match = sentry.matched[0];
      candidates.push({
        signature: name,
        command,
        occurrences,
        episodes,
        last_failed_at: lastFailedAt,
        resolved,
        matched_memory_id: match?.memory_id,
        match_kind: match?.kind,
        playbook: buildPlaybook(name, command, occurrences, match),
      });
    }
  }

  candidates.sort((a, b) => b.occurrences - a.occurrences || b.episodes - a.episodes);

  return {
    runs: runs.length,
    candidates,
    existing_titles: existingTitles,
    notice:
      "Read-only: candidates are derived from recurring test_feedback failures. Persist with applyRemediationPlaybooks (resolved signatures only by default).",
  };
}

export interface ApplyRemediationOptions {
  includeUnresolved?: boolean;
}

export interface ApplyRemediationResult {
  created: Playbook[];
  skipped: Array<{ signature: string; reason: "unresolved" | "already-exists" }>;
}

/** Persist selected candidates as playbooks. Deduplicates by title. */
export function applyRemediationPlaybooks(
  memoryDir: string,
  report: RemediationReport,
  options: ApplyRemediationOptions = {},
): ApplyRemediationResult {
  const existing = new Set([...report.existing_titles, ...listPlaybooks(memoryDir).map((playbook) => playbook.title)]);
  const created: Playbook[] = [];
  const skipped: ApplyRemediationResult["skipped"] = [];

  for (const candidate of report.candidates) {
    if (!candidate.resolved && !options.includeUnresolved) {
      skipped.push({ signature: candidate.signature, reason: "unresolved" });
      continue;
    }
    if (existing.has(candidate.playbook.title)) {
      skipped.push({ signature: candidate.signature, reason: "already-exists" });
      continue;
    }
    const playbook = savePlaybook(memoryDir, candidate.playbook);
    existing.add(playbook.title);
    created.push(playbook);
  }

  return { created, skipped };
}
