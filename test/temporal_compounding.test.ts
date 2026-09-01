import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { makeTempRoot, cleanup } from "./helpers.ts";
import { join } from "node:path";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { openStore, propose, confirm } from "../src/store.ts";
import {
  rollupTemporal,
  compileHotCache,
  getPeriodKey,
} from "../src/compounding/temporal.ts";
import type { Store } from "../src/store.ts";

describe("Deliverable 5: Multi-Scale Temporal Knowledge Compounding", () => {
  let root: string;
  let memoryDir: string;
  let store: Store;

  beforeEach(() => {
    root = makeTempRoot();
    memoryDir = join(root, ".memory");
    mkdirSync(memoryDir, { recursive: true });
    store = openStore(memoryDir);

    writeFileSync(
      join(memoryDir, "CURRENT.md"),
      "# Active Constraints\n- Invariant: Zero external dependencies\n- Invariant: Strict TDD",
      "utf-8",
    );

    const m1 = propose(store, {
      title: "Fix Bun SQLite concurrency lock",
      content: "Set busy_timeout to 5000ms on sqlite db connection to avoid busy errors.",
      project: "core",
      type: "fix",
      tags: ["sqlite", "concurrency"],
    });
    confirm(store, m1.id);

    const m2 = propose(store, {
      title: "Adopt Bi-temporal validity timestamps",
      content: "All memories record created_at and valid_from/valid_to ranges.",
      project: "core",
      type: "architecture",
      tags: ["bitemporal", "architecture"],
    });
    confirm(store, m2.id);
  });

  afterEach(() => {
    cleanup(root);
  });

  test("getPeriodKey computes accurate ISO week, month, and quarter keys", () => {
    const d = new Date("2026-09-01T12:00:00Z");
    expect(getPeriodKey(d, "week")).toMatch(/^2026-W\d{2}$/);
    expect(getPeriodKey(d, "month")).toBe("2026-09");
    expect(getPeriodKey(d, "quarter")).toBe("2026-Q3");
  });

  test("rollupTemporal compiles weekly synthesis and generates .memory/HOT.md", () => {
    const result = rollupTemporal(store, {
      memoryDir,
      period: "week",
      date: "2026-09-01",
    });

    expect(result.periodKey).toMatch(/^2026-W/);
    expect(result.entriesCount).toBeGreaterThanOrEqual(2);
    expect(existsSync(result.filePath)).toBe(true);

    const rollupContent = readFileSync(result.filePath, "utf-8");
    expect(rollupContent).toContain("Weekly Synthesis");
    expect(rollupContent).toContain("Fix Bun SQLite concurrency lock");

    const hotPath = join(memoryDir, "HOT.md");
    expect(existsSync(hotPath)).toBe(true);
    const hotContent = readFileSync(hotPath, "utf-8");
    expect(hotContent).toContain("# HOT Working Memory Cache");
    expect(hotContent).toContain("Active Constraints");
    expect(hotContent).toContain("Zero external dependencies");
  });

  test("rollupTemporal compiles quarterly architecture overview", () => {
    const result = rollupTemporal(store, {
      memoryDir,
      period: "quarter",
      date: "2026-09-01",
    });

    expect(result.periodKey).toBe("2026-Q3");
    expect(existsSync(result.filePath)).toBe(true);

    const rollupContent = readFileSync(result.filePath, "utf-8");
    expect(rollupContent).toContain("Quarterly Synthesis");
    expect(rollupContent).toContain("Adopt Bi-temporal validity timestamps");
  });
});
