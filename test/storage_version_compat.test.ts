import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MIGRATIONS,
  LATEST_SCHEMA_VERSION,
  getSchemaVersion,
  runMigrations,
} from "../src/migrate.ts";
import { openStore, closeStore, get, propose, list } from "../src/store.ts";
import { queryContext } from "../src/retrieval.ts";
import { searchMemoriesFts } from "../src/sqlite.ts";

/**
 * Creates a raw v0 SQLite database simulating pre-migration legacy store.
 */
function createV0Database(dbPath: string): Database {
  const db = new Database(dbPath);
  db.exec(`PRAGMA user_version = 0;`);
  db.exec(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      project TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      salience REAL,
      reinforcement INTEGER,
      session_id TEXT,
      due_at TEXT,
      expires_at TEXT,
      valid_from TEXT,
      valid_to TEXT,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX idx_memories_project ON memories(project);
    CREATE INDEX idx_memories_status ON memories(status);

    CREATE VIRTUAL TABLE memories_fts USING fts5(
      id UNINDEXED,
      title,
      content,
      tags,
      tokenize = 'unicode61'
    );
  `);
  return db;
}

describe("T-130: storage-version compat tests in CI matrix", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "muse-storage-compat-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Schema version definitions and invariants", () => {
    it("MIGRATIONS contains sequential versions starting from 1 up to LATEST_SCHEMA_VERSION", () => {
      expect(MIGRATIONS.length).toBe(LATEST_SCHEMA_VERSION);
      for (let i = 0; i < MIGRATIONS.length; i++) {
        expect(MIGRATIONS[i].version).toBe(i + 1);
      }
    });

    it("getSchemaVersion reports 0 on fresh unversioned database", () => {
      const dbPath = join(tempDir, "fresh_v0.db");
      const db = createV0Database(dbPath);
      expect(getSchemaVersion(db as any)).toBe(0);
      db.close();
    });
  });

  describe("End-to-end migration from v0 to LATEST_SCHEMA_VERSION", () => {
    it("migrates a v0 database to latest version and backfills all legacy JSON data columns", () => {
      const dbPath = join(tempDir, "legacy_v0.db");
      const db = createV0Database(dbPath);

      // Seed a legacy row with rich data JSON
      const legacyData = JSON.stringify({
        id: "m_100_auth_jwt",
        title: "Legacy JWT Token Expiry",
        content: "JWT auth tokens expire in 1 hour.",
        project: "auth",
        type: "decision",
        status: "confirmed",
        mem_path: "auth.tokens.jwt",
        last_accessed_at: "2026-01-01T00:00:00.000Z",
        access_count: 42,
        decay_score: 0.85,
        valid_to_exact: 1,
        src_ts: "2025-12-15T12:00:00.000Z",
        linked_memory_ids: ["m_99_session"],
        supersedes_id: "m_50_old_auth",
        conflicts_with_id: "m_55_cookie_auth",
        tags: ["auth", "jwt"],
      });

      db.query(`
        INSERT INTO memories (id, title, content, project, type, status, data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "m_100_auth_jwt",
        "Legacy JWT Token Expiry",
        "JWT auth tokens expire in 1 hour.",
        "auth",
        "decision",
        "confirmed",
        legacyData,
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z"
      );

      // Verify v0 schema
      expect(getSchemaVersion(db as any)).toBe(0);

      // Run full migrations
      const finalVersion = runMigrations(db as any);
      expect(finalVersion).toBe(LATEST_SCHEMA_VERSION);
      expect(getSchemaVersion(db as any)).toBe(LATEST_SCHEMA_VERSION);

      // Verify all backfilled columns
      const row = db.query<any, any>(`SELECT * FROM memories WHERE id = ?`).get("m_100_auth_jwt");
      expect(row).toBeDefined();
      expect(row.mem_path).toBe("auth.tokens.jwt");
      expect(row.last_accessed_at).toBe("2026-01-01T00:00:00.000Z");
      expect(row.access_count).toBe(42);
      expect(row.decay_score).toBe(0.85);
      expect(row.valid_to_exact).toBe(1);
      expect(row.src_ts).toBe("2025-12-15T12:00:00.000Z");
      expect(row.linked_memory_ids).toBe('["m_99_session"]');
      expect(row.supersedes_id).toBe("m_50_old_auth");
      expect(row.conflicts_with_id).toBe("m_55_cookie_auth");
      expect(row.deleted_at).toBeNull();

      // Verify auxiliary tables were created
      const tables = db.query<{ name: string }, any>(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((t) => t.name);
      expect(tables).toContain("outbox");
      expect(tables).toContain("conflicts");
      expect(tables).toContain("fact_provenance");

      db.close();
    });

    it("migration is idempotent and does not alter data when re-run", () => {
      const dbPath = join(tempDir, "idempotent.db");
      const db = createV0Database(dbPath);

      runMigrations(db as any);
      expect(getSchemaVersion(db as any)).toBe(LATEST_SCHEMA_VERSION);

      // Re-run
      const secondRun = runMigrations(db as any);
      expect(secondRun).toBe(LATEST_SCHEMA_VERSION);
      expect(getSchemaVersion(db as any)).toBe(LATEST_SCHEMA_VERSION);

      db.close();
    });
  });

  describe("Partial version step upgrades (v1 -> v4 -> v8 -> v10)", () => {
    it("upgrades cleanly across intermediate schema versions", () => {
      const dbPath = join(tempDir, "partial.db");
      const db = createV0Database(dbPath);

      // Apply only migrations up to version 3
      for (const m of MIGRATIONS.slice(0, 3)) {
        m.up(db as any);
        db.exec(`PRAGMA user_version = ${m.version}`);
      }
      expect(getSchemaVersion(db as any)).toBe(3);

      // Verify v3 tables and columns
      const colsV3 = db.query<{ name: string }, any>(`PRAGMA table_info(memories)`).all().map((c) => c.name);
      expect(colsV3).toContain("idempotency_key");
      expect(colsV3).toContain("content_hash");
      expect(colsV3).not.toContain("decay_score"); // Added in v4

      // Now upgrade to v7
      for (const m of MIGRATIONS.slice(3, 7)) {
        m.up(db as any);
        db.exec(`PRAGMA user_version = ${m.version}`);
      }
      expect(getSchemaVersion(db as any)).toBe(7);

      const colsV7 = db.query<{ name: string }, any>(`PRAGMA table_info(memories)`).all().map((c) => c.name);
      expect(colsV7).toContain("decay_score");
      expect(colsV7).toContain("valid_to_exact");
      expect(colsV7).toContain("src_ts");
      expect(colsV7).not.toContain("linked_memory_ids"); // Added in v8

      // Now run remaining migrations to latest
      const finalVersion = runMigrations(db as any);
      expect(finalVersion).toBe(LATEST_SCHEMA_VERSION);
      expect(getSchemaVersion(db as any)).toBe(LATEST_SCHEMA_VERSION);

      const colsFinal = db.query<{ name: string }, any>(`PRAGMA table_info(memories)`).all().map((c) => c.name);
      expect(colsFinal).toContain("linked_memory_ids");
      expect(colsFinal).toContain("supersedes_id");
      expect(colsFinal).toContain("conflicts_with_id");

      db.close();
    });
  });

  describe("Store integration: opening and querying legacy databases", () => {
    it("openStore transparently migrates a legacy v0 database and supports full read/write operations", () => {
      const dbDir = mkdtempSync(join(tempDir, "store_compat_"));
      const dbPath = join(dbDir, "memory.db");
      const rawDb = createV0Database(dbPath);

      // Seed legacy entry
      const legacyEntry = {
        id: "m_1700000000_cache_ttl",
        title: "Distributed Cache TTL Invariant",
        content: "Distributed Redis caches must specify a maximum TTL of 86400 seconds.",
        project: "infra",
        type: "architecture",
        status: "confirmed",
        tags: ["cache", "redis", "ttl"],
        data: JSON.stringify({
          id: "m_1700000000_cache_ttl",
          title: "Distributed Cache TTL Invariant",
          content: "Distributed Redis caches must specify a maximum TTL of 86400 seconds.",
          project: "infra",
          type: "architecture",
          status: "confirmed",
          tags: ["cache", "redis", "ttl"],
          mem_path: "infra.cache.redis.ttl",
          decay_score: 1.0,
        }),
      };

      rawDb.query(`
        INSERT INTO memories (id, title, content, project, type, status, data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(
        legacyEntry.id,
        legacyEntry.title,
        legacyEntry.content,
        legacyEntry.project,
        legacyEntry.type,
        legacyEntry.status,
        legacyEntry.data
      );

      rawDb.query(`
        INSERT INTO memories_fts (id, title, content, tags)
        VALUES (?, ?, ?, ?)
      `).run(legacyEntry.id, legacyEntry.title, legacyEntry.content, "cache redis ttl");

      rawDb.close();

      // Open store through canonical openStore
      const store = openStore(dbDir);
      expect(store.db).toBeDefined();
      expect(getSchemaVersion(store.db!)).toBe(LATEST_SCHEMA_VERSION);

      // Read seeded entry
      const fetched = get(store, legacyEntry.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.title).toBe(legacyEntry.title);
      expect(fetched!.mem_path).toBe("infra.cache.redis.ttl");

      // Verify list
      const items = list(store, { project: "infra" });
      expect(items.length).toBe(1);

      // Propose new entry in migrated store
      const newEntry = propose(store, {
        project: "infra",
        title: "Post-Migration Kafka Topic Partitioning",
        content: "Kafka ingress topics partition on tenant UUID key.",
        type: "architecture",
        confirmed: true,
      });
      expect(newEntry.id).toBeDefined();

      // Verify search across old and new entries
      const searchRes = queryContext(store, "Redis cache TTL", { project: "infra" });
      expect(searchRes.results.length).toBeGreaterThan(0);
      expect(searchRes.results[0].entry.id).toBe(legacyEntry.id);

      closeStore(store);
    });
  });
});
