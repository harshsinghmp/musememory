import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { makeTempRoot, cleanup } from "./helpers.ts";
import { join } from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
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

  test("freezeExecutionSnapshot reads task from file if task is a valid filepath", () => {
    const taskFilePath = join(root, "task.md");
    writeFileSync(taskFilePath, "Optimize SQLite memory caching layer", "utf-8");

    const snapshot = freezeExecutionSnapshot({
      workspaceRoot: root,
      memoryDir,
      task: taskFilePath,
      store,
    });

    expect(snapshot.task).toBe("Optimize SQLite memory caching layer");
    expect(snapshot.run_id).toMatch(/^run_/);
  });
});
