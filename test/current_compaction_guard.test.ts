import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generateSessionHandoff, parseCurrentConstraints, mergeCurrentConstraints } from "../src/compaction/engine.ts";

const TEST_DIR = join(import.meta.dir, ".tmp_compaction_test");

describe("CURRENT.md Diff-Preserving Merge (T-324)", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("parses active constraints from existing CURRENT.md", () => {
    const raw = `# CURRENT.md
## 🔒 1. Active Working Constraints & Invariants
- Zero unmasked credentials committed (Vibeguard Protocol).
- Fail fast with explicit errors rather than swallowing failures.
- Always use cursor pagination.

## 🎯 2. High-Level Goal
Build feature.`;

    const constraints = parseCurrentConstraints(raw);
    expect(constraints).toHaveLength(3);
    expect(constraints).toContain("Always use cursor pagination.");
  });

  it("unions existing hand-added constraints with new handoff constraints", () => {
    const existing = `# CURRENT.md
## 🔒 1. Active Working Constraints & Invariants
- Existing custom rule 1
- Existing custom rule 2`;

    const merged = mergeCurrentConstraints(existing, ["New proposed rule"]);
    expect(merged).toHaveLength(3);
    expect(merged).toContain("Existing custom rule 1");
    expect(merged).toContain("Existing custom rule 2");
    expect(merged).toContain("New proposed rule");
  });

  it("generateSessionHandoff preserves existing hand-added constraints on disk", () => {
    const currentMdPath = join(TEST_DIR, "CURRENT.md");
    writeFileSync(currentMdPath, `# CURRENT.md
## 🔒 1. Active Working Constraints & Invariants
- Persistent invariant Alpha
- Persistent invariant Beta
`, "utf8");

    generateSessionHandoff(TEST_DIR, {
      highLevelGoal: "Next milestone",
      currentArchitecture: "Clean arch",
      completedTasks: ["Task 1 done"],
      openTasks: ["Task 2 pending"],
      nextConcreteTask: "Execute Task 2",
      activeConstraints: ["Fresh constraint Gamma"],
    });

    const updated = readFileSync(currentMdPath, "utf8");
    expect(updated).toContain("Persistent invariant Alpha");
    expect(updated).toContain("Persistent invariant Beta");
    expect(updated).toContain("Fresh constraint Gamma");
  });
});
