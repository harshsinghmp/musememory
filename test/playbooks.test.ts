import { describe, test, expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

      const second = savePlaybook(memoryDir, {
        title: "Fix flaky test",
        goal: "A distinct same-titled playbook",
        steps: [{ action: "other" }],
      });
      expect(second.id).not.toBe(first.id);
      expect(loadPlaybooks(memoryDir).length).toBe(2);

      const updated = savePlaybook(memoryDir, {
        id: first.id,
        title: "Fix flaky test",
        goal: "Make the failing test deterministic",
        steps: [{ action: "Reproduce" }, { action: "Fix" }, { action: "Verify" }],
      });
      expect(updated.id).toBe(first.id);
      expect(updated.steps.length).toBe(3);
      expect(updated.successCount).toBe(0);

      const formatted = formatPlaybook(updated);
      expect(formatted).toContain("# Fix flaky test");
      expect(formatted).toContain("## Verification");
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });

  test("records outcomes and fails loud on a corrupt file", () => {
    const memoryDir = dir();
    try {
      const playbook = savePlaybook(memoryDir, { title: "Deploy", goal: "ship", steps: [{ action: "build" }] });
      const success = recordPlaybookOutcome(memoryDir, playbook.id, true);
      expect(success?.successCount).toBe(1);
      const failure = recordPlaybookOutcome(memoryDir, playbook.title, false);
      expect(failure?.failureCount).toBe(1);
      expect(getPlaybook(memoryDir, playbook.title)?.successCount).toBe(1);

      writeFileSync(join(memoryDir, "playbooks.json"), "{not json", "utf8");
      expect(() => loadPlaybooks(memoryDir)).toThrow(/not valid JSON/);
      expect(() => savePlaybook(memoryDir, { title: "x", goal: "y", steps: [{ action: "z" }] })).toThrow(/not valid JSON/);
      expect(readFileSync(join(memoryDir, "playbooks.json"), "utf8")).toBe("{not json");
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });

  test("rejects empty titles and step lists", () => {
    const memoryDir = dir();
    try {
      expect(() => savePlaybook(memoryDir, { title: "", goal: "x", steps: [{ action: "a" }] })).toThrow();
      expect(() => savePlaybook(memoryDir, { title: "x", goal: "x", steps: [] })).toThrow();
      expect(() => savePlaybook(memoryDir, { title: "x", goal: "x", steps: [{} as any] })).toThrow(/step 1/);
      expect(() => savePlaybook(memoryDir, { title: "x", goal: "", steps: [{ action: "a" }] })).toThrow(/goal/);
      expect(existsSync(join(memoryDir, "playbooks.json"))).toBe(false);
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });

  // D5: a fixed `${path}.tmp` name means two writers — the MCP server and a
  // CLI invocation sharing one memory dir — stage to the SAME temp file, so
  // one clobbers the other before either rename and an update is lost.
  test("a save does not clobber an unrelated staged temp file", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-playbook-race-"));
    try {
      // Writer A holds a staged body at the legacy shared path.
      const legacyTmp = join(memoryDir, "playbooks.json.tmp");
      const staged = JSON.stringify([{ id: "A", title: "A" }]);
      writeFileSync(legacyTmp, staged, "utf8");

      savePlaybook(memoryDir, { title: "B", goal: "b", steps: [{ action: "x" }] } as any);

      // A's staged bytes survive untouched: the writer used a unique temp
      // name, so it never wrote through this path.
      expect(readFileSync(legacyTmp, "utf8")).toBe(staged);
      // B's own write landed intact.
      expect(loadPlaybooks(memoryDir).map((p) => p.title)).toEqual(["B"]);
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });

  // D5: the read-modify-write cycle is only racy ACROSS processes — within
  // one process the path is synchronous, so an in-process promise race can
  // never interleave. This is the shape the bug actually took: the MCP
  // server and a CLI invocation sharing one memory dir.
  test("concurrent processes all persist their playbook", async () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-playbook-proc-"));
    try {
      const script = `import { savePlaybook } from ${JSON.stringify(join(import.meta.dir, "..", "src", "cognition", "playbooks.ts"))};
savePlaybook(process.argv[1], { title: process.argv[2], goal: "g", steps: [{ action: "s" }] });`;
      const writers = 6;
      const procs = Array.from({ length: writers }, (_, i) =>
        Bun.spawn(["bun", "-e", script, memoryDir, `P${i}`], { stdout: "pipe", stderr: "pipe" }),
      );
      const codes = await Promise.all(procs.map((p) => p.exited));

      expect(codes.every((c) => c === 0)).toBe(true);
      // Without the lock the writers all read the same empty list and the
      // last rename wins, so persisted < writers.
      expect(loadPlaybooks(memoryDir).length).toBe(writers);
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  }, 30000);
});
