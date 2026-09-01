import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { makeTempRoot, cleanup } from "./helpers.ts";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import {
  recordIteration,
  listIterations,
  detectIterationStatus,
  clearIterations,
  type IterationEntry,
} from "../src/iterations.ts";

describe("Deliverable 6: Gauntlet Iteration Ledger & Plateau Detector", () => {
  let root: string;
  let memoryDir: string;

  beforeEach(() => {
    root = makeTempRoot();
    memoryDir = join(root, ".memory");
    mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    cleanup(root);
  });

  test("recordIteration appends records to .memory/iterations.jsonl", () => {
    const it1 = recordIteration(memoryDir, {
      iteration_index: 1,
      critic_verdict: "fail",
      largest_fix_identified: "Fix missing error boundary in React root component",
      test_results: "12 passed, 2 failed",
      diff_hash: "diff_hash_aaa111",
    });

    expect(it1.iteration_index).toBe(1);
    expect(it1.critic_verdict).toBe("fail");
    expect(it1.timestamp).toBeDefined();

    const itPath = join(memoryDir, "iterations.jsonl");
    expect(existsSync(itPath)).toBe(true);

    const all = listIterations(memoryDir);
    expect(all.length).toBe(1);
    expect(all[0].diff_hash).toBe("diff_hash_aaa111");
  });

  test("detectIterationStatus flags regressions immediately", () => {
    recordIteration(memoryDir, {
      iteration_index: 1,
      critic_verdict: "fail",
      largest_fix_identified: "First attempt",
      test_results: "10 passed, 2 failed",
    });

    recordIteration(memoryDir, {
      iteration_index: 2,
      critic_verdict: "regressed",
      largest_fix_identified: "Broke test suite",
      test_results: "8 passed, 4 failed",
    });

    const status = detectIterationStatus(memoryDir);
    expect(status.isRegressed).toBe(true);
    expect(status.recommendation).toContain("Revert");
  });

  test("detectIterationStatus detects plateau when diff_hash repeats or 3 consecutive fails occur", () => {
    recordIteration(memoryDir, {
      iteration_index: 1,
      critic_verdict: "fail",
      largest_fix_identified: "Fix 1",
      test_results: "FAIL",
      diff_hash: "hash_x",
    });

    recordIteration(memoryDir, {
      iteration_index: 2,
      critic_verdict: "fail",
      largest_fix_identified: "Fix 2",
      test_results: "FAIL",
      diff_hash: "hash_x",
    });

    const status = detectIterationStatus(memoryDir);
    expect(status.isPlateaued).toBe(true);
    expect(status.recommendation).toContain("Plateau");
  });

  test("detectIterationStatus approves pass verdict", () => {
    recordIteration(memoryDir, {
      iteration_index: 1,
      critic_verdict: "pass",
      largest_fix_identified: "All unit tests pass cleanly",
      test_results: "14 passed, 0 failed",
    });

    const status = detectIterationStatus(memoryDir);
    expect(status.isPlateaued).toBe(false);
    expect(status.isRegressed).toBe(false);
    expect(status.lastVerdict).toBe("pass");
  });
});
