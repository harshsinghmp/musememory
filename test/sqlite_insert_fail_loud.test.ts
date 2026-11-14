import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { insertOrReplaceMemory, type SqliteDatabase } from "../src/sqlite.ts";
import type { MemoryEntry } from "../src/types.ts";

/** Wrap a raw bun:sqlite handle in the engine's SqliteDatabase adapter. */
function adapt(raw: Database): SqliteDatabase {
  return {
    exec: (sql: string) => raw.exec(sql),
    run: (sql: string, params?: unknown[] | Record<string, unknown>) => {
      if (params === undefined) raw.run(sql);
      else raw.run(sql, params as any);
    },
    query<T = unknown>(sql: string) {
      const stmt = raw.query(sql);
      return {
        all(params?: unknown[] | Record<string, unknown>): T[] {
          return (params === undefined ? stmt.all() : stmt.all(params as any)) as T[];
        },
        get(params?: unknown[] | Record<string, unknown>): T | null | undefined {
          return (params === undefined ? stmt.get() : stmt.get(params as any)) as T;
        },
      };
    },
    close: () => raw.close(),
  };
}

describe("issue #410: insertOrReplaceMemory fails loudly on a broken table shape", () => {
  let tempDir: string;
  let raw: Database;
  let db: SqliteDatabase;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "muse-insert-fail-loud-"));
    raw = new Database(join(tempDir, "v0.db"));
    // Deliberately pre-migration (v0) shape. The removed "legacy" retry re-listed
    // mem_path / last_accessed_at / access_count, which this shape does not have, so
    // its error — not the primary INSERT's — was the one that escaped.
    raw.exec(`
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
    `);
    db = adapt(raw);
  });

  afterEach(() => {
    try {
      raw.close();
    } catch {}
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("surfaces the real missing-column error instead of a swallowed legacy retry", () => {
    const now = new Date().toISOString();
    const entry: MemoryEntry = {
      id: "m_broken_shape",
      title: "Broken Shape",
      content: "body",
      project: "p",
      type: "discovery",
      status: "confirmed",
      created_at: now,
      updated_at: now,
    };

    // The primary INSERT names `valid_to_exact`; that is the column this shape lacks
    // first, so it is the error a caller must see.
    expect(() => insertOrReplaceMemory(db, entry)).toThrow(/no column named valid_to_exact/);
  });
});
