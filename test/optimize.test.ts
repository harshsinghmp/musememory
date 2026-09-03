import { describe, test, expect } from "bun:test";
import { openStore, propose, confirm, list, get } from "../src/store.ts";
import {
  isTestNoise,
  isJunkFragment,
  shouldAutoOptimize,
  optimizeStore,
  readOptimizationMetadata,
  writeOptimizationMetadata,
} from "../src/optimize.ts";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { setupFixtureRoot, cleanup, makeTempRoot } from "./helpers.ts";

describe("Autonomous Memory Optimizer & Auto-Cadence Governor", () => {
  test("identifies test assertion noise with high precision", () => {
    expect(
      isTestNoise({
        id: "m_noise_1",
        title: "Test failure log",
        content: "error: expect(received).toBe(expected)\nExpected: >= 3\nReceived: 2\nat <anonymous> (test/demo.test.ts:36:26)",
        status: "candidate",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any)
    ).toBe(true);

    expect(
      isTestNoise({
        id: "m_noise_2",
        title: "Mock test run",
        content: "Ran 497 tests across 84 files. [7.33s]",
        status: "candidate",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any)
    ).toBe(true);

    // Protected: user confirmed memories are never flagged
    expect(
      isTestNoise({
        id: "m_confirmed_rule",
        title: "Hard rule: You must never commit plaintext database credentials to git",
        content: "Hard rule: You must never commit plaintext database credentials to git.",
        status: "confirmed",
        verification: { level: "user-confirmed", verified_at: new Date().toISOString() },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any)
    ).toBe(false);
  });

  test("identifies junk micro-fragments and transcript headers", () => {
    expect(
      isJunkFragment({
        id: "m_junk_1",
        title: "1",
        content: "short",
        status: "candidate",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any)
    ).toBe(true);

    expect(
      isJunkFragment({
        id: "m_junk_2",
        title: "42",
        content: "too brief",
        status: "candidate",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any)
    ).toBe(true);

    expect(
      isJunkFragment({
        id: "m_valid_pref",
        title: "Use bun instead of npm",
        content: "Always run bun test and bun run build for scripts.",
        status: "candidate",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any)
    ).toBe(false);
  });

  test("evaluates scheduled 7-day and 48-hour inactivity auto-cadence", () => {
    const { root, memoryDir } = setupFixtureRoot();

    // 1. Freshly optimized: should NOT run
    writeOptimizationMetadata(memoryDir, {
      last_optimized_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      total_optimizations: 1,
    });
    expect(shouldAutoOptimize(memoryDir).shouldRun).toBe(false);

    // 2. 7 days elapsed: should run
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    writeOptimizationMetadata(memoryDir, {
      last_optimized_at: eightDaysAgo,
      last_activity_at: new Date().toISOString(),
      total_optimizations: 1,
    });
    const cadCheck = shouldAutoOptimize(memoryDir);
    expect(cadCheck.shouldRun).toBe(true);
    expect(cadCheck.reason).toContain("7-day cadence reached");

    // 3. Inactive for 48 hours: should run
    const fiftyHoursAgo = new Date(Date.now() - 50 * 3600 * 1000).toISOString();
    writeOptimizationMetadata(memoryDir, {
      last_optimized_at: fiftyHoursAgo,
      last_activity_at: fiftyHoursAgo,
      total_optimizations: 1,
    });
    const inactCheck = shouldAutoOptimize(memoryDir);
    expect(inactCheck.shouldRun).toBe(true);
    expect(inactCheck.reason).toContain("Inactivity threshold reached");

    cleanup(root);
  });

  test("executes end-to-end optimizeStore, pruning noise/junk/dupes while preserving confirmed entries", () => {
    const root = makeTempRoot();
    const memoryDir = join(root, ".memory");
    mkdirSync(join(memoryDir, "memories"), { recursive: true });
    const store = openStore(memoryDir);

    // 1. Ingest confirmed high-value memory
    const confirmedEntry = propose(store, {
      title: "Hard Rule: Never commit secrets to git",
      content: "Never commit plaintext credentials, API tokens, or secrets to git repositories.",
      project: "core",
      type: "constraint",
    });
    confirm(store, confirmedEntry.id);

    // 2. Ingest test assertion noise
    propose(store, {
      title: "Expectation failure in test",
      content: "error: expect(units.length).toBeGreaterThanOrEqual(3)\nExpected: >= 3\nReceived: 2\nat test/auto_harvest.test.ts:83:27",
      project: "core",
      type: "fix",
    });

    // 3. Ingest junk snippet
    propose(store, {
      title: "1",
      content: "tiny snippet",
      project: "core",
      type: "discovery",
    });

    // 4. Ingest duplicate candidates
    propose(store, {
      title: "Configure Postgres connection pooling",
      content: "Always enforce connection pooling via pg-pool to avoid exhausting connections.",
      project: "core",
      type: "decision",
    });
    propose(store, {
      title: "Configure Postgres connection pooling",
      content: "Always enforce connection pooling via pg-pool to avoid exhausting connections.",
      project: "core",
      type: "decision",
    });

    const beforeList = list(store);
    expect(beforeList.length).toBe(5);

    // Run optimization
    const report = optimizeStore(store, { memoryDir, force: true });
    expect(report.totalPruned).toBeGreaterThanOrEqual(3);
    expect(report.prunedNoise).toBe(1);
    expect(report.prunedJunk).toBe(1);
    expect(report.prunedDuplicates).toBe(1);
    expect(report.vacuumExecuted).toBe(true);

    const afterList = list(store);
    expect(afterList.length).toBe(2);

    // Assert confirmed memory is intact
    const fetchedConfirmed = get(store, confirmedEntry.id);
    expect(fetchedConfirmed).toBeDefined();
    expect(fetchedConfirmed?.status).toBe("confirmed");

    // Check metadata was saved
    const meta = readOptimizationMetadata(memoryDir);
    expect(meta.total_optimizations).toBe(1);
    expect(meta.last_report?.totalPruned).toBe(report.totalPruned);

    cleanup(root);
  });
});
