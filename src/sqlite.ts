import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { MemoryEntry, MemoryType, MemoryStatus } from "./types.ts";

export interface SqliteDatabase {
  exec(sql: string): void;
  run(sql: string, params?: unknown[] | Record<string, unknown>): void;
  query<T = unknown>(sql: string): {
    all(params?: unknown[] | Record<string, unknown>): T[];
    get(params?: unknown[] | Record<string, unknown>): T | null | undefined;
  };
  close(): void;
}

let sqliteDriver: "bun" | "node" | "none" = "none";

function getDriver() {
  if (sqliteDriver !== "none") return sqliteDriver;
  try {
    if (typeof (globalThis as any).Bun !== "undefined") {
      sqliteDriver = "bun";
      return "bun";
    }
  } catch {}
  try {
    require("node:sqlite");
    sqliteDriver = "node";
    return "node";
  } catch {}
  sqliteDriver = "bun";
  return "bun";
}

export function openDatabase(dbPath: string): SqliteDatabase {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const driver = getDriver();
  let rawDb: any;

  if (driver === "bun") {
    const { Database } = require("bun:sqlite");
    rawDb = new Database(dbPath, { create: true });
    rawDb.run("PRAGMA journal_mode = WAL;");
    rawDb.run("PRAGMA synchronous = NORMAL;");

    const db: SqliteDatabase = {
      exec(sql: string) {
        rawDb.exec(sql);
      },
      run(sql: string, params?: unknown[] | Record<string, unknown>) {
        if (params && Array.isArray(params)) {
          rawDb.run(sql, params);
        } else if (params && typeof params === "object") {
          rawDb.run(sql, params);
        } else {
          rawDb.run(sql);
        }
      },
      query<T = unknown>(sql: string) {
        const stmt = rawDb.query(sql);
        return {
          all(params?: unknown[] | Record<string, unknown>): T[] {
            return params ? (stmt.all(params as any) as T[]) : (stmt.all() as T[]);
          },
          get(params?: unknown[] | Record<string, unknown>): T | null | undefined {
            return params ? (stmt.get(params as any) as T) : (stmt.get() as T);
          },
        };
      },
      close() {
        rawDb.close();
      },
    };

    initSchema(db);
    return db;
  } else {
    const { DatabaseSync } = require("node:sqlite");
    rawDb = new DatabaseSync(dbPath);
    rawDb.exec("PRAGMA journal_mode = WAL;");
    rawDb.exec("PRAGMA synchronous = NORMAL;");

    const db: SqliteDatabase = {
      exec(sql: string) {
        rawDb.exec(sql);
      },
      run(sql: string, params?: unknown[] | Record<string, unknown>) {
        const stmt = rawDb.prepare(sql);
        if (params && Array.isArray(params)) {
          stmt.run(...params);
        } else if (params && typeof params === "object") {
          stmt.run(params);
        } else {
          stmt.run();
        }
      },
      query<T = unknown>(sql: string) {
        const stmt = rawDb.prepare(sql);
        return {
          all(params?: unknown[] | Record<string, unknown>): T[] {
            if (params && Array.isArray(params)) return stmt.all(...params) as T[];
            if (params && typeof params === "object") return stmt.all(params) as T[];
            return stmt.all() as T[];
          },
          get(params?: unknown[] | Record<string, unknown>): T | null | undefined {
            if (params && Array.isArray(params)) return stmt.get(...params) as T;
            if (params && typeof params === "object") return stmt.get(params) as T;
            return stmt.get() as T;
          },
        };
      },
      close() {
        rawDb.close();
      },
    };

    initSchema(db);
    return db;
  }
}

function initSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
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

    CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
    CREATE INDEX IF NOT EXISTS idx_memories_session_id ON memories(session_id);
    CREATE INDEX IF NOT EXISTS idx_memories_due_at ON memories(due_at);
    CREATE INDEX IF NOT EXISTS idx_memories_updated_at ON memories(updated_at);
  `);
}

export interface DbMemoryRow {
  id: string;
  title: string;
  content: string;
  project: string;
  type: string;
  status: string;
  salience: number | null;
  reinforcement: number | null;
  session_id: string | null;
  due_at: string | null;
  expires_at: string | null;
  valid_from: string | null;
  valid_to: string | null;
  data: string;
  created_at: string;
  updated_at: string;
}

export function rowToMemoryEntry(row: DbMemoryRow): MemoryEntry {
  let parsedData: Partial<MemoryEntry> = {};
  try {
    parsedData = JSON.parse(row.data);
  } catch {}

  return {
    ...parsedData,
    id: row.id,
    title: row.title,
    content: row.content,
    project: row.project,
    type: row.type as MemoryType,
    status: row.status as MemoryStatus,
    salience: row.salience !== null ? row.salience : parsedData.salience,
    reinforcement: row.reinforcement !== null ? row.reinforcement : parsedData.reinforcement,
    session_id: row.session_id !== null ? row.session_id : parsedData.session_id,
    due_at: row.due_at !== null ? row.due_at : parsedData.due_at,
    expires_at: row.expires_at !== null ? row.expires_at : parsedData.expires_at,
    valid_from: row.valid_from !== null ? row.valid_from : parsedData.valid_from,
    valid_to: row.valid_to !== null ? row.valid_to : parsedData.valid_to,
    created_at: row.created_at || parsedData.created_at || new Date().toISOString(),
    updated_at: row.updated_at || parsedData.updated_at || new Date().toISOString(),
  };
}

export function insertOrReplaceMemory(db: SqliteDatabase, entry: MemoryEntry): void {
  const sql = `
    INSERT OR REPLACE INTO memories (
      id, title, content, project, type, status, salience, reinforcement,
      session_id, due_at, expires_at, valid_from, valid_to, data,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?
    )
  `;

  db.run(sql, [
    entry.id,
    entry.title,
    entry.content,
    entry.project,
    entry.type || "discovery",
    entry.status,
    typeof entry.salience === "number" ? entry.salience : null,
    typeof entry.reinforcement === "number" ? entry.reinforcement : null,
    entry.session_id ?? null,
    entry.due_at ?? null,
    entry.expires_at ?? null,
    entry.valid_from ?? null,
    entry.valid_to ?? null,
    JSON.stringify(entry),
    entry.created_at,
    entry.updated_at,
  ]);
}

export function getMemoryById(db: SqliteDatabase, id: string): MemoryEntry | null {
  const row = db.query<DbMemoryRow>(`SELECT * FROM memories WHERE id = ? LIMIT 1`).get([id]);
  if (!row) return null;
  return rowToMemoryEntry(row);
}

export function listMemories(
  db: SqliteDatabase,
  filters?: { project?: string; type?: string; status?: string },
): MemoryEntry[] {
  let sql = `SELECT * FROM memories`;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.project) {
    conditions.push(`project = ?`);
    params.push(filters.project);
  }
  if (filters?.type) {
    conditions.push(`type = ?`);
    params.push(filters.type);
  }
  if (filters?.status) {
    conditions.push(`status = ?`);
    params.push(filters.status);
  }

  if (conditions.length > 0) {
    sql += ` WHERE ` + conditions.join(` AND `);
  }
  sql += ` ORDER BY updated_at DESC`;

  const rows = db.query<DbMemoryRow>(sql).all(params.length > 0 ? params : undefined);
  return rows.map(rowToMemoryEntry);
}

export function deleteMemoryById(db: SqliteDatabase, id: string): boolean {
  const existing = getMemoryById(db, id);
  if (!existing) return false;
  db.run(`DELETE FROM memories WHERE id = ?`, [id]);
  return true;
}
