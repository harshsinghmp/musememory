import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, list } from "../src/store.ts";
import {
  generateSessionHandoff,
  validateCompactionInvariants,
  extractInvariantsPreCompress,
  type CompactionInvariants,
} from "../src/compaction/index.ts";

describe("Wave 4 - Task 2: Compaction Checkpoint Invariants & Extraction Hooks", () => {
  let testDir: string;
  let memoryDir: string;
  let store: ReturnType<typeof openStore>;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "musememory-wave4-compaction-test-"));
    memoryDir = join(testDir, ".memory");
    store = openStore(memoryDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("T-047: Never-empty checkpoint contract", () => {
    test("rejects handoff if highLevelGoal is blank", () => {
      const invalid: CompactionInvariants = {
        highLevelGoal: "   ",
        currentArchitecture: "SQLite WAL",
        completedTasks: ["Task 1"],
        openTasks: [],
        nextConcreteTask: "Task 2",
      };

      expect(() => validateCompactionInvariants(invalid)).toThrow(
        /Compaction checkpoint violation: highLevelGoal must not be empty/,
      );
      expect(() => generateSessionHandoff(memoryDir, invalid)).toThrow(/Compaction checkpoint violation/);
    });

    test("rejects handoff if currentArchitecture is blank", () => {
      const invalid: CompactionInvariants = {
        highLevelGoal: "Build engine",
        currentArchitecture: "",
        completedTasks: ["Task 1"],
        openTasks: [],
        nextConcreteTask: "Task 2",
      };

      expect(() => validateCompactionInvariants(invalid)).toThrow(
        /Compaction checkpoint violation: currentArchitecture must not be empty/,
      );
    });

    test("rejects handoff if nextConcreteTask is blank", () => {
      const invalid: CompactionInvariants = {
        highLevelGoal: "Build engine",
        currentArchitecture: "SQLite WAL",
        completedTasks: ["Task 1"],
        openTasks: [],
        nextConcreteTask: "   ",
      };

      expect(() => validateCompactionInvariants(invalid)).toThrow(
        /Compaction checkpoint violation: nextConcreteTask must not be empty/,
      );
    });

    test("rejects handoff if both completedTasks and openTasks are empty", () => {
      const invalid: CompactionInvariants = {
        highLevelGoal: "Build engine",
        currentArchitecture: "SQLite WAL",
        completedTasks: [],
        openTasks: [],
        nextConcreteTask: "Start task",
      };

      expect(() => validateCompactionInvariants(invalid)).toThrow(
        /Compaction checkpoint violation: task list must contain at least one completed or open task/,
      );
    });

    test("accepts fully specified invariants and writes valid CURRENT.md", () => {
      const valid: CompactionInvariants = {
        highLevelGoal: "Implement Wave 4",
        currentArchitecture: "Clean micro-engine with dual-measure tokens",
        completedTasks: ["Task 1: observation hardening"],
        openTasks: ["Task 3: digest dedup"],
        nextConcreteTask: "Execute Task 3",
      };

      expect(() => validateCompactionInvariants(valid)).not.toThrow();
      const res = generateSessionHandoff(memoryDir, valid);
      expect(existsSync(res.currentMdPath)).toBe(true);
    });
  });

  describe("T-045: on_pre_compress fact extraction hook", () => {
    test("extractInvariantsPreCompress automatically extracts decisions and constraints into memories", () => {
      const invariants: CompactionInvariants = {
        highLevelGoal: "Refactor persistence layer",
        currentArchitecture: "SQLite WAL + memory hot cache",
        completedTasks: ["Setup SQLite connection"],
        openTasks: ["Add WAL retry"],
        nextConcreteTask: "Add WAL retry",
        activeConstraints: [
          "Zero unmasked credentials committed (Vibeguard Protocol).",
          "Never swallow filesystem errors without logging.",
        ],
        decisionsMade: [
          "Chose atomic temporary file swap over direct write to prevent JSONL corruption.",
        ],
      };

      const harvested = extractInvariantsPreCompress(invariants, store, { project: "core", actor: "test_runner" });
      expect(harvested.length).toBe(3);

      const decision = harvested.find((h) => h.type === "decision");
      const constraints = harvested.filter((h) => h.type === "constraint");

      expect(decision).toBeDefined();
      expect(decision?.title).toContain("atomic temporary file swap");
      expect(constraints.length).toBe(2);

      // Verify saved in store
      const allMemories = list(store);
      expect(allMemories.some((m) => m.title.includes("atomic temporary file swap"))).toBe(true);
      expect(allMemories.some((m) => m.title.includes("Zero unmasked credentials"))).toBe(true);
    });

    test("generateSessionHandoff triggers onPreCompress hook before writing checkpoint", async () => {
      let hookRan = false;
      let hookGoal = "";

      const invariants: CompactionInvariants = {
        highLevelGoal: "Hook execution test",
        currentArchitecture: "In-memory test store",
        completedTasks: ["Task Alpha"],
        openTasks: ["Task Beta"],
        nextConcreteTask: "Task Beta",
      };

      await generateSessionHandoff(memoryDir, invariants, {
        store,
        onPreCompress: async (inv) => {
          hookRan = true;
          hookGoal = inv.highLevelGoal;
        },
      });

      expect(hookRan).toBe(true);
      expect(hookGoal).toBe("Hook execution test");
    });
  });
});
