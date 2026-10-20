import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, list } from "../src/store.ts";
import {
  computeFactDigest,
  loadDigestDedupStore,
  saveDigestDedupStore,
  isFactDigestRecorded,
  recordFactDigest,
  digestDedupFilePath,
} from "../src/compaction/dedup.ts";
import { harvestSessionMemories } from "../src/compaction/harvester.ts";
import { extractInvariantsPreCompress } from "../src/compaction/engine.ts";

describe("Wave 4 - Task 3: Persisted Digest Deduplication Set (T-046)", () => {
  let testDir: string;
  let memoryDir: string;
  let store: ReturnType<typeof openStore>;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "musememory-wave4-dedup-test-"));
    memoryDir = join(testDir, ".memory");
    store = openStore(memoryDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("computeFactDigest normalizes whitespace and casing deterministically", () => {
    const text1 = "Never commit raw credentials to git repository";
    const text2 = "  never  commit raw  credentials to GIT repository\n";
    expect(computeFactDigest(text1)).toBe(computeFactDigest(text2));
  });

  test("recordFactDigest persists hash to disk and isFactDigestRecorded retrieves it", () => {
    const filePath = digestDedupFilePath(memoryDir);
    expect(existsSync(filePath)).toBe(false);

    const fact = "Use SQLite WAL mode with busy_timeout 5000ms";
    recordFactDigest(memoryDir, fact, "mem_123", "decision");

    expect(existsSync(filePath)).toBe(true);
    expect(isFactDigestRecorded(memoryDir, fact)).toBe(true);
    expect(isFactDigestRecorded(memoryDir, "Different fact")).toBe(false);

    const loaded = loadDigestDedupStore(memoryDir);
    expect(loaded.version).toBe(1);
    const hash = computeFactDigest(fact);
    expect(loaded.hashes[hash]).toBeDefined();
    expect(loaded.hashes[hash].memory_id).toBe("mem_123");
  });

  test("harvestSessionMemories skips duplicate facts on repeated runs", () => {
    const transcript = [
      "Decision: Chose fast-glob over globby for faster filesystem scans",
      "Constraint: Must always run typecheck before building dist bundle",
      "Avoid: Do not use synchronous child_process execSync in event loop",
    ].join("\n");

    // First harvest run
    const firstRun = harvestSessionMemories(store, transcript, { project: "core" });
    expect(firstRun.length).toBe(3);

    // Second harvest run on identical transcript
    const secondRun = harvestSessionMemories(store, transcript, { project: "core" });
    expect(secondRun.length).toBe(0); // All 3 skipped due to persisted digest-dedup set!
  });

  test("extractInvariantsPreCompress skips duplicate decisions and constraints", () => {
    const invariants = {
      highLevelGoal: "Build dedup",
      currentArchitecture: "SQLite",
      completedTasks: ["Task 1"],
      openTasks: [],
      nextConcreteTask: "Task 2",
      decisionsMade: ["Chose SHA-256 for content hashing"],
      activeConstraints: ["Zero secret exposure"],
    };

    const run1 = extractInvariantsPreCompress(invariants, store, { project: "core" });
    expect(run1.length).toBe(2);

    const run2 = extractInvariantsPreCompress(invariants, store, { project: "core" });
    expect(run2.length).toBe(0); // Skipped because digests are already in dedup store!
  });
});
