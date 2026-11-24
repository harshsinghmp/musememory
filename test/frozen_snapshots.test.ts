import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { makeTempRoot, cleanup } from "./helpers.ts";
import { join, relative } from "node:path";
import { mkdirSync, writeFileSync, existsSync, symlinkSync } from "node:fs";
import { openStore, propose, confirm } from "../src/store.ts";
import {
  freezeExecutionSnapshot,
  loadExecutionSnapshot,
  listExecutionSnapshots,
} from "../src/snapshot.ts";
import type { Store } from "../src/store.ts";

describe("Deliverable 3: Frozen Execution Snapshots & Hash Delimiters", () => {
  let root: string;
  let memoryDir: string;
  let store: Store;

  beforeEach(() => {
    root = makeTempRoot();
    memoryDir = join(root, ".memory");
    mkdirSync(memoryDir, { recursive: true });
    store = openStore(memoryDir);

    writeFileSync(join(memoryDir, "CURRENT.md"), "# Constraints\n- Strict TDD\n- Zero deps", "utf-8");
    writeFileSync(join(root, "file1.ts"), "export const x = 1;", "utf-8");

    const m1 = propose(store, {
      title: "Snapshot Architecture",
      content: "Snapshots capture sha-256 hashes of all memories",
      project: "core",
      type: "architecture",
    });
    confirm(store, m1.id);
  });

  afterEach(() => {
    cleanup(root);
  });

  test("freezeExecutionSnapshot creates .memory/runs/<run-id>/snapshot.json with sha256 hashes", () => {
    const runId = "run_test_001";
    const snapshot = freezeExecutionSnapshot({
      workspaceRoot: root,
      memoryDir,
      task: "Implement Deliverable 3",
      runId,
      store,
    });

    expect(snapshot.run_id).toBe(runId);
    expect(snapshot.task).toBe("Implement Deliverable 3");
    expect(snapshot.timestamp).toBeDefined();
    expect(snapshot.constraints).toContain("Strict TDD");
    expect(snapshot.memory_hashes.length).toBeGreaterThan(0);
    expect(snapshot.memory_hashes[0].hash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.file_inventory.length).toBeGreaterThan(0);

    const snapshotPath = join(memoryDir, "runs", runId, "snapshot.json");
    expect(existsSync(snapshotPath)).toBe(true);

    const loaded = loadExecutionSnapshot(memoryDir, runId);
    expect(loaded?.run_id).toBe(runId);
    expect(loaded?.task).toBe("Implement Deliverable 3");

    const list = listExecutionSnapshots(memoryDir);
    expect(list.length).toBe(1);
    expect(list[0].run_id).toBe(runId);
  });

  // Issue #451: `task` used to be probed with `existsSync()` and read when it
  // happened to name a file, so the "task description" parameter was really an
  // arbitrary file read whose contents were persisted into the snapshot.
  test("stores a path-shaped task as a literal instruction and never reads the file (issue #451)", () => {
    const literal = "/etc/passwd";

    const snapshot = freezeExecutionSnapshot({
      workspaceRoot: root,
      memoryDir,
      task: literal,
      runId: "run_literal_path",
      store,
    });

    expect(snapshot.task).toBe(literal);
    expect(snapshot.task).not.toContain("root:");
    // The persisted copy says the same thing as the returned one.
    expect(loadExecutionSnapshot(memoryDir, "run_literal_path")?.task).toBe(literal);

    // A file that *does* exist inside the workspace is still not read implicitly.
    const taskFilePath = join(root, "task.md");
    writeFileSync(taskFilePath, "Optimize SQLite memory caching layer", "utf-8");

    const inRoot = freezeExecutionSnapshot({
      workspaceRoot: root,
      memoryDir,
      task: taskFilePath,
      runId: "run_literal_in_root",
      store,
    });

    expect(inRoot.task).toBe(taskFilePath);
    expect(inRoot.task).not.toContain("Optimize SQLite memory caching layer");
  });

  test("task_file rejects paths outside the workspace root (issue #451)", () => {
    const siblingRoot = makeTempRoot();
    const outsidePath = join(siblingRoot, "outside-task.md");
    writeFileSync(outsidePath, "should never enter a snapshot", "utf-8");

    try {
      // 1. Lexical traversal.
      expect(() =>
        freezeExecutionSnapshot({
          workspaceRoot: root,
          memoryDir,
          task: "Release",
          taskFile: relative(root, outsidePath),
          store,
        }),
      ).toThrow(/escapes base/);

      // 2. An absolute path is rejected outright by resolveWithin.
      expect(() =>
        freezeExecutionSnapshot({
          workspaceRoot: root,
          memoryDir,
          task: "Release",
          taskFile: outsidePath,
          store,
        }),
      ).toThrow(/must be relative to the base/);

      // 3. A symlink inside the workspace that points outside it is rejected
      //    on the *real* path, since resolveWithin is lexical only.
      const linkPath = join(root, "task-link.md");
      symlinkSync(outsidePath, linkPath);
      expect(() =>
        freezeExecutionSnapshot({
          workspaceRoot: root,
          memoryDir,
          task: "Release",
          taskFile: "task-link.md",
          store,
        }),
      ).toThrow(/resolves outside the workspace/);

      // 4. A missing file fails closed instead of freezing a path as the task.
      expect(() =>
        freezeExecutionSnapshot({ workspaceRoot: root, memoryDir, task: "Release", taskFile: "nope.md", store }),
      ).toThrow(/task_file not found/);

      // 5. Only regular files are readable as briefs.
      mkdirSync(join(root, "task-dir"));
      expect(() =>
        freezeExecutionSnapshot({ workspaceRoot: root, memoryDir, task: "Release", taskFile: "task-dir", store }),
      ).toThrow(/not a regular file/);
    } finally {
      cleanup(siblingRoot);
    }
  });

  test("task_file reads an in-root brief but redacts secrets before they enter the snapshot (issue #451)", () => {
    // Composed at runtime so this file does not itself contain a token-shaped literal.
    const fakeKey = "sk-ant-" + "x".repeat(24);
    writeFileSync(join(root, "task.md"), `Deploy the service\napi_key = ${fakeKey}\nRoll back on 5xx\n`, "utf-8");

    const snapshot = freezeExecutionSnapshot({
      workspaceRoot: root,
      memoryDir,
      task: "Release 4.0",
      taskFile: "task.md",
      runId: "run_task_file",
      store,
    });

    expect(snapshot.task).toContain("Deploy the service");
    expect(snapshot.task).toContain("Roll back on 5xx");
    expect(snapshot.task).not.toContain(fakeKey);
    expect(snapshot.task).toContain("[REDACTED_SECRET]");
    expect(snapshot.metadata?.task_file).toBe("task.md");
    expect(snapshot.metadata?.task_file_redacted).toBe(true);
    expect(snapshot.metadata?.task_file_truncated).toBe(false);
    // The caller-supplied label is preserved rather than silently dropped.
    expect(snapshot.metadata?.task_label).toBe("Release 4.0");

    const loaded = loadExecutionSnapshot(memoryDir, "run_task_file");
    expect(loaded?.task).not.toContain(fakeKey);
    expect(loaded?.task).toBe(snapshot.task);
  });

  test("task_file reads are capped at 64 KiB (issue #451)", () => {
    writeFileSync(join(root, "big-task.md"), "a".repeat(70 * 1024), "utf-8");

    const snapshot = freezeExecutionSnapshot({
      workspaceRoot: root,
      memoryDir,
      task: "Big brief",
      taskFile: "big-task.md",
      runId: "run_task_file_capped",
      store,
    });

    expect(snapshot.task.length).toBe(64 * 1024);
    expect(snapshot.metadata?.task_file_truncated).toBe(true);
  });
});
