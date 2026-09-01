import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { makeTempRoot, cleanup } from "./helpers.ts";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { openStore, propose, confirm, save } from "../src/store.ts";
import { queryTieredContext } from "../src/retrieval/tiered.ts";
import type { Store } from "../src/store.ts";

describe("Deliverable 2: Deterministic Tiered Retrieval Engine", () => {
  let root: string;
  let memoryDir: string;
  let store: Store;

  beforeEach(() => {
    root = makeTempRoot();
    memoryDir = join(root, ".memory");
    mkdirSync(memoryDir, { recursive: true });
    store = openStore(memoryDir);

    // Create USER.md and CURRENT.md
    writeFileSync(join(memoryDir, "USER.md"), "# User Persona\nPrefer TypeScript and strict TDD.", "utf-8");
    writeFileSync(join(memoryDir, "CURRENT.md"), "# Current Constraints\n- Invariant 1: Zero runtime dependencies\n- Invariant 2: Pure TypeScript", "utf-8");

    // Add some memories
    const m1 = propose(store, {
      title: "Fix SQLite race condition with WAL mode",
      content: "Enable WAL mode on sqlite connection: db.exec('PRAGMA journal_mode = WAL;')",
      project: "core",
      type: "fix",
      tags: ["sqlite", "concurrency"],
    });
    confirm(store, m1.id);

    const m2 = propose(store, {
      title: "Dual-persistence architecture with YAML mirror",
      content: "Memories are written to sqlite and mirrored to yaml files in .memory/memories/",
      project: "core",
      type: "architecture",
      tags: ["architecture", "storage"],
    });
    confirm(store, m2.id);
  });

  afterEach(() => {
    cleanup(root);
  });

  test("Tier 0 (Manifest) returns ultra-compact ID/type/title manifest", () => {
    const result = queryTieredContext(store, memoryDir, "sqlite", { tier: 0 });

    expect(result.markdown).toContain("### Memory Manifest (Tier 0)");
    expect(result.markdown).toContain("[fix] Fix SQLite race condition");
    expect(result.markdown).not.toContain("Enable WAL mode on sqlite connection");
    expect(result.markdown).not.toContain("User Persona");
    expect(result.totalTokensUsed).toBeLessThan(100);
  });

  test("Tier 1 (Routing Set) includes USER.md, CURRENT.md, and routed invariant headers", () => {
    const result = queryTieredContext(store, memoryDir, "sqlite", { tier: 1 });

    expect(result.markdown).toContain("### User Profile & Preferences (USER.md)");
    expect(result.markdown).toContain("### Active Working Constraints (CURRENT.md)");
    expect(result.markdown).toContain("### Domain Routing Invariants (Tier 1)");
    expect(result.markdown).toContain("[fix] Fix SQLite race condition");
    expect(result.markdown).not.toContain("Enable WAL mode on sqlite connection");
  });

  test("Tier 2 (Bounded Bodies) renders full bounded memory bodies within budget", () => {
    const result = queryTieredContext(store, memoryDir, "sqlite", { tier: 2, tokenBudget: 1500 });

    expect(result.markdown).toContain("### User Profile & Preferences (USER.md)");
    expect(result.markdown).toContain("### Active Working Constraints (CURRENT.md)");
    expect(result.markdown).toContain("### Relevant Memories & Learned Patterns");
    expect(result.markdown).toContain("Enable WAL mode on sqlite connection");
    expect(result.entries.length).toBeGreaterThan(0);
  });

  test("Defaults to Tier 2 if tier is not specified", () => {
    const result = queryTieredContext(store, memoryDir, "sqlite");
    expect(result.markdown).toContain("### Relevant Memories & Learned Patterns");
  });
});
