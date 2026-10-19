import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { openStore, propose, get } from "../src/store.ts";
import { openDatabase } from "../src/sqlite.ts";
import { runMigrations } from "../src/migrate.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("T-095: linked_memory_ids write-time edges seeded during capture", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-linked-memories-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("applies Migration 8 to add linked_memory_ids column and index", () => {
    const dbPath = join(tmpDir, "migrate-test.db");
    const db = openDatabase(dbPath);

    // Schema version should be latest (at least 8)
    const version = runMigrations(db);
    expect(version).toBeGreaterThanOrEqual(8);

    const cols = db.query<{ name: string }>(`PRAGMA table_info(memories)`).all().map((c) => c.name);
    expect(cols).toContain("linked_memory_ids");

    const indexes = db.query<{ name: string }>(`PRAGMA index_list(memories)`).all().map((i) => i.name);
    expect(indexes).toContain("idx_memories_linked_ids");
    db.close();
  });

  it("persists and reloads explicit linked_memory_ids", () => {
    const store = openStore(tmpDir);

    const m1 = propose(store, {
      content: "First foundational architectural rule for auth",
      project: "test-proj",
      title: "Auth Rule 1",
    });

    const m2 = propose(store, {
      content: "Secondary rule referencing first rule",
      project: "test-proj",
      title: "Auth Rule 2",
      linked_memory_ids: [m1.id, "m_external_123"],
    });

    expect(m2.linked_memory_ids).toEqual([m1.id, "m_external_123"]);

    // Reload from SQLite
    const retrieved = get(store, m2.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.linked_memory_ids).toEqual([m1.id, "m_external_123"]);
  });

  it("auto-seeds write-time edges from recent relevant memories when omitted", () => {
    const store = openStore(tmpDir);

    const m1 = propose(store, {
      content: "JWT tokens must have 15 minute expiration and use RS256 signing algorithm",
      project: "test-proj",
      title: "JWT Authentication Policy",
      tags: ["auth", "jwt", "security"],
      session_id: "session-abc",
    });

    const m2 = propose(store, {
      content: "Refresh tokens must be rotated on every use and stored in httpOnly cookie",
      project: "test-proj",
      title: "Refresh Token Rotation Policy",
      tags: ["auth", "cookies", "security"],
      session_id: "session-abc",
    });

    // m2 should have auto-linked to m1 due to matching project, session, and tags ('auth', 'security')
    expect(m2.linked_memory_ids).toBeDefined();
    expect(m2.linked_memory_ids).toContain(m1.id);
  });

  it("respects autoLink: false to prevent auto-seeding when no explicit IDs are given", () => {
    const store = openStore(tmpDir);

    propose(store, {
      content: "Initial database configuration settings",
      project: "test-proj",
      title: "DB Config",
      tags: ["database"],
    });

    const m2 = propose(store, {
      content: "Independent frontend theme settings",
      project: "test-proj",
      title: "Theme Config",
      tags: ["ui"],
      autoLink: false,
    });

    expect(m2.linked_memory_ids).toBeUndefined();
  });

  it("deduplicates linked_memory_ids and excludes empty IDs", () => {
    const store = openStore(tmpDir);

    const m = propose(store, {
      content: "Caching strategy with redis cluster",
      project: "test-proj",
      title: "Redis Caching",
      linked_memory_ids: ["m_1", "m_2", "m_1", "", "m_2"],
    });

    expect(m.linked_memory_ids).toEqual(["m_1", "m_2"]);
  });
});
