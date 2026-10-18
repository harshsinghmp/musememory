import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../src/sqlite.ts";
import { save, fileForId, getStorageLayout, type Store } from "../src/store.ts";
import { runMigrations, getSchemaVersion, LATEST_SCHEMA_VERSION } from "../src/migrate.ts";
import type { MemoryEntry } from "../src/types.ts";

/** The `memories` table as it was before access tracking shipped (pre-22c1212): no mem_path / last_accessed_at / access_count. */
const LEGACY_SCHEMA = `
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
`;

function entry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  const now = new Date().toISOString();
  return {
    id: "m_1_legacy-store",
    title: "Legacy store schema",
    content: "The store writes entries to SQLite before mirroring them to YAML.",
    project: "musememory",
    status: "confirmed",
    type: "architecture",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

/**
 * A store built by hand at the pre-migration schema: `openStore()` runs `runMigrations()`,
 * which is exactly what these tests need to control.
 */
function legacyStore(root: string): { db: ReturnType<typeof openDatabase>; store: Store; memoryDir: string } {
  const memoryDir = join(root, ".memory");
  mkdirSync(join(memoryDir, "memories"), { recursive: true });
  const db = openDatabase(join(memoryDir, "memory.db"));
  db.exec(`DROP TABLE memories;`);
  db.exec(LEGACY_SCHEMA);
  const store: Store = {
    dir: join(memoryDir, "memories"),
    memoryDir,
    layout: getStorageLayout(memoryDir),
    db,
  };
  return { db, store, memoryDir };
}

describe("schema migrations (T-368)", () => {
  test("R1: un-migrated store throws on save before the YAML write, and goes green after runMigrations", () => {
    const root = mkdtempSync(join(tmpdir(), "migrate-r1-"));
    const { db, store } = legacyStore(root);
    const e = entry();

    // RED: current code inserts mem_path/last_accessed_at/access_count, which the legacy table lacks.
    // The SQLite write is step 1 of save() and the YAML mirror is step 2, so nothing is mirrored.
    expect(getSchemaVersion(db)).toBe(0);
    expect(() => save(store, e)).toThrow();
    expect(existsSync(fileForId(store, e.id))).toBe(false);

    // GREEN: the migration adds the missing columns, then the same save succeeds end to end.
    runMigrations(db);
    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(() => save(store, e)).not.toThrow();
    expect(existsSync(fileForId(store, e.id))).toBe(true);

    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  test("migration backfills new columns from the existing data JSON blob", () => {
    const root = mkdtempSync(join(tmpdir(), "migrate-backfill-"));
    const { db } = legacyStore(root);
    const e = entry({ mem_path: "auth.session.jwt-expiry", last_accessed_at: "2026-01-02T03:04:05.000Z", access_count: 7 });
    // Row written by an old build: values only exist inside `data`.
    db.run(
      `INSERT OR REPLACE INTO memories (id, title, content, project, type, status, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [e.id, e.title, e.content, e.project, e.type, e.status, JSON.stringify(e), e.created_at, e.updated_at],
    );

    runMigrations(db);

    const row = db.query<{ mem_path: string | null; last_accessed_at: string | null; access_count: number | null }>(
      `SELECT mem_path, last_accessed_at, access_count FROM memories WHERE id = ?`,
    ).get([e.id]);
    expect(row?.mem_path).toBe("auth.session.jwt-expiry");
    expect(row?.last_accessed_at).toBe("2026-01-02T03:04:05.000Z");
    expect(row?.access_count).toBe(7);

    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  test("user_version stamp reads 0 on a fresh store, is written by runMigrations, and is idempotent", () => {
    const root = mkdtempSync(join(tmpdir(), "migrate-stamp-"));
    const { db } = legacyStore(root);

    expect(getSchemaVersion(db)).toBe(0);
    expect(runMigrations(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    // Re-running is a no-op: no duplicate-column error, version unchanged.
    expect(runMigrations(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);

    db.close();
    rmSync(root, { recursive: true, force: true });
  });
});

describe("T-030 tombstone migration", () => {
  test("adds deleted_at / deleted_by to a pre-tombstone store and leaves live rows unmarked", () => {
    const root = mkdtempSync(join(tmpdir(), "migrate-tombstone-"));
    const { db, store } = legacyStore(root);
    const e = entry();

    // RED: the marker columns do not exist yet, so the migration is what makes them usable.
    expect(getSchemaVersion(db)).toBe(0);
    expect(() => db.query(`SELECT deleted_at, deleted_by FROM memories`).all()).toThrow();

    runMigrations(db);
    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);

    const cols = db
      .query<{ name: string }>(`PRAGMA table_info(memories)`)
      .all()
      .map((c) => c.name);
    expect(cols).toContain("deleted_at");
    expect(cols).toContain("deleted_by");

    // Live rows must read as NOT tombstoned: NULL is the unmarked state, with no backfill.
    expect(() => save(store, e)).not.toThrow();
    const row = db
      .query<{ deleted_at: string | null; deleted_by: string | null }>(
        `SELECT deleted_at, deleted_by FROM memories WHERE id = ?`,
      )
      .get([e.id]);
    expect(row?.deleted_at).toBeNull();
    expect(row?.deleted_by).toBeNull();

    // Idempotent: re-running neither errors nor changes the stamp.
    expect(runMigrations(db)).toBe(LATEST_SCHEMA_VERSION);

    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  test("the tombstone index exists after migrating a pre-tombstone store", () => {
    const root = mkdtempSync(join(tmpdir(), "migrate-tombstone-idx-"));
    const { db } = legacyStore(root);
    runMigrations(db);
    const indexes = db
      .query<{ name: string }>(`PRAGMA index_list(memories)`)
      .all()
      .map((r) => r.name);
    expect(indexes).toContain("idx_memories_tombstone");
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
});

describe("T-041 & T-038 migration v3 (idempotency, content_hash, and outbox)", () => {
  test("adds idempotency_key, content_hash columns and outbox table to legacy store", () => {
    const root = mkdtempSync(join(tmpdir(), "migrate-v3-"));
    const { db } = legacyStore(root);

    // Prior to migration, outbox table does not exist
    expect(() => db.query(`SELECT count(*) FROM outbox`).get()).toThrow();

    runMigrations(db);
    expect(getSchemaVersion(db)).toBeGreaterThanOrEqual(3);

    const cols = db
      .query<{ name: string }>(`PRAGMA table_info(memories)`)
      .all()
      .map((c) => c.name);
    expect(cols).toContain("idempotency_key");
    expect(cols).toContain("content_hash");

    // Outbox table exists and is queryable
    const count = db.query<{ count: number }>(`SELECT count(*) as count FROM outbox`).get();
    expect(count?.count).toBe(0);

    const indexes = db
      .query<{ name: string }>(`PRAGMA index_list(outbox)`)
      .all()
      .map((r) => r.name);
    expect(indexes).toContain("idx_outbox_status_updated");
    expect(indexes).toContain("idx_outbox_idempotency_key");

    db.close();
    rmSync(root, { recursive: true, force: true });
  });
});

