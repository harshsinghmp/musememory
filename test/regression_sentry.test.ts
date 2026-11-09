import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, list } from "../src/store.ts";
import { recordNegativeLesson } from "../src/learning/index.ts";
import { runRegressionSentry } from "../src/cognition/sentry.ts";
import { getAuditTrail } from "../src/audit.ts";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "muse-sentry-"));
}

describe("T-441: negative anti-pattern regression sentry", () => {
  test("matches a failing test to a DO_NOT_USE memory and builds a playbook", () => {
    const root = temp();
    try {
      const store = openStore(root);
      const negative = recordNegativeLesson(store, {
        project: "p",
        title: "DO NOT round currency with Math.round",
        failed_approach: "Math.round on integer cents",
        failure_reason: "banker's rounding drift in totals",
        alternative_recommended: "Math.trunc after scaling",
        reproduction_command: "bun test src/math.test.ts",
        severity: "high",
      });

      const report = runRegressionSentry(
        store,
        [{ name: "divides", message: "error: mismatch in src/math.ts" }],
        { project: "p", command: "bun test src/math.test.ts" },
      );

      expect(report.checked_negatives).toBe(1);
      expect(report.matched).toHaveLength(1);
      expect(report.matched[0].memory_id).toBe(negative.id);
      expect(report.matched[0].kind).toBe("DO_NOT_USE");
      expect(report.matched[0].severity).toBe("high");
      expect(report.matched[0].reproduction_command).toBe("bun test src/math.test.ts");
      expect(report.matched[0].recommendation).toContain("Math.trunc");

      const playbook = report.playbooks.find((entry) => entry.memory_id === negative.id)!;
      expect(playbook.steps.some((step) => step.startsWith("Reproduce:"))).toBe(true);
      expect(playbook.steps.some((step) => step.startsWith("Avoid:"))).toBe(true);
      expect(playbook.steps.some((step) => step.startsWith("Use instead:"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("leaves unrelated failures unmatched and never mutates the store", () => {
    const root = temp();
    try {
      const store = openStore(root);
      recordNegativeLesson(store, {
        project: "p",
        title: "BUG_PRONE: retrying without a cap",
        failed_approach: "unbounded retry loop",
        failure_reason: "hangs the worker",
        reproduction_command: "bun test src/retry.test.ts",
        severity: "medium",
      });
      const before = JSON.stringify(list(store).map((entry) => ({ id: entry.id, updated_at: entry.updated_at })));
      const auditBefore = getAuditTrail(root).length;

      const report = runRegressionSentry(
        store,
        [{ name: "renders the empty state" }],
        { project: "p", command: "bun test src/ui.test.ts" },
      );

      expect(report.matched).toHaveLength(0);
      expect(report.unmatched).toEqual(["renders the empty state"]);
      expect(report.playbooks).toHaveLength(0);
      expect(report.notice).toContain("read-only");

      const after = JSON.stringify(list(store).map((entry) => ({ id: entry.id, updated_at: entry.updated_at })));
      expect(after).toBe(before);
      expect(getAuditTrail(root).length).toBe(auditBefore);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("classifies BUG_PRONE_PATTERN and caps matches", () => {
    const root = temp();
    try {
      const store = openStore(root);
      recordNegativeLesson(store, {
        project: "p",
        title: "BUG_PRONE: unguarded JSON.parse",
        failed_approach: "JSON.parse on untrusted input",
        failure_reason: "throws on malformed payload",
        reproduction_command: "bun test src/parse.test.ts",
      });

      const report = runRegressionSentry(
        store,
        [
          { name: "parse payload", message: "SyntaxError in src/parse.test.ts" },
          { name: "parse payload again", message: "SyntaxError in src/parse.test.ts" },
        ],
        { project: "p", command: "bun test src/parse.test.ts", limit: 1 },
      );
      expect(report.matched.length).toBe(1);
      expect(report.matched[0].kind).toBe("BUG_PRONE_PATTERN");
      expect(report.playbooks).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
