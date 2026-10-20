import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openStore, type Store } from "../src/store.ts";
import { recordObservation } from "../src/learning/observation.ts";
import { mineFixPairsFromObservations } from "../src/learning/distill.ts";

describe("T-144: Trajectory Fix-Pair Mining", () => {
  const testDir = join(import.meta.dir, ".tmp-fix-pair-mining-test");
  let store: Store;

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    store = openStore(testDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("mines a fix-pair when a failing command is followed by a successful fix", () => {
    // Event A: Failing test
    recordObservation(store, {
      source: "test",
      project: "test-proj",
      raw: "FAIL: src/auth/jwt.test.ts - Cannot find module '@auth/core'",
      summary: "Test failure: bun test src/auth/jwt.test.ts",
      metadata: {
        command: "bun test src/auth/jwt.test.ts",
        exitCode: 1,
      },
    });

    // Event B: Remediation package add
    recordObservation(store, {
      source: "tool",
      project: "test-proj",
      raw: "+ @auth/core@0.12.0 installed",
      summary: "Package installed: bun add @auth/core",
      metadata: {
        command: "bun add @auth/core",
        exitCode: 0,
      },
    });

    // Event C: Green re-run
    recordObservation(store, {
      source: "test",
      project: "test-proj",
      raw: "PASS: src/auth/jwt.test.ts (12 tests passed)",
      summary: "Test passed: bun test src/auth/jwt.test.ts",
      metadata: {
        command: "bun test src/auth/jwt.test.ts",
        exitCode: 0,
      },
    });

    const candidates = mineFixPairsFromObservations(store, "test-proj");

    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const candidate = candidates[0].entry;

    expect(candidate.type).toBe("negative");
    expect(candidate.status).toBe("candidate");
    expect(candidate.title.startsWith("AVOID:")).toBe(true);
    expect(candidate.negative?.failed_approach).toContain("bun test src/auth/jwt.test.ts");
    expect(candidate.negative?.failure_reason).toContain("Cannot find module '@auth/core'");
    expect(candidate.tags).toContain("fix-pair");
  });

  it("rejects informational commands (e.g. 'ls', 'git status') as remedy pairings", () => {
    // Event A: Failing build
    recordObservation(store, {
      source: "build",
      project: "test-proj",
      raw: "Build error: SyntaxError in src/index.ts",
      summary: "Build failed: bun run build",
      metadata: {
        command: "bun run build",
        exitCode: 1,
      },
    });

    // Event B: Innocent informational command (must NOT be paired as the remedy)
    recordObservation(store, {
      source: "tool",
      project: "test-proj",
      raw: "src/ package.json README.md",
      summary: "List directory contents",
      metadata: {
        command: "ls -la",
        exitCode: 0,
      },
    });

    const candidates = mineFixPairsFromObservations(store, "test-proj");
    expect(candidates.length).toBe(0);
  });

  it("normalizes dynamic line numbers in error signatures to prevent duplicate candidates", () => {
    // Failure 1 at line 42:15
    recordObservation(store, {
      source: "test",
      project: "test-proj",
      raw: "FAIL at src/api.ts:42:15: Unhandled rejection in HandlerPool",
      summary: "Failure at line 42",
      metadata: {
        command: "bun test",
        exitCode: 1,
      },
    });

    // Resolution 1
    recordObservation(store, {
      source: "test",
      project: "test-proj",
      raw: "PASS: all tests passed",
      summary: "Success",
      metadata: {
        command: "bun test",
        exitCode: 0,
      },
    });

    // Failure 2 (same error, shifted line 45:18)
    recordObservation(store, {
      source: "test",
      project: "test-proj",
      raw: "FAIL at src/api.ts:45:18: Unhandled rejection in HandlerPool",
      summary: "Failure at line 45",
      metadata: {
        command: "bun test",
        exitCode: 1,
      },
    });

    // Resolution 2
    recordObservation(store, {
      source: "test",
      project: "test-proj",
      raw: "PASS: all tests passed",
      summary: "Success",
      metadata: {
        command: "bun test",
        exitCode: 0,
      },
    });

    const candidates = mineFixPairsFromObservations(store, "test-proj");

    // Deduplication should collapse to 1 candidate
    expect(candidates.length).toBe(1);
  });

  it("scrubs secrets in mined error snippets via Vibeguard", () => {
    const { appendFileSync } = require("node:fs");
    const rawFailureObs = {
      id: "obs-leak-fail",
      timestamp: new Date().toISOString(),
      source: "test",
      project: "test-proj",
      raw: "Error: Auth failed with token sk-ant-api03-abcdef1234567890abcdef1234567890 for user",
      summary: "Auth error with raw key",
      metadata: {
        command: "bun test auth.test.ts",
        exitCode: 1,
      },
      processed: false,
    };
    const rawSuccessObs = {
      id: "obs-leak-success",
      timestamp: new Date().toISOString(),
      source: "test",
      project: "test-proj",
      raw: "PASS auth.test.ts",
      summary: "Auth passed with env var",
      metadata: {
        command: "bun test auth.test.ts",
        exitCode: 0,
      },
      processed: false,
    };

    appendFileSync(
      join(testDir, "observations.jsonl"),
      JSON.stringify(rawFailureObs) + "\n" + JSON.stringify(rawSuccessObs) + "\n",
      "utf8",
    );

    const candidates = mineFixPairsFromObservations(store, "test-proj");
    expect(candidates.length).toBe(1);

    const candidate = candidates[0].entry;
    expect(candidate.negative?.failure_reason).not.toContain("sk-ant-api03-abcdef1234567890abcdef1234567890");
    expect(candidate.negative?.failure_reason).toContain("[REDACTED_SECRET]");
  });

  it("enforces session volume cap of maximum 3 candidates per harvest", () => {
    // Generate 5 distinct failure-success pairs
    for (let i = 1; i <= 5; i++) {
      recordObservation(store, {
        source: "test",
        project: "test-proj",
        raw: `Error distinct signature ${i}: unique failure mode ${i}`,
        summary: `Failure ${i}`,
        metadata: {
          command: `bun test test-${i}.test.ts`,
          exitCode: 1,
        },
      });

      recordObservation(store, {
        source: "test",
        project: "test-proj",
        raw: `PASS test-${i}.test.ts`,
        summary: `Success ${i}`,
        metadata: {
          command: `bun test test-${i}.test.ts`,
          exitCode: 0,
        },
      });
    }

    const candidates = mineFixPairsFromObservations(store, "test-proj");

    // Must be capped at exactly 3
    expect(candidates.length).toBe(3);
  });
});
