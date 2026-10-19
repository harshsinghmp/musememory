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
      valid_to_exact INTEGER DEFAULT 0,
      src_ts TEXT,
      linked_memory_ids TEXT,
      mem_path TEXT,
      last_accessed_at TEXT,
      access_count INTEGER,
      decay_score REAL DEFAULT 1.0,
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
    CREATE INDEX IF NOT EXISTS idx_memories_decay_score ON memories(decay_score);
    CREATE INDEX IF NOT EXISTS idx_memories_valid_to_exact ON memories(valid_to_exact);
    CREATE INDEX IF NOT EXISTS idx_memories_src_ts ON memories(src_ts);
    CREATE INDEX IF NOT EXISTS idx_memories_linked_ids ON memories(linked_memory_ids);

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      id UNINDEXED,
      title,
      content,
      tags,
      tokenize = 'unicode61'
    );

    -- T-086: keep-both conflicts table (never delete)
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
  valid_to_exact?: number | null;
  src_ts?: string | null;
  linked_memory_ids?: string | null;
  mem_path: string | null;
  last_accessed_at: string | null;
  access_count: number | null;
  decay_score?: number | null;
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

  let linked_memory_ids = parsedData.linked_memory_ids;
  if (row.linked_memory_ids !== undefined && row.linked_memory_ids !== null) {
    if (typeof row.linked_memory_ids === "string") {
      try {
        linked_memory_ids = JSON.parse(row.linked_memory_ids);
      } catch {}
    } else if (Array.isArray(row.linked_memory_ids)) {
      linked_memory_ids = row.linked_memory_ids;
    }
  }

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
    valid_to_exact:
      row.valid_to_exact !== undefined && row.valid_to_exact !== null
        ? Boolean(row.valid_to_exact)
        : parsedData.valid_to_exact !== undefined
        ? Boolean(parsedData.valid_to_exact)
        : undefined,
    src_ts: row.src_ts !== null && row.src_ts !== undefined ? row.src_ts : parsedData.src_ts,
    linked_memory_ids,
    mem_path: row.mem_path !== null ? row.mem_path : parsedData.mem_path,
    last_accessed_at: row.last_accessed_at !== null ? row.last_accessed_at : parsedData.last_accessed_at,
    access_count: row.access_count !== null ? row.access_count : parsedData.access_count,
    decay_score:
      typeof row.decay_score === "number"
        ? row.decay_score
        : typeof parsedData.decay_score === "number"
        ? parsedData.decay_score
        : 1.0,
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
        session_id, due_at, expires_at, valid_from, valid_to, valid_to_exact, src_ts, linked_memory_ids,
        mem_path, last_accessed_at, access_count, decay_score, idempotency_key, content_hash, data,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
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
      entry.valid_to_exact ? 1 : 0,
      entry.src_ts ?? null,
      entry.linked_memory_ids ? JSON.stringify(entry.linked_memory_ids) : null,
      entry.mem_path ?? null,
      entry.last_accessed_at ?? null,
      typeof entry.access_count === "number" ? entry.access_count : null,
      typeof entry.decay_score === "number" ? entry.decay_score : 1.0,
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

export interface FtsSearchHit {
  entry: MemoryEntry;
  rank: number;
}

export type FtsSearchHits = FtsSearchHit[] & {
  degraded?: boolean;
  error?: string;
  hidden_count?: number;
};

/**
 * High-speed BM25 full-text search directly inside SQLite using FTS5.
 * Sanitizes and safely escapes all query tokens (T-060) and surfaces degraded status (T-312).
 * Implements hidden-count-aware over-fetch (T-096) so superseded/inactive memories do not starve limit.
 */
export function searchMemoriesFts(
  db: SqliteDatabase,
  query: string,
  filters?: {
    project?: string;
    type?: string;
    status?: string;
    limit?: number;
    includeSuperseded?: boolean;
    overfetch?: boolean;
  },
): FtsSearchHits {
  const terms = buildSafeFtsQuery(query);
  if (!terms) {
    const empty: FtsSearchHits = [];
    empty.degraded = false;
    empty.hidden_count = 0;
    return empty;
  }

  let sql = `
    SELECT m.*, bm25(memories_fts) as rank
    FROM memories_fts f
    JOIN memories m ON f.id = m.id
    WHERE memories_fts MATCH ?
  `;
  const conditions: string[] = [];
  const params: unknown[] = [terms];

  // Exclude tombstoned rows if column exists
  try {
    const cols = db.query<{ name: string }>(`PRAGMA table_info(memories)`).all().map((c) => c.name);
    if (cols.includes("deleted_at")) {
      conditions.push(`(m.deleted_at IS NULL OR m.deleted_at = '')`);
    }
  } catch {}

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

  // Hidden-count-aware over-fetch: if limit is requested and superseded rows should be filtered out,
  // query an over-fetch buffer so active results fill the requested limit.
  const targetLimit = filters?.limit;
  if (targetLimit) {
    const shouldOverfetch = filters?.overfetch !== false && !filters?.includeSuperseded && !filters?.status;
    const fetchLimit = shouldOverfetch ? Math.min(500, Math.max(targetLimit * 2, targetLimit + 10)) : targetLimit;
    sql += ` LIMIT ?`;
    params.push(fetchLimit);
  }

  try {
    const rows = db.query<DbMemoryRow & { rank: number }>(sql).all(params);
    let hidden_count = 0;
    const activeHits: FtsSearchHit[] = [];

    for (const r of rows) {
      const entry = rowToMemoryEntry(r);
      if (!filters?.includeSuperseded && !filters?.status && (entry.status === "superseded" || entry.status === "rejected")) {
        hidden_count++;
        continue;
      }
      activeHits.push({ entry, rank: r.rank });
    }

    const finalHits = targetLimit ? activeHits.slice(0, targetLimit) : activeHits;
    const results: FtsSearchHits = finalHits as FtsSearchHits;
    results.degraded = false;
    results.hidden_count = hidden_count;
    return results;
  } catch (err) {
    // T-312: Surface FTS failure with loud log and degraded: true signal instead of silent swallow
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[FTS5_DEGRADED] FTS query execution failed for "${query}": ${errorMsg}`);
    const empty: FtsSearchHits = [];
    empty.degraded = true;
    empty.error = errorMsg;
    empty.hidden_count = 0;
    return empty;
  }
}

// ---------------------------------------------------------------------------
// T-086: keep-both conflicts table (never delete)
// ---------------------------------------------------------------------------

export interface DbConflictRow {
  id: string;
  memory_a_id: string;
  memory_b_id: string;
  status: string;
  conflict_type: string;
  confidence: number;
  reason: string | null;
  detected_at: string;
  resolved_at: string | null;
  resolution_strategy: string | null;
  resolved_by: string | null;
  data: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConflictRecord {
  id: string;
  memory_a_id: string;
  memory_b_id: string;
  status: "open" | "resolved" | "acknowledged";
  conflict_type: string;
  confidence: number;
  reason?: string;
  detected_at: string;
  resolved_at?: string;
  resolution_strategy?: string;
  resolved_by?: string;
  data?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

function rowToConflictRecord(row: DbConflictRow): ConflictRecord {
  let parsedData: Record<string, any> | undefined;
  if (row.data) {
    try {
      parsedData = JSON.parse(row.data);
    } catch {}
  }
  return {
    id: row.id,
    memory_a_id: row.memory_a_id,
    memory_b_id: row.memory_b_id,
    status: row.status as "open" | "resolved" | "acknowledged",
    conflict_type: row.conflict_type,
    confidence: row.confidence,
    reason: row.reason ?? undefined,
    detected_at: row.detected_at,
    resolved_at: row.resolved_at ?? undefined,
    resolution_strategy: row.resolution_strategy ?? undefined,
    resolved_by: row.resolved_by ?? undefined,
    data: parsedData,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function insertOrUpdateConflict(db: SqliteDatabase, conflict: ConflictRecord): void {
  const existing = getConflictById(db, conflict.id);
  const now = new Date().toISOString();
  if (existing) {
    db.run(
      `UPDATE conflicts SET
        status = ?,
        conflict_type = ?,
        confidence = ?,
        reason = ?,
        resolved_at = ?,
        resolution_strategy = ?,
        resolved_by = ?,
        data = ?,
        updated_at = ?
       WHERE id = ?`,
      [
        conflict.status,
        conflict.conflict_type,
        conflict.confidence,
        conflict.reason ?? null,
        conflict.resolved_at ?? null,
        conflict.resolution_strategy ?? null,
        conflict.resolved_by ?? null,
        conflict.data ? JSON.stringify(conflict.data) : null,
        conflict.updated_at || now,
        conflict.id,
      ]
    );
  } else {
    db.run(
      `INSERT INTO conflicts (
        id, memory_a_id, memory_b_id, status, conflict_type, confidence,
        reason, detected_at, resolved_at, resolution_strategy, resolved_by,
        data, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        conflict.id,
        conflict.memory_a_id,
        conflict.memory_b_id,
        conflict.status,
        conflict.conflict_type,
        conflict.confidence,
        conflict.reason ?? null,
        conflict.detected_at,
        conflict.resolved_at ?? null,
        conflict.resolution_strategy ?? null,
        conflict.resolved_by ?? null,
        conflict.data ? JSON.stringify(conflict.data) : null,
        conflict.created_at || now,
        conflict.updated_at || now,
      ]
    );
  }
}

export function getConflictById(db: SqliteDatabase, id: string): ConflictRecord | null {
  const row = db.query<DbConflictRow>(`SELECT * FROM conflicts WHERE id = ?`).get([id]);
  if (!row) return null;
  return rowToConflictRecord(row);
}

export function findConflictBetween(
  db: SqliteDatabase,
  memoryA: string,
  memoryB: string,
): ConflictRecord | null {
  const row = db
    .query<DbConflictRow>(
      `SELECT * FROM conflicts
       WHERE (memory_a_id = ? AND memory_b_id = ?)
          OR (memory_a_id = ? AND memory_b_id = ?)
       ORDER BY detected_at DESC
       LIMIT 1`,
    )
    .get([memoryA, memoryB, memoryB, memoryA]);
  if (!row) return null;
  return rowToConflictRecord(row);
}

export function listConflictsFromDb(
  db: SqliteDatabase,
  options?: { status?: string; memoryId?: string; limit?: number },
): ConflictRecord[] {
  let sql = `SELECT * FROM conflicts`;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options?.status) {
    conditions.push(`status = ?`);
    params.push(options.status);
  }
  if (options?.memoryId) {
    conditions.push(`(memory_a_id = ? OR memory_b_id = ?)`);
    params.push(options.memoryId, options.memoryId);
  }
  if (conditions.length > 0) {
    sql += ` WHERE ` + conditions.join(" AND ");
  }
  sql += ` ORDER BY detected_at DESC`;
  if (options?.limit && options.limit > 0) {
    sql += ` LIMIT ?`;
    params.push(options.limit);
  }

  const rows = db.query<DbConflictRow>(sql).all(params);
  return rows.map(rowToConflictRecord);
}

