import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.ts";
import { recordTestFeedback } from "../src/quality/test_feedback.ts";
import {
  analyzeTestFlakiness,
  detectEnvironmentDrift,
  detectFailureBursts,
  detectFlakyTests,
  extractTestRuns,
  type TestRunSignal,
} from "../src/doctor/flaky.ts";

function run(timestamp: string, passed: boolean, failures: string[], command = "bun test"): TestRunSignal {
  return { timestamp, command, passed, failures };
}

describe("T-442: flaky test and environment drift detector", () => {
  test("flags fail → pass → fail as flaky, not a fixed or always-failing test", () => {
    const flaky = detectFlakyTests([
      run("2026-11-01T00:00:00.000Z", false, ["divides"]),
      run("2026-11-01T01:00:00.000Z", true, []),
      run("2026-11-01T02:00:00.000Z", false, ["divides"]),
    ]);
    expect(flaky).toHaveLength(1);
    expect(flaky[0]).toMatchObject({ name: "divides", appearances: 2, episodes: 2, runs: 3 });

    const fixed = detectFlakyTests([
      run("2026-11-01T00:00:00.000Z", false, ["once"]),
      run("2026-11-01T01:00:00.000Z", true, []),
      run("2026-11-01T02:00:00.000Z", true, []),
    ]);
    expect(fixed).toHaveLength(0);

    const broken = detectFlakyTests([
      run("2026-11-01T00:00:00.000Z", false, ["always"]),
      run("2026-11-01T01:00:00.000Z", false, ["always"]),
      run("2026-11-01T02:00:00.000Z", false, ["always"]),
    ]);
    expect(broken).toHaveLength(0);
  });

  test("analyses different commands separately", () => {
    const flaky = detectFlakyTests([
      run("2026-11-01T00:00:00.000Z", false, ["a"], "bun test"),
      run("2026-11-01T01:00:00.000Z", true, [], "bun test"),
      run("2026-11-01T02:00:00.000Z", false, ["a"], "bun test"),
      run("2026-11-01T03:00:00.000Z", true, [], "vitest run"),
    ]);
    expect(flaky.map((entry) => entry.command)).toEqual(["bun test"]);
  });

  test("clusters failing runs into bursts and ignores isolated failures", () => {
    const bursts = detectFailureBursts(
      [
        run("2026-11-01T00:00:00.000Z", false, ["a"]),
        run("2026-11-01T00:10:00.000Z", false, ["b"]),
        run("2026-11-01T00:20:00.000Z", false, ["a"]),
        run("2026-11-01T03:00:00.000Z", false, ["c"]),
      ],
      { gapMinutes: 45, minFailures: 3 },
    );
    expect(bursts).toHaveLength(1);
    expect(bursts[0].failing_runs).toBe(3);
    expect(bursts[0].tests).toEqual(["a", "b"]);
  });

  test("correlates a dependency-file change with a burst", () => {
    const root = mkdtempSync(join(tmpdir(), "muse-flaky-drift-"));
    try {
      const lock = join(root, "bun.lock");
      writeFileSync(lock, "{}");
      const burstStart = Date.parse("2026-11-01T02:00:00.000Z");
      utimesSync(lock, new Date(burstStart - 3_600_000), new Date(burstStart - 3_600_000));

      const drift = detectEnvironmentDrift(
        root,
        [{ start: "2026-11-01T02:00:00.000Z", end: "2026-11-01T02:20:00.000Z", failing_runs: 3, tests: ["a"] }],
        { windowHours: 24 },
      );
      expect(drift).toHaveLength(1);
      expect(drift[0].artifact).toBe("bun.lock");
      expect(drift[0].hours_before_burst).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("extracts recorded runs and reports flakiness end-to-end", () => {
    const root = mkdtempSync(join(tmpdir(), "muse-flaky-integration-"));
    try {
      const store = openStore(root);
      const feedback = (passed: boolean, failures: string[]) =>
        recordTestFeedback(
          store,
          {
            command: "bun test src/math.test.ts",
            exitCode: passed ? 0 : 1,
            stdout: failures.map((name) => `(fail) ${name}`).join("\n"),
          },
          { project: "p" },
        );
      feedback(false, ["divides"]);
      feedback(true, []);
      feedback(false, ["divides"]);

      expect(extractTestRuns(root, { project: "p" })).toHaveLength(3);
      const report = analyzeTestFlakiness(root, { project: "p", root });
      expect(report.runs).toBe(3);
      expect(report.flaky[0].name).toBe("divides");
      expect(report.notice).toContain("Read-only");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
