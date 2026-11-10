import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAuditTrail } from "../audit.ts";

/** One recorded test run, reconstructed from the audit ledger. */
export interface TestRunSignal {
  timestamp: string;
  command: string;
  passed: boolean;
  failures: string[];
}

export interface FlakyTest {
  name: string;
  command: string;
  runs: number;
  appearances: number;
  /** Contiguous failure blocks; two or more means the failure recurred. */
  episodes: number;
  first_failed_at: string;
  last_failed_at: string;
}

export interface FailureBurst {
  start: string;
  end: string;
  failing_runs: number;
  tests: string[];
}

export interface EnvironmentChange {
  artifact: string;
  changed_at: string;
  hours_before_burst: number;
  burst_start: string;
}

export interface FlakyReport {
  runs: number;
  flaky: FlakyTest[];
  bursts: FailureBurst[];
  drift: EnvironmentChange[];
  notice: string;
}

const DEPENDENCY_ARTIFACTS = [
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "Cargo.lock",
  "go.sum",
  "requirements.txt",
  "pyproject.toml",
  "package.json",
];

/** Reconstruct test runs (oldest first) from `test_feedback` audit events. */
export function extractTestRuns(
  memoryDir: string,
  options: { project?: string; limit?: number } = {},
): TestRunSignal[] {
  const events = getAuditTrail(memoryDir, {
    operation: "test_feedback",
    limit: options.limit,
  });
  const runs: TestRunSignal[] = [];
  for (const event of events) {
    if (options.project && event.project !== options.project) continue;
    const details = event.details ?? {};
    runs.push({
      timestamp: event.timestamp,
      command: typeof event.reason === "string" && event.reason ? event.reason : "(unknown)",
      passed: details.passed === true || details.exit_code === 0,
      failures: Array.isArray(details.failures) ? details.failures.map(String) : [],
    });
  }
  return runs.reverse();
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

/**
 * A test is flaky when it fails, passes, and fails again for the same command
 * and its failures fall into two or more contiguous episodes. A test that
 * appears in every run is broken, not flaky; one that failed once and then
 * passed is fixed.
 */
export function detectFlakyTests(runs: TestRunSignal[]): FlakyTest[] {
  const flaky: FlakyTest[] = [];
  for (const [command, series] of groupByCommand(runs)) {
    if (series.length < 3) continue;
    const names = new Set(series.flatMap((run) => run.failures));
    for (const name of names) {
      let appearances = 0;
      let episodes = 0;
      let inEpisode = false;
      let firstFailedAt = "";
      let lastFailedAt = "";
      for (const run of series) {
        const present = run.failures.includes(name);
        if (present) {
          appearances++;
          if (!inEpisode) episodes++;
          inEpisode = true;
          if (!firstFailedAt) firstFailedAt = run.timestamp;
          lastFailedAt = run.timestamp;
        } else {
          inEpisode = false;
        }
      }
      if (appearances < 2 || appearances >= series.length || episodes < 2) continue;
      flaky.push({
        name,
        command,
        runs: series.length,
        appearances,
        episodes,
        first_failed_at: firstFailedAt,
        last_failed_at: lastFailedAt,
      });
    }
  }
  return flaky.sort((a, b) => b.episodes - a.episodes || b.appearances - a.appearances);
}

/** Cluster failing runs separated by at most `gapMinutes` into bursts. */
export function detectFailureBursts(
  runs: TestRunSignal[],
  options: { gapMinutes?: number; minFailures?: number } = {},
): FailureBurst[] {
  const gapMs = (options.gapMinutes ?? 45) * 60_000;
  const minFailures = options.minFailures ?? 3;
  const failing = runs
    .filter((run) => !run.passed || run.failures.length > 0)
    .map((run) => ({ ...run, at: Date.parse(run.timestamp) }))
    .filter((run) => Number.isFinite(run.at))
    .sort((a, b) => a.at - b.at);

  const bursts: FailureBurst[] = [];
  let cluster: typeof failing = [];

  const flush = () => {
    if (cluster.length >= minFailures) {
      bursts.push({
        start: new Date(cluster[0].at).toISOString(),
        end: new Date(cluster[cluster.length - 1].at).toISOString(),
        failing_runs: cluster.length,
        tests: Array.from(new Set(cluster.flatMap((run) => run.failures))).slice(0, 20),
      });
    }
    cluster = [];
  };

  for (const run of failing) {
    if (cluster.length === 0 || run.at - cluster[cluster.length - 1].at <= gapMs) {
      cluster.push(run);
    } else {
      flush();
      cluster.push(run);
    }
  }
  flush();
  return bursts;
}

/** Lockfile/manifest changes shortly before a failure burst. */
export function detectEnvironmentDrift(
  root: string,
  bursts: FailureBurst[],
  options: { windowHours?: number } = {},
): EnvironmentChange[] {
  if (bursts.length === 0) return [];
  const windowMs = (options.windowHours ?? 24) * 3_600_000;
  const changes: EnvironmentChange[] = [];
  for (const artifact of DEPENDENCY_ARTIFACTS) {
    const path = join(root, artifact);
    if (!existsSync(path)) continue;
    let changedMs: number;
    try {
      changedMs = statSync(path).mtimeMs;
    } catch {
      continue;
    }
    let best: { burst: FailureBurst; hours: number } | undefined;
    for (const burst of bursts) {
      const startMs = Date.parse(burst.start);
      if (!Number.isFinite(startMs)) continue;
      const delta = startMs - changedMs;
      if (delta < 0 || delta > windowMs) continue;
      const hours = Math.round((delta / 3_600_000) * 10) / 10;
      if (!best || hours < best.hours) best = { burst, hours };
    }
    if (best) {
      changes.push({
        artifact,
        changed_at: new Date(changedMs).toISOString(),
        hours_before_burst: best.hours,
        burst_start: best.burst.start,
      });
    }
  }
  return changes.sort((a, b) => a.hours_before_burst - b.hours_before_burst);
}

export interface FlakyAnalysisOptions {
  project?: string;
  /** Workspace root used for lockfile mtimes. Defaults to the parent of `.memory`. */
  root?: string;
  windowHours?: number;
  gapMinutes?: number;
  minFailures?: number;
  limit?: number;
}

/**
 * Read-only flakiness report. Tests absent from a run are treated as passing
 * for that command; runs with different commands are analysed separately so a
 * scoped `bun test <file>` does not look like a pass for the full suite.
 */
export function analyzeTestFlakiness(memoryDir: string, options: FlakyAnalysisOptions = {}): FlakyReport {
  const runs = extractTestRuns(memoryDir, { project: options.project, limit: options.limit });
  const bursts = detectFailureBursts(runs, {
    gapMinutes: options.gapMinutes,
    minFailures: options.minFailures,
  });
  const root = options.root ?? dirname(memoryDir);
  const drift = detectEnvironmentDrift(root, bursts, { windowHours: options.windowHours });
  return {
    runs: runs.length,
    flaky: detectFlakyTests(runs),
    bursts,
    drift,
    notice:
      "Read-only heuristic from test_feedback audit events and dependency-file mtimes; absence from a run is treated as a pass for that command.",
  };
}
