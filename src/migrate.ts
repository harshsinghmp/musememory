import type { SqliteDatabase } from "./sqlite.ts";

export interface Migration {
  version: number;
  /** Additive only: ALTER TABLE ... ADD COLUMN plus a backfill from `data`. Never drop or rename. */
  up(db: SqliteDatabase): void;
}

/** Columns `insertOrReplaceMemory` writes that the original `memories` table did not have. */
const POST_V0_COLUMNS: { name: string; type: string; json: string }[] = [
  { name: "mem_path", type: "TEXT", json: "$.mem_path" },
  { name: "last_accessed_at", type: "TEXT", json: "$.last_accessed_at" },
  { name: "access_count", type: "INTEGER", json: "$.access_count" },
];

/**
 * T-030 tombstone marker. A soft-deleted row keeps its content and stays queryable by audit
 * and replay, but every read path filters on `deleted_at`. No backfill from `data`: the marker
 * is deliberately not an entry field, and NULL is the "not deleted" state.
 */
const TOMBSTONE_COLUMNS: { name: string; type: string }[] = [
  { name: "deleted_at", type: "TEXT" },
  { name: "deleted_by", type: "TEXT" },
];

/** Ordered by version; a new column gets a new migration appended here, never an edit to an old one. */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up(db) {
      for (const col of POST_V0_COLUMNS) {
        const has = db
          .query<{ name: string }>(`PRAGMA table_info(memories)`)
          .all()
          .some((c) => c.name === col.name);
        if (!has) db.exec(`ALTER TABLE memories ADD COLUMN ${col.name} ${col.type}`);
        // Old builds only ever persisted these inside `data`, so that blob is the backfill source.
        db.exec(`UPDATE memories SET ${col.name} = json_extract(data, '${col.json}') WHERE ${col.name} IS NULL`);
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_mem_path ON memories(mem_path)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_last_accessed_at ON memories(last_accessed_at)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_access_count ON memories(access_count)`);
    },
  },
  {
    version: 2,
    up(db) {
      for (const col of TOMBSTONE_COLUMNS) {
        const has = db
          .query<{ name: string }>(`PRAGMA table_info(memories)`)
          .all()
          .some((c) => c.name === col.name);
        if (!has) db.exec(`ALTER TABLE memories ADD COLUMN ${col.name} ${col.type}`);
      }
      // Read paths probe the marker on every list/get; without this the probe is a table scan.
      db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_tombstone ON memories(deleted_at)`);
    },
  },
  {
    version: 3,
    up(db) {
      // T-038 & T-040: idempotency_key and content_hash columns
      const memCols = db
        .query<{ name: string }>(`PRAGMA table_info(memories)`)
        .all()
        .map((c) => c.name);
      if (!memCols.includes("idempotency_key")) {
        db.exec(`ALTER TABLE memories ADD COLUMN idempotency_key TEXT`);
      }
      if (!memCols.includes("content_hash")) {
        db.exec(`ALTER TABLE memories ADD COLUMN content_hash TEXT`);
      }
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_idempotency_key ON memories(idempotency_key) WHERE idempotency_key IS NOT NULL`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_content_hash ON memories(content_hash)`);

      // T-041: durable write outbox state machine
      db.exec(`
        CREATE TABLE IF NOT EXISTS outbox (
          id TEXT PRIMARY KEY,
          entry_id TEXT NOT NULL,
          operation TEXT NOT NULL,
          payload TEXT NOT NULL,
          status TEXT NOT NULL,
          idempotency_key TEXT,
          auto_replay INTEGER NOT NULL DEFAULT 1,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_attempt_at TEXT,
          locked_at TEXT,
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_status_updated ON outbox(status, updated_at);
        CREATE INDEX IF NOT EXISTS idx_outbox_idempotency_key ON outbox(idempotency_key);
        CREATE INDEX IF NOT EXISTS idx_outbox_locked_at ON outbox(locked_at);
      `);
    },
  },
  {
    version: 4,
    up(db) {
      // T-074: materialized decay_score column for importance-gated half-life decay
      const memCols = db
        .query<{ name: string }>(`PRAGMA table_info(memories)`)
        .all()
        .map((c) => c.name);
      if (!memCols.includes("decay_score")) {
        db.exec(`ALTER TABLE memories ADD COLUMN decay_score REAL DEFAULT 1.0`);
        db.exec(`UPDATE memories SET decay_score = COALESCE(json_extract(data, '$.decay_score'), 1.0)`);
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_decay_score ON memories(decay_score)`);
    },
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export function getSchemaVersion(db: SqliteDatabase): number {
  return Number(db.query<{ user_version: number }>(`PRAGMA user_version`).get()?.user_version ?? 0);
}

/** Apply every migration newer than the store's `PRAGMA user_version` stamp. Returns the resulting version. */
export function runMigrations(db: SqliteDatabase): number {
  let version = getSchemaVersion(db);
  for (const migration of MIGRATIONS) {
    if (migration.version <= version) continue;
    migration.up(db);
    db.exec(`PRAGMA user_version = ${migration.version}`);
    version = migration.version;
  }
  return version;
}
