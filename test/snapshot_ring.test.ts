import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { captureSnapshotRing, listSnapshotRing, restoreSnapshotRing } from "../src/snapshot.ts";

const TEST_DIR = join(import.meta.dir, ".tmp_snapshot_test");

describe("Pre-Mutation Snapshot Ring Buffer (T-177)", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(join(TEST_DIR, "CURRENT.md"), "Initial Content v1\n", "utf8");
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("captures snapshot to .memory/snapshots/ with timestamp", () => {
    const res = captureSnapshotRing("current", TEST_DIR);
    expect(existsSync(res.snapshotPath)).toBe(true);
    expect(res.target).toBe("current");
  });

  it("rotates ring buffer to max 30 snapshots", () => {
    for (let i = 0; i < 35; i++) {
      writeFileSync(join(TEST_DIR, "CURRENT.md"), `Content iteration ${i}\n`, "utf8");
      captureSnapshotRing("current", TEST_DIR, 30);
    }

    const snapshots = listSnapshotRing("current", TEST_DIR);
    expect(snapshots.length).toBe(30);
  });

  it("restores snapshot accurately", () => {
    const firstCapture = captureSnapshotRing("current", TEST_DIR);
    const snapName = firstCapture.snapshotName;

    writeFileSync(join(TEST_DIR, "CURRENT.md"), "Corrupted Content v2\n", "utf8");
    expect(readFileSync(join(TEST_DIR, "CURRENT.md"), "utf8")).toBe("Corrupted Content v2\n");

    restoreSnapshotRing(snapName, TEST_DIR);
    expect(readFileSync(join(TEST_DIR, "CURRENT.md"), "utf8")).toBe("Initial Content v1\n");
  });
});
