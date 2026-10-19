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
  {
    version: 5,
    up(db) {
      // T-082: valid_to_exact flag for bi-temporal transitions
      const memCols = db
        .query<{ name: string }>(`PRAGMA table_info(memories)`)
        .all()
        .map((c) => c.name);
      if (!memCols.includes("valid_to_exact")) {
        db.exec(`ALTER TABLE memories ADD COLUMN valid_to_exact INTEGER DEFAULT 0`);
        db.exec(`UPDATE memories SET valid_to_exact = COALESCE(json_extract(data, '$.valid_to_exact'), 0)`);
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_valid_to_exact ON memories(valid_to_exact)`);
    },
  },
  {
    version: 6,
    up(db) {
      // T-086: keep-both conflicts table (never delete)
      db.exec(`
        CREATE TABLE IF NOT EXISTS conflicts (
          id TEXT PRIMARY KEY,
          memory_a_id TEXT NOT NULL,
          memory_b_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          conflict_type TEXT NOT NULL,
          confidence REAL DEFAULT 1.0,
          reason TEXT,
          detected_at TEXT NOT NULL,
          resolved_at TEXT,
          resolution_strategy TEXT,
          resolved_by TEXT,
          data TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_conflicts_status ON conflicts(status);
        CREATE INDEX IF NOT EXISTS idx_conflicts_mem_a ON conflicts(memory_a_id);
        CREATE INDEX IF NOT EXISTS idx_conflicts_mem_b ON conflicts(memory_b_id);
        CREATE INDEX IF NOT EXISTS idx_conflicts_pair ON conflicts(memory_a_id, memory_b_id);
      `);
    },
  },
  {
    version: 7,
    up(db) {
      // T-090: src_ts evidence-age stamping (memory only as fresh as evidence)
      const memCols = db
        .query<{ name: string }>(`PRAGMA table_info(memories)`)
        .all()
        .map((c) => c.name);
      if (!memCols.includes("src_ts")) {
        db.exec(`ALTER TABLE memories ADD COLUMN src_ts TEXT`);
        db.exec(
          `UPDATE memories SET src_ts = json_extract(data, '$.src_ts') WHERE json_extract(data, '$.src_ts') IS NOT NULL`,
        );
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_src_ts ON memories(src_ts)`);
    },
  },
  {
    version: 8,
    up(db) {
      // T-095: linked_memory_ids write-time edges seeded during capture
      const memCols = db
        .query<{ name: string }>(`PRAGMA table_info(memories)`)
        .all()
        .map((c) => c.name);
      if (!memCols.includes("linked_memory_ids")) {
        db.exec(`ALTER TABLE memories ADD COLUMN linked_memory_ids TEXT`);
        db.exec(
          `UPDATE memories SET linked_memory_ids = json_extract(data, '$.linked_memory_ids') WHERE json_extract(data, '$.linked_memory_ids') IS NOT NULL`,
        );
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_linked_ids ON memories(linked_memory_ids)`);
    },
  },
  {
    version: 9,
    up(db) {
      // T-099: fact_provenance append-only table, triple-unique index
      db.exec(`
        CREATE TABLE IF NOT EXISTS fact_provenance (
          id TEXT PRIMARY KEY,
          memory_id TEXT NOT NULL,
          entity TEXT NOT NULL,
          relation TEXT NOT NULL,
          target TEXT NOT NULL,
          scope TEXT NOT NULL DEFAULT 'global',
          source TEXT,
          session_id TEXT,
          confidence REAL DEFAULT 1.0,
          data TEXT,
          created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_fact_provenance_triple ON fact_provenance(entity, relation, target);
        CREATE INDEX IF NOT EXISTS idx_fact_provenance_mem_id ON fact_provenance(memory_id);
        CREATE INDEX IF NOT EXISTS idx_fact_provenance_entity ON fact_provenance(entity);
        CREATE INDEX IF NOT EXISTS idx_fact_provenance_created ON fact_provenance(created_at);
      `);
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
