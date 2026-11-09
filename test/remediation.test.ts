import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.ts";
import { recordTestFeedback } from "../src/quality/test_feedback.ts";
import { recordNegativeLesson } from "../src/learning/index.ts";
import { listPlaybooks } from "../src/cognition/playbooks.ts";
import {
  applyRemediationPlaybooks,
  synthesizeRemediationPlaybooks,
} from "../src/cognition/remediation.ts";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "muse-remediation-"));
}

function record(store: ReturnType<typeof openStore>, passed: boolean, failures: string[]) {
  return recordTestFeedback(
    store,
    {
      command: "bun test src/math.test.ts",
      exitCode: passed ? 0 : 1,
      stdout: failures.map((name) => `(fail) ${name}`).join("\n"),
    },
    { project: "p" },
  );
}

describe("T-443: autonomous remediation playbook generator", () => {
  test("synthesizes a resolved candidate with sentry guidance", () => {
    const root = temp();
    try {
      const store = openStore(root);
      const negative = recordNegativeLesson(store, {
        project: "p",
        title: "DO NOT round currency with Math.round",
        failed_approach: "Math.round on cents",
        failure_reason: "rounding drift",
        alternative_recommended: "Math.trunc after scaling",
        reproduction_command: "bun test src/math.test.ts",
      });
      record(store, false, ["divides"]);
      record(store, false, ["divides"]);
      record(store, true, []);

      const report = synthesizeRemediationPlaybooks(root, store, { project: "p" });
      expect(report.runs).toBe(3);
      const candidate = report.candidates.find((entry) => entry.signature === "divides")!;
      expect(candidate.resolved).toBe(true);
      expect(candidate.occurrences).toBe(2);
      expect(candidate.matched_memory_id).toBe(negative.id);
      expect(candidate.playbook.title).toBe("Remediate: divides");
      expect(candidate.playbook.verification).toEqual(["bun test src/math.test.ts"]);
      expect(candidate.playbook.steps.some((step) => step.action.includes("recommended"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("applies resolved candidates once and deduplicates by title", () => {
    const root = temp();
    try {
      const store = openStore(root);
      record(store, false, ["divides"]);
      record(store, false, ["divides"]);
      record(store, true, []);

      const report = synthesizeRemediationPlaybooks(root, store, { project: "p" });
      const applied = applyRemediationPlaybooks(root, report);
      expect(applied.created).toHaveLength(1);
      expect(listPlaybooks(root).map((playbook) => playbook.title)).toEqual(["Remediate: divides"]);

      const second = applyRemediationPlaybooks(root, synthesizeRemediationPlaybooks(root, store, { project: "p" }));
      expect(second.created).toHaveLength(0);
      expect(second.skipped[0].reason).toBe("already-exists");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("excludes unresolved recurrences unless explicitly included", () => {
    const root = temp();
    try {
      const store = openStore(root);
      record(store, false, ["adds"]);
      record(store, false, ["adds"]);

      const report = synthesizeRemediationPlaybooks(root, store, { project: "p" });
      const candidate = report.candidates.find((entry) => entry.signature === "adds")!;
      expect(candidate.resolved).toBe(false);

      const dry = applyRemediationPlaybooks(root, report);
      expect(dry.created).toHaveLength(0);
      expect(dry.skipped[0].reason).toBe("unresolved");

      const forced = applyRemediationPlaybooks(root, report, { includeUnresolved: true });
      expect(forced.created).toHaveLength(1);
      expect(forced.created[0].tags).toContain("auto-generated");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
