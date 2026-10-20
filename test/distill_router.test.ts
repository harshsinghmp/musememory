import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openStore, save } from "../src/store.ts";
import { runDistillRouter } from "../src/cognition/distill_router.ts";

const TEST_DIR = join(import.meta.dir, ".tmp_distill_router_test");

describe("Multi-Channel Distillation Router", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("routes fix/rule to system, architecture to content, and conflict to health", () => {
    const store = openStore(TEST_DIR);

    const now = new Date().toISOString();
    save(store, {
      id: "mem_fix_1",
      title: "Fix for DB lock timeout",
      content: "Increased WAL busy timeout to 5000ms.",
      type: "fix",
      status: "confirmed",
      tags: ["sqlite", "lock"],
      project: "core",
      created_at: now,
      updated_at: now,
    });

    save(store, {
      id: "mem_arch_1",
      title: "Decoupled Event Outbox Pattern",
      content: "Adopted transactional outbox pattern.",
      type: "architecture",
      status: "confirmed",
      tags: ["architecture", "outbox"],
      project: "core",
      created_at: now,
      updated_at: now,
    });

    save(store, {
      id: "mem_conf_1",
      title: "Contradictory Port Numbers",
      content: "Port is 3000 vs 8080.",
      type: "discovery",
      status: "conflicted",
      tags: ["networking"],
      project: "core",
      created_at: now,
      updated_at: now,
    });

    const result = runDistillRouter(store, { workspaceRoot: TEST_DIR });
    expect(result.routed.system.length).toBe(1);
    expect(result.routed.system[0].id).toBe("mem_fix_1");
    expect(result.routed.content.length).toBe(1);
    expect(result.routed.content[0].id).toBe("mem_arch_1");
    expect(result.routed.health.length).toBe(1);
    expect(result.routed.health[0].id).toBe("mem_conf_1");
  });

  it("deduplicates already routed items via distill_state.json", () => {
    const store = openStore(TEST_DIR);

    const now = new Date().toISOString();
    save(store, {
      id: "mem_fix_2",
      title: "Fix for memory leak",
      content: "Closed stream handles.",
      type: "fix",
      status: "confirmed",
      project: "core",
      created_at: now,
      updated_at: now,
    });

    const firstRun = runDistillRouter(store, { workspaceRoot: TEST_DIR });
    expect(firstRun.total_routed).toBe(1);

    const secondRun = runDistillRouter(store, { workspaceRoot: TEST_DIR });
    expect(secondRun.total_routed).toBe(0);
    expect(secondRun.skipped_surfaced).toBeGreaterThanOrEqual(1);

    // Force run re-routes items
    const forcedRun = runDistillRouter(store, { workspaceRoot: TEST_DIR, force: true });
    expect(forcedRun.total_routed).toBe(1);
  });
});
