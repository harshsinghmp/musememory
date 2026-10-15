import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { MemoryEntry, MemoryType, MemoryStatus } from "./types.ts";
import { redactSecrets } from "./secrets.ts";

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
    rawDb.run("PRAGMA busy_timeout = 5000;");
    rawDb.run("PRAGMA foreign_keys = ON;");
    rawDb.run("PRAGMA cache_size = -64000;");
    rawDb.run("PRAGMA mmap_size = 268435456;");
    rawDb.run("PRAGMA temp_store = MEMORY;");

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
    rawDb.exec("PRAGMA busy_timeout = 5000;");
    rawDb.exec("PRAGMA foreign_keys = ON;");
    rawDb.exec("PRAGMA cache_size = -64000;");
    rawDb.exec("PRAGMA mmap_size = 268435456;");
    rawDb.exec("PRAGMA temp_store = MEMORY;");

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
      mem_path TEXT,
      last_accessed_at TEXT,
      access_count INTEGER,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- R23: access-weighted retention indexes (A15/A18)
    CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
    CREATE INDEX IF NOT EXISTS idx_memories_session_id ON memories(session_id);
    CREATE INDEX IF NOT EXISTS idx_memories_due_at ON memories(due_at);
    CREATE INDEX IF NOT EXISTS idx_memories_updated_at ON memories(updated_at);
    CREATE INDEX IF NOT EXISTS idx_memories_proj_stat_updated ON memories(project, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memories_salience ON memories(salience);
    CREATE INDEX IF NOT EXISTS idx_memories_reinforcement ON memories(reinforcement);

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      id UNINDEXED,
      title,
      content,
      tags,
      tokenize = 'unicode61'
    );
  `);

  // T-402: Only create indexes on post-v0 columns if those columns actually exist (or have been migrated)
  try {
    const cols = db.query<{ name: string }>(`PRAGMA table_info(memories)`).all().map((c) => c.name);
    if (cols.includes("mem_path")) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_memories_mem_path ON memories(mem_path);
        CREATE INDEX IF NOT EXISTS idx_memories_last_accessed_at ON memories(last_accessed_at);
        CREATE INDEX IF NOT EXISTS idx_memories_access_count ON memories(access_count);
      `);
    }
  } catch {}

  // Backfill FTS index if memories table has records but FTS table is empty
  try {
    const ftsCount = db.query<{ count: number }>(`SELECT count(*) as count FROM memories_fts`).get();
    const memCount = db.query<{ count: number }>(`SELECT count(*) as count FROM memories`).get();
    if ((ftsCount?.count ?? 0) === 0 && (memCount?.count ?? 0) > 0) {
      db.exec(`
        INSERT OR IGNORE INTO memories_fts (id, title, content, tags)
        SELECT id, title, content, COALESCE(json_extract(data, '$.tags'), '') FROM memories;
      `);
    }
  } catch {}
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
  mem_path: string | null;
  last_accessed_at: string | null;
  access_count: number | null;
  idempotency_key?: string | null;
  content_hash?: string | null;
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
    mem_path: row.mem_path !== null ? row.mem_path : parsedData.mem_path,
    last_accessed_at: row.last_accessed_at !== null ? row.last_accessed_at : parsedData.last_accessed_at,
    access_count: row.access_count !== null ? row.access_count : parsedData.access_count,
    idempotency_key: row.idempotency_key !== undefined && row.idempotency_key !== null ? row.idempotency_key : parsedData.idempotency_key,
    content_hash: row.content_hash !== undefined && row.content_hash !== null ? row.content_hash : parsedData.content_hash,
    created_at: row.created_at || parsedData.created_at || new Date().toISOString(),
    updated_at: row.updated_at || parsedData.updated_at || new Date().toISOString(),
  };
}

export function insertOrReplaceMemory(db: SqliteDatabase, entry: MemoryEntry): void {
  try {
    const sql = `
      INSERT OR REPLACE INTO memories (
        id, title, content, project, type, status, salience, reinforcement,
        session_id, due_at, expires_at, valid_from, valid_to,
        mem_path, last_accessed_at, access_count, idempotency_key, content_hash, data,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
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
      entry.mem_path ?? null,
      entry.last_accessed_at ?? null,
      typeof entry.access_count === "number" ? entry.access_count : null,
      entry.idempotency_key ?? null,
      entry.content_hash ?? null,
      JSON.stringify(entry),
      entry.created_at,
      entry.updated_at,
    ]);
  } catch (err: any) {
    if (err && String(err.message || err).includes("no column named")) {
      const legacySql = `
        INSERT OR REPLACE INTO memories (
          id, title, content, project, type, status, salience, reinforcement,
          session_id, due_at, expires_at, valid_from, valid_to,
          mem_path, last_accessed_at, access_count, data,
          created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?
        )
      `;
      db.run(legacySql, [
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
        entry.mem_path ?? null,
        entry.last_accessed_at ?? null,
        typeof entry.access_count === "number" ? entry.access_count : null,
        JSON.stringify(entry),
        entry.created_at,
        entry.updated_at,
      ]);
    } else {
      throw err;
    }
  }

  // Synchronize FTS5 virtual table with index-time credential redaction (T-103)
  try {
    db.run(`DELETE FROM memories_fts WHERE id = ?`, [entry.id]);
    db.run(
      `INSERT INTO memories_fts (id, title, content, tags) VALUES (?, ?, ?, ?)`,
      [entry.id, redactSecrets(entry.title), redactSecrets(entry.content), (entry.tags ?? []).join(" ")],
    );
  } catch {}
}

export function getMemoryById(db: SqliteDatabase, id: string): MemoryEntry | null {
  const row = db.query<DbMemoryRow>(`SELECT * FROM memories WHERE id = ? LIMIT 1`).get([id]);
  if (!row) return null;
  return rowToMemoryEntry(row);
}

export function getMemoryByIdempotencyKey(db: SqliteDatabase, key: string): MemoryEntry | null {
  try {
    const row = db.query<DbMemoryRow>(`SELECT * FROM memories WHERE idempotency_key = ? AND (deleted_at IS NULL OR deleted_at = '') LIMIT 1`).get([key]);
    if (!row) return null;
    return rowToMemoryEntry(row);
  } catch {
    return null;
  }
}

export function getMemoryByContentHash(db: SqliteDatabase, hash: string, project?: string): MemoryEntry | null {
  try {
    let sql = `SELECT * FROM memories WHERE content_hash = ? AND (deleted_at IS NULL OR deleted_at = '')`;
    const params: unknown[] = [hash];
    if (project) {
      sql += ` AND project = ?`;
      params.push(project);
    }
    sql += ` LIMIT 1`;
    const row = db.query<DbMemoryRow>(sql).get(params);
    if (!row) return null;
    return rowToMemoryEntry(row);
  } catch {
    return null;
  }
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
  try {
    db.run(`DELETE FROM memories_fts WHERE id = ?`, [id]);
  } catch {}
  db.run(`DELETE FROM memories WHERE id = ?`, [id]);
  return true;
}

/**
 * T-060: Safely escapes and quotes an individual FTS5 token.
 * Internal double quotes are escaped as `""`, and the token is enclosed in double quotes with prefix match `*`.
 */
export function escapeFtsToken(token: string): string {
  if (!token || typeof token !== "string") return "";
  const clean = token.replace(/[\x00-\x1F\x7F]/g, "").trim();
  if (!clean) return "";
  const escaped = clean.replace(/"/g, '""');
  return `"${escaped}"*`;
}

/**
 * T-060: Builds a syntax-safe FTS5 query string from user/agent input.
 * Strips hostile operators and constructs quoted phrase/prefix terms combined with OR.
 */
export function buildSafeFtsQuery(rawQuery: string): string {
  if (!rawQuery || typeof rawQuery !== "string") return "";

  const rawTokens = rawQuery
    .replace(/[(){}[\]:^~*+]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => {
      if (!t) return false;
      const lower = t.toLowerCase();
      if (lower === "and" || lower === "or" || lower === "not" || lower.startsWith("near/")) {
        return false;
      }
      return true;
    });

  if (rawTokens.length === 0) return "";

  const terms = rawTokens
    .map(escapeFtsToken)
    .filter((t) => t.length > 0);

  return terms.join(" OR ");
}

/**
 * High-speed BM25 full-text search directly inside SQLite using FTS5.
 * Sanitizes and safely escapes all query tokens (T-060) and logs errors (T-312).
 */
export function searchMemoriesFts(
  db: SqliteDatabase,
  query: string,
  filters?: { project?: string; type?: string; status?: string; limit?: number },
): { entry: MemoryEntry; rank: number }[] {
  const terms = buildSafeFtsQuery(query);
  if (!terms) return [];

  let sql = `
    SELECT m.*, bm25(memories_fts) as rank
    FROM memories_fts f
    JOIN memories m ON f.id = m.id
    WHERE memories_fts MATCH ?
  `;
  const conditions: string[] = [];
  const params: unknown[] = [terms];

  if (filters?.project) {
    conditions.push(`m.project = ?`);
    params.push(filters.project);
  }
  if (filters?.type) {
    conditions.push(`m.type = ?`);
    params.push(filters.type);
  }
  if (filters?.status) {
    conditions.push(`m.status = ?`);
    params.push(filters.status);
  }

  if (conditions.length > 0) {
    sql += ` AND ` + conditions.join(` AND `);
  }
  sql += ` ORDER BY rank ASC`;

  if (filters?.limit) {
    sql += ` LIMIT ?`;
    params.push(filters.limit);
  }

  try {
    const rows = db.query<DbMemoryRow & { rank: number }>(sql).all(params);
    return rows.map((r) => ({
      entry: rowToMemoryEntry(r),
      rank: r.rank,
    }));
  } catch (err) {
    // T-312: Surface FTS failure instead of silent swallow
    console.warn(`[FTS5] Search error for query "${query}": ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

