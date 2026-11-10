import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, save, get } from "../src/store.ts";
import { detectTestHarness, parseTestRun, recordTestFeedback } from "../src/quality/test_feedback.ts";
import { getAuditTrail } from "../src/audit.ts";
import type { Store } from "../src/store.ts";
import type { MemoryEntry } from "../src/types.ts";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "muse-test-feedback-"));
}

function seededMemory(store: Store, content: string): MemoryEntry {
  const entry = propose(store, { content, project: "p", type: "fix", confirmed: true });
  save(store, {
    ...get(store, entry.id)!,
    anchors: [{ id: "a1", kind: "file", file_path: "src/math.ts" }],
    test_command: "bun test src/math.test.ts",
  });
  return get(store, entry.id)!;
}

describe("T-440: test-harness feedback", () => {
  test("detects the runner from the command", () => {
    expect(detectTestHarness("bun test")).toBe("bun");
    expect(detectTestHarness("bunx vitest run")).toBe("vitest");
    expect(detectTestHarness("npx jest --ci")).toBe("jest");
    expect(detectTestHarness("cargo test --all")).toBe("cargo");
    expect(detectTestHarness("pytest -q")).toBe("pytest");
    expect(detectTestHarness("go test ./...")).toBe("go");
    expect(detectTestHarness("make check")).toBe("unknown");
  });

  test("parses bun output including failure names and counts", () => {
    const run = parseTestRun({
      command: "bun test",
      exitCode: 1,
      stdout: ["(pass) adds", "(fail) divides [1.2ms]", "error: expected 2 to be 3", "", " 1 pass", " 1 fail"].join("\n"),
    });
    expect(run.harness).toBe("bun");
    expect(run.passed).toBe(false);
    expect(run.passed_count).toBe(1);
    expect(run.failed_count).toBe(1);
    expect(run.failures[0]).toEqual({ name: "divides", message: "error: expected 2 to be 3" });
  });

  test("parses vitest, cargo and pytest summaries", () => {
    const vitest = parseTestRun({
      command: "bunx vitest run",
      exitCode: 1,
      stdout: [" ✓ math.test.ts > adds", " × math.test.ts > divides (3 ms)", "      Tests  1 failed | 1 passed (2)"].join("\n"),
    });
    expect(vitest.harness).toBe("vitest");
    expect(vitest.passed_count).toBe(1);
    expect(vitest.failed_count).toBe(1);
    expect(vitest.failures[0].name).toBe("math.test.ts > divides");

    const cargo = parseTestRun({
      command: "cargo test",
      exitCode: 101,
      stdout: ["test math::adds ... ok", "test math::divides ... FAILED", "test result: FAILED. 2 passed; 1 failed; 0 ignored"].join("\n"),
    });
    expect(cargo.passed_count).toBe(2);
    expect(cargo.failed_count).toBe(1);
    expect(cargo.failures[0].name).toBe("math::divides");

    const pytest = parseTestRun({
      command: "pytest -q",
      exitCode: 1,
      stdout: ["FAILED test_math.py::test_divide - ZeroDivisionError", "1 failed, 1 passed in 0.01s"].join("\n"),
    });
    expect(pytest.failures[0]).toEqual({ name: "test_math.py::test_divide", message: "ZeroDivisionError" });
    expect(pytest.passed_count).toBe(1);
  });

  test("exit code is authoritative and a silent failure still yields a target", () => {
    const run = parseTestRun({ command: "bun test", exitCode: 1, stdout: "" });
    expect(run.passed).toBe(false);
    expect(run.failures).toEqual([{ name: "bun test", message: undefined }]);

    const green = parseTestRun({ command: "bun test", exitCode: 0, stdout: " 3 pass\n 0 fail" });
    expect(green.passed).toBe(true);
    expect(green.failed_count).toBe(0);
  });

  test("green runs reinforce applied memories", () => {
    const root = temp();
    try {
      const store = openStore(root);
      const memory = seededMemory(store, "rounding must use truncation");
      const result = recordTestFeedback(
        store,
        { command: "bun test", exitCode: 0, stdout: " 4 pass\n 0 fail" },
        { memoryIds: [memory.id], project: "p", sessionId: "s1" },
      );
      expect(result.updated).toHaveLength(1);
      expect(result.updated[0].success).toBe(true);
      expect(result.updated[0].regression).toBe(false);

      const after = get(store, memory.id)!;
      expect(after.utility?.application_count).toBe(1);
      expect(after.utility?.successful_applications).toBe(1);
      expect(after.reinforcement ?? 0).toBeGreaterThan(0);
      expect(getAuditTrail(root, { operation: "test_feedback" })).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a red run marks a regression only for anchor-relevant memories", () => {
    const root = temp();
    try {
      const store = openStore(root);
      const memory = seededMemory(store, "rounding must use truncation");
      const unrelated = propose(store, { content: "network retries need jitter", project: "p", type: "fix", confirmed: true });

      const result = recordTestFeedback(
        store,
        {
          command: "bun test src/math.test.ts",
          exitCode: 1,
          stdout: ["(fail) divides", "error: expected 2 to be 3", "", " 1 pass", " 1 fail"].join("\n"),
        },
        { memoryIds: [memory.id, unrelated.id, "m_missing"], project: "p", sessionId: "s2" },
      );

      const relevant = result.updated.find((entry) => entry.id === memory.id)!;
      const other = result.updated.find((entry) => entry.id === unrelated.id)!;
      expect(relevant.regression).toBe(true);
      expect(other.regression).toBe(false);
      expect(result.skipped).toEqual(["m_missing"]);

      const after = get(store, memory.id)!;
      expect(after.utility?.failed_applications).toBe(1);
      expect(after.utility?.regressions).toBe(1);
      expect(after.utility?.regression_strikes).toBe(1);
      expect(get(store, unrelated.id)!.utility?.failed_applications).toBe(1);
      expect(get(store, unrelated.id)!.utility?.regressions).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
