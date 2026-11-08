import { describe, test, expect } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatPlaybook,
  getPlaybook,
  listPlaybooks,
  loadPlaybooks,
  recordPlaybookOutcome,
  savePlaybook,
} from "../src/cognition/playbooks.ts";

function dir(): string {
  return mkdtempSync(join(tmpdir(), "muse-playbook-"));
}

describe("T-427: procedural playbook engine", () => {
  test("saves, upserts, lists and formats a verified trajectory", () => {
    const memoryDir = dir();
    try {
      const first = savePlaybook(memoryDir, {
        title: "Fix flaky test",
        goal: "Make the failing test deterministic",
        steps: [{ action: "Reproduce the failure", command: "bun test test/x.test.ts" }, { action: "Fix the race" }],
        preconditions: ["Test fails locally"],
        verification: ["bun test exits 0"],
        rollback: ["git checkout -- src/x.ts"],
        tags: ["test", "race"],
      });
      expect(first.id).toStartWith("pb_");
      expect(listPlaybooks(memoryDir).length).toBe(1);
      expect(listPlaybooks(memoryDir, "race").length).toBe(1);

      const updated = savePlaybook(memoryDir, {
        title: "Fix flaky test",
        goal: "Make the failing test deterministic",
        steps: [{ action: "Reproduce" }, { action: "Fix" }, { action: "Verify" }],
      });
      expect(updated.id).toBe(first.id);
      expect(loadPlaybooks(memoryDir).length).toBe(1);
      expect(updated.steps.length).toBe(3);
      expect(updated.successCount).toBe(0);

      const formatted = formatPlaybook(updated);
      expect(formatted).toContain("# Fix flaky test");
      expect(formatted).toContain("## Verification");
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });

  test("records outcomes and tolerates a corrupt file", () => {
    const memoryDir = dir();
    try {
      const playbook = savePlaybook(memoryDir, { title: "Deploy", goal: "ship", steps: [{ action: "build" }] });
      const success = recordPlaybookOutcome(memoryDir, playbook.id, true);
      expect(success?.successCount).toBe(1);
      const failure = recordPlaybookOutcome(memoryDir, playbook.title, false);
      expect(failure?.failureCount).toBe(1);
      expect(getPlaybook(memoryDir, playbook.title)?.successCount).toBe(1);

      writeFileSync(join(memoryDir, "playbooks.json"), "{not json", "utf8");
      expect(loadPlaybooks(memoryDir)).toEqual([]);
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });

  test("rejects empty titles and step lists", () => {
    const memoryDir = dir();
    try {
      expect(() => savePlaybook(memoryDir, { title: "", goal: "x", steps: [{ action: "a" }] })).toThrow();
      expect(() => savePlaybook(memoryDir, { title: "x", goal: "x", steps: [] })).toThrow();
      expect(existsSync(join(memoryDir, "playbooks.json"))).toBe(false);
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });
});
