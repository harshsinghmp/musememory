import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { openStore, propose, confirm, supersede, list, get, deleteEntry, markStale, link } from "../src/store.ts";
import { setupFixtureRoot, cleanup, makeTempRoot } from "./helpers.ts";

describe("SQLite Primary Database Engine", () => {
  test("creates memory.db at the root level of .memory upon openStore", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const dbPath = join(memoryDir, "memory.db");
    expect(existsSync(dbPath)).toBe(true);
    expect(store.db).toBeDefined();

    cleanup(root);
  });

  test("persists, lists, and retrieves memory entries directly from SQLite primary database", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const entry = propose(store, {
      title: "SQLite Primary Storage Invariant",
      content: "All memories are saved and queried from .memory/memory.db primary database",
      project: "core",
      type: "architecture",
      tags: ["sqlite", "database", "storage"],
      confirmed: true,
    });

    // Verify entry exists in store
    const retrieved = get(store, entry.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(entry.id);
    expect(retrieved?.title).toBe("SQLite Primary Storage Invariant");
    expect(retrieved?.status).toBe("confirmed");
    expect(retrieved?.tags).toEqual(["sqlite", "database", "storage"]);

    // Verify list queries SQLite
    const all = list(store);
    expect(all.some((m) => m.id === entry.id)).toBe(true);

    cleanup(root);
  });

  test("handles state transitions (confirm, supersede, stale, link, delete) in SQLite atomically", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const v1 = propose(store, {
      title: "Auth Rule v1",
      content: "JWT HS256 auth",
      project: "auth",
      type: "fix",
      confirmed: true,
    });

    const v2 = propose(store, {
      title: "Auth Rule v2",
      content: "JWT EdDSA Ed25519 auth",
      project: "auth",
      type: "fix",
      confirmed: true,
    });

    // Supersede v1 with v2
    const superseded = supersede(store, v1.id, v2.id);
    expect(superseded).not.toBeNull();
    expect(superseded?.status).toBe("superseded");
    expect(superseded?.superseded_by).toContain(v2.id);

    // Verify reload from SQLite preserves state
    const reloadedStore = openStore(memoryDir);
    const v1Reloaded = get(reloadedStore, v1.id);
    expect(v1Reloaded?.status).toBe("superseded");
    expect(v1Reloaded?.superseded_by).toContain(v2.id);

    // Link
    link(reloadedStore, v2.id, [v1.id]);
    const v2Reloaded = get(reloadedStore, v2.id);
    expect(v2Reloaded?.related_memory_ids).toContain(v1.id);

    // Delete
    const deleted = deleteEntry(reloadedStore, v1.id, "Testing delete");
    expect(deleted).toBe(true);
    expect(get(reloadedStore, v1.id)).toBeNull();

    cleanup(root);
  });

  test("automatically migrates and synchronizes existing YAML files into SQLite primary store on startup", () => {
    const root = makeTempRoot();
    const memoryDir = join(root, ".memory");
    const memoriesDir = join(memoryDir, "memories");
    mkdirSync(memoriesDir, { recursive: true });

    // Seed existing legacy YAML file before openStore
    const legacyId = "m_1000000000000_legacy";
    const legacyYaml = `id: ${legacyId}\ntitle: Legacy Seed Memory\ncontent: Seeded via YAML\nproject: seed\nstatus: confirmed\ncreated_at: 2026-01-01T00:00:00.000Z\nupdated_at: 2026-01-01T00:00:00.000Z\ntags: [legacy, yaml]\nsource: disk\n`;
    writeFileSync(join(memoriesDir, `${legacyId}.yaml`), legacyYaml, "utf8");

    // Open store - should auto-populate SQLite table
    const store = openStore(memoryDir);
    const fromSqlite = get(store, legacyId);
    expect(fromSqlite).not.toBeNull();
    expect(fromSqlite?.title).toBe("Legacy Seed Memory");
    expect(fromSqlite?.status).toBe("confirmed");

    cleanup(root);
  });
});
