import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, confirm } from "../src/store.ts";
import { createCodeAnchor, attachAnchorToMemory } from "../src/anchors/index.ts";
import { clearFreshnessCache } from "../src/orchestrator/freshness.ts";
import { resolveMuseContext } from "../src/orchestrator/context.ts";
import type { Store } from "../src/store.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("Recall-Time Freshness Gate (GAP-3)", () => {
  let tmpDir: string;
  let workspaceRoot: string;
  let store: Store;
  let entry: MemoryEntry;

  beforeEach(() => {
    clearFreshnessCache();
    tmpDir = mkdtempSync(join(tmpdir(), "muse-freshness-test-"));
    workspaceRoot = tmpDir;
    const codeDir = join(tmpDir, "src");
    mkdirSync(codeDir, { recursive: true });
    writeFileSync(
      join(codeDir, "auth.ts"),
      `export function login(user: string): boolean {\n  return user.length > 0;\n}\n`,
      "utf8",
    );
    store = openStore(join(tmpDir, ".memory"));
    entry = confirm(store, propose(store, { content: "Auth uses login() from src/auth.ts", project: "test" }).id!)!;
    const anchor = createCodeAnchor(workspaceRoot, {
      kind: "symbol",
      filePath: "src/auth.ts",
      symbolName: "login",
    });
    attachAnchorToMemory(store, entry.id, anchor, "test", { workspaceRoot });
  });

  afterEach(() => {
    clearFreshnessCache();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("serves a memory whose anchor still matches live code", async () => {
    const result = await resolveMuseContext(store, workspaceRoot, {
      query: "auth login",
      token_budget: 4000,
    });
    const ids = result.relevant_memories.map((m) => m.id);
    expect(ids).toContain(entry.id);
    expect(result.withheld_memories).toBeUndefined();
    expect(result.freshness_stats?.withheld ?? 0).toBe(0);
  });

  it("withholds a memory after its cited code drifts (default enforce)", async () => {
    // Code evolves after the memory was stored.
    writeFileSync(
      join(workspaceRoot, "src", "auth.ts"),
      `export function login(user: string, token?: string): boolean {\n  return user.length > 0 && !!token;\n}\n`,
      "utf8",
    );

    const result = await resolveMuseContext(store, workspaceRoot, {
      query: "auth login",
      token_budget: 4000,
    });

    const ids = result.relevant_memories.map((m) => m.id);
    expect(ids).not.toContain(entry.id);
    expect(result.withheld_memories).toHaveLength(1);
    expect(result.withheld_memories![0].id).toBe(entry.id);
    expect(result.withheld_memories![0].reason).toContain("changed");
    expect(result.freshness_notice).toContain("Freshness gate withheld");
    expect(result.freshness_stats?.withheld).toBe(1);
  });

  it("withholds a memory whose cited file was deleted", async () => {
    const { unlinkSync } = await import("node:fs");
    unlinkSync(join(workspaceRoot, "src", "auth.ts"));

    const result = await resolveMuseContext(store, workspaceRoot, {
      query: "auth login",
      token_budget: 4000,
    });

    expect(result.relevant_memories.map((m) => m.id)).not.toContain(entry.id);
    expect(result.withheld_memories![0].reason).toContain("no longer exists");
  });

  it("includes drifted memory with an explicit warning on include_drifted", async () => {
    writeFileSync(
      join(workspaceRoot, "src", "auth.ts"),
      `export function login(user: string, token?: string): boolean {\n  return user.length > 0 && !!token;\n}\n`,
      "utf8",
    );

    const result = await resolveMuseContext(store, workspaceRoot, {
      query: "auth login",
      token_budget: 4000,
      include_drifted: true,
    });

    const served = result.relevant_memories.find((m) => m.id === entry.id) as any;
    expect(served).toBeDefined();
    expect(served.freshness_warning).toContain("FRESHNESS");
    expect(result.withheld_memories).toBeUndefined();
  });

  it("memoizes verdicts within a pass (files_read stays low across repeated calls)", async () => {
    const r1 = await resolveMuseContext(store, workspaceRoot, { query: "auth login", token_budget: 4000 });
    const first = r1.freshness_stats!.files_read;
    expect(first).toBeGreaterThanOrEqual(1);

    // Same process, file unchanged: verdict comes from cache, no re-read needed
    // to produce the same decision.
    const r2 = await resolveMuseContext(store, workspaceRoot, { query: "auth login", token_budget: 4000 });
    expect(r2.relevant_memories.map((m) => m.id)).toEqual(r1.relevant_memories.map((m) => m.id));
  });

  it("passes memories without anchors through untouched", async () => {
    const bare = confirm(store, propose(store, { content: "No anchors here, plain fact", project: "test" }).id!)!;
    const result = await resolveMuseContext(store, workspaceRoot, {
      query: "plain fact",
      token_budget: 4000,
    });
    expect(result.relevant_memories.map((m) => m.id)).toContain(bare.id);
    expect(result.freshness_stats?.checked).toBeGreaterThan(0);
  });
});
