/**
 * Issue #497 — sqlite-vec `vec0` storage for the local trigram embedding index.
 *
 * Before this module, `hybridSearch` read a whole-file `.memory/index.json` and
 * `save()` rewrote it on every write (read-modify-write of every vector in the
 * store for one changed row). The index now lives in a `vec0` virtual table
 * inside the same SQLite file the store already owns, so a save is one row
 * write and a search is a KNN query.
 *
 * The extension is optional on purpose. The published package runs on platforms
 * where `sqlite-vec` may not be installed or where loading a native extension is
 * forbidden; when the load throws, `getVecIndex()` returns null once, logs once,
 * and every caller keeps the JSON/cosine path that shipped before this change.
 */
import type { SqliteDatabase } from "../sqlite.ts";

/** Table holding the embeddings. `rowid` is the memory id via the text primary key. */
export const VEC_TABLE = "memory_vec";
/** Small key/value sidecar: backfill bookkeeping that must survive process restarts. */
export const VEC_META_TABLE = "memory_vec_meta";

/** How the extension loader behaves. `disabled` is the test/no-extension switch. */
export type VecLoaderMode = "auto" | "disabled";

let loaderMode: VecLoaderMode = "auto";
let unavailableLogged = false;

export interface VecIndex {
  db: SqliteDatabase;
  dims: number;
  table: string;
}

/**
 * Test/opt-out hook: force the JSON fallback without uninstalling the package.
 * Handles are cached per connection *and* per mode, so flipping the mode takes
 * effect immediately (see `getVecIndex`).
 */
export function setVecLoaderMode(mode: VecLoaderMode): void {
  loaderMode = mode;
}

export function getVecLoaderMode(): VecLoaderMode {
  return loaderMode;
}

/** Reset the once-only failure log (tests only). */
export function resetVecUnavailableLog(): void {
  unavailableLogged = false;
}

const handleCache = new WeakMap<SqliteDatabase, { mode: VecLoaderMode; index: VecIndex | null }>();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function logUnavailable(reason: string): void {
  if (unavailableLogged) return;
  unavailableLogged = true;
  console.error(
    `[VEC0_UNAVAILABLE] ${reason.replace(/[\u0000-\u001f\u007f-\u009f]/g, "")} — vector search falls back to the index.json cosine scan`,
  );
}

function loadablePath(): string | null {
  try {
    const mod = require("sqlite-vec") as { getLoadablePath?: () => string };
    return typeof mod?.getLoadablePath === "function" ? mod.getLoadablePath() : null;
  } catch {
    return null;
  }
}

/**
 * Resolve (and lazily create) the vec0 index for a connection.
 * Returns null when the extension is unavailable or the table cannot be made —
 * never throws, so a store stays usable on every platform.
 */
export function getVecIndex(db: SqliteDatabase | null | undefined, dims: number): VecIndex | null {
  if (!db) return null;
  const cached = handleCache.get(db);
  if (cached && cached.mode === loaderMode) return cached.index;

  let index: VecIndex | null = null;
  if (loaderMode === "auto") {
    index = openVecIndex(db, dims);
  }
  handleCache.set(db, { mode: loaderMode, index });
  return index;
}

function openVecIndex(db: SqliteDatabase, dims: number): VecIndex | null {
  if (typeof db.loadExtension !== "function") {
    logUnavailable("this SQLite driver cannot load extensions");
    return null;
  }
  const path = loadablePath();
  if (!path) {
    logUnavailable("the sqlite-vec package is not installed");
    return null;
  }
  try {
    db.loadExtension(path);
  } catch (err) {
    // Restricted runtime, missing shared object, wrong architecture — the JSON
    // index is the functional fallback, so this is a warning, not a crash.
    logUnavailable(`sqlite-vec failed to load (${errorMessage(err)})`);
    return null;
  }

  try {
    // Vectors are derived data: a table built for a different dimension is
    // dropped and rebuilt rather than silently failing every insert later.
    const existing = db
      .query<{ sql: string | null }>(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get([VEC_TABLE]);
    if (existing?.sql && !existing.sql.includes(`float[${dims}]`)) {
      db.exec(`DROP TABLE IF EXISTS ${VEC_TABLE}`);
    }
    db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${VEC_TABLE} USING vec0(memory_id text primary key, embedding float[${dims}] distance_metric=cosine)`,
    );
    db.exec(`CREATE TABLE IF NOT EXISTS ${VEC_META_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  } catch (err) {
    logUnavailable(`vec0 table creation failed (${errorMessage(err)})`);
    return null;
  }

  return { db, dims, table: VEC_TABLE };
}

/** Float32 little-endian blob — the only vector form sqlite-vec accepts. */
export function toVecBlob(vector: ArrayLike<number>): Uint8Array {
  const floats = vector instanceof Float32Array ? vector : Float32Array.from(vector as ArrayLike<number>);
  return new Uint8Array(new Float32Array(floats).buffer);
}

export function vecCount(index: VecIndex): number {
  try {
    const row = index.db.query<{ c: number }>(`SELECT count(*) AS c FROM ${index.table}`).get();
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

export function vecHas(index: VecIndex, id: string): boolean {
  try {
    return Boolean(
      index.db.query<{ memory_id: string }>(`SELECT memory_id FROM ${index.table} WHERE memory_id = ? LIMIT 1`).get([id]),
    );
  } catch {
    return false;
  }
}

/** Upsert one row. vec0 has no INSERT OR REPLACE on the primary key. */
export function vecUpsert(index: VecIndex, id: string, vector: ArrayLike<number>): boolean {
  try {
    const blob = toVecBlob(vector);
    if (vecHas(index, id)) {
      index.db.run(`UPDATE ${index.table} SET embedding = ? WHERE memory_id = ?`, [blob, id]);
    } else {
      index.db.run(`INSERT INTO ${index.table}(memory_id, embedding) VALUES (?, ?)`, [id, blob]);
    }
    return true;
  } catch {
    return false;
  }
}

export function vecDelete(index: VecIndex, id: string): boolean {
  try {
    index.db.run(`DELETE FROM ${index.table} WHERE memory_id = ?`, [id]);
    return true;
  } catch {
    return false;
  }
}

/** SQL predicate for "this vector's memory is gone". */
const ORPHAN_PREDICATE = `memory_id NOT IN (SELECT id FROM memories WHERE deleted_at IS NULL)`;

/**
 * Issue #519 — delete every `memory_vec` row whose `memory_id` has no live row
 * in `memories` (`deleted_at IS NULL`).
 *
 * `deleteEntry` removes the vector row itself, but three other paths leave an
 * **orphan vector**: a crash between the `memories` write and the vec delete (two
 * statements, no shared transaction), a restored YAML export (the row comes back
 * through `save()`, the tombstone does not), and a store written by an older
 * build that predates the vec0 table. An orphan is still returned by the KNN,
 * then dropped by the row fetch in `scoreVecCandidates`, which silently shrinks
 * the page — a caller asking for 10 gets 9 results with no explanation.
 *
 * Guarded twice: a null index means the extension never loaded (the JSON
 * fallback owns the index and has no orphans), and the `memories` table must
 * exist before the subquery is legal. The count is read before the delete so
 * this can report what it removed — `SqliteDatabase.run()` reports nothing, and
 * the caller logs the number.
 *
 * Never throws: reconciliation is housekeeping on a read path, so a failure is
 * logged and the store keeps working with the orphans in place.
 */
export function reconcileVecIndex(index: VecIndex | null | undefined): number {
  if (!index) return 0;
  try {
    const memoriesTable = index.db
      .query<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memories' LIMIT 1`)
      .get();
    if (!memoriesTable) return 0;
    const counted = index.db
      .query<{ c: number }>(`SELECT count(*) AS c FROM ${index.table} WHERE ${ORPHAN_PREDICATE}`)
      .get();
    const orphans = Number(counted?.c ?? 0);
    if (orphans <= 0) return 0;
    index.db.run(`DELETE FROM ${index.table} WHERE ${ORPHAN_PREDICATE}`);
    return orphans;
  } catch (err) {
    console.error(
      `[VEC0_RECONCILE_FAILED] ${errorMessage(err).replace(/[\u0000-\u001f\u007f-\u009f]/g, "")} — orphan vectors stay until the next attempt`,
    );
    return 0;
  }
}

/**
 * Issue #519 — run `reconcileVecIndex` **once per connection** ("store open"),
 * before that connection's first KNN. A WeakMap keyed on the database handle
 * means a reopened store reconciles again; a process that only searches once
 * still pays for it exactly once, not per query.
 */
const reconciledConnections = new WeakSet<SqliteDatabase>();

function ensureVecReconciled(index: VecIndex): number {
  if (reconciledConnections.has(index.db)) return 0;
  reconciledConnections.add(index.db);
  return reconcileVecIndex(index);
}

/**
 * Batch upsert inside a SAVEPOINT: a backfill of a large store is one commit
 * instead of one fsync per row, and it nests safely inside a caller's
 * transaction (save() and the read paths may already hold one).
 */
export function vecUpsertMany(index: VecIndex, rows: { id: string; vector: ArrayLike<number> }[]): number {
  let written = 0;
  try {
    index.db.exec("SAVEPOINT vec_bulk_upsert");
  } catch {
    for (const row of rows) if (vecUpsert(index, row.id, row.vector)) written++;
    return written;
  }
  try {
    for (const row of rows) if (vecUpsert(index, row.id, row.vector)) written++;
    index.db.exec("RELEASE vec_bulk_upsert");
  } catch {
    try {
      index.db.exec("ROLLBACK TO vec_bulk_upsert");
      index.db.exec("RELEASE vec_bulk_upsert");
    } catch {}
  }
  return written;
}

export interface VecKnnHit {
  id: string;
  /** Cosine distance in [0, 2]; cosine similarity is `1 - distance`. */
  distance: number;
}

/** KNN over the vec0 table, nearest first. */
export function vecKnn(index: VecIndex, query: ArrayLike<number>, k: number): VecKnnHit[] {
  const limit = Math.max(0, Math.floor(k));
  if (limit === 0) return [];
  // Issue #519: this is the first KNN of this connection, so this is the last
  // moment an orphan can still reach a caller and shrink its page. The call is
  // once-per-connection and swallows its own failures, so a search never fails
  // because housekeeping did.
  ensureVecReconciled(index);
  try {
    const rows = index.db
      .query<{ memory_id: string; distance: number }>(
        `SELECT memory_id, distance FROM ${index.table} WHERE embedding MATCH ? AND k = ? ORDER BY distance`,
      )
      .all([toVecBlob(query), limit]);
    return rows.map((row) => ({ id: row.memory_id, distance: Number(row.distance) }));
  } catch {
    return [];
  }
}

export function vecMetaGet(index: VecIndex, key: string): string | null {
  try {
    const row = index.db
      .query<{ value: string }>(`SELECT value FROM ${VEC_META_TABLE} WHERE key = ? LIMIT 1`)
      .get([key]);
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export function vecMetaSet(index: VecIndex, key: string, value: string): void {
  try {
    index.db.run(
      `INSERT INTO ${VEC_META_TABLE}(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  } catch {}
}
