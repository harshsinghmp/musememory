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
