import { resolve } from "node:path";
import { readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { MemoryEntry, MemoryType, Verification, GraphMetadata, TrustTier } from "./types.ts";
import { scanSecrets, redactSecrets } from "./secrets.ts";
import { recordAuditEvent, getAuditTrail } from "./audit.ts";
import { getCurrent, setCurrent, syncConstraints } from "./current.ts";
import { autoCompileWiki } from "./wiki/compiler.ts";
import { extractHarvestUnits } from "./harvest.ts";
import { autoStampGraphMetadata } from "./graph.ts";
import { workspaceRootFor } from "./root.ts";
import { loadSources } from "./provenance.ts";
import {
  openDatabase,
  insertOrReplaceMemory,
  getMemoryById,
  getMemoryByIdempotencyKey,
  getMemoryByContentHash,
  listMemories,
  searchMemoriesFts,
  type SqliteDatabase,
  type FtsSearchHits,
} from "./sqlite.ts";
import { runMigrations } from "./migrate.ts";
import { getOrCreateStoreCache, type MemoryStoreCache } from "./cache.ts";
import { initEmbedTables } from "./retrieval/embedders.ts";
import {
  computeFingerprint,
  computeContentHash,
  inferTemporalMode,
  determineQuality,
  ensureUtility,
  findDuplicates,
  consolidateIntoCanonical,
  detectConflict,
  flagConflict,
  resolveConflict,
  calculateRetentionScore,
  listConflicts,
  getConflict,
  recordConflict,
  type ConflictRecord,
  evaluateScopedInvalidation,
  extractFactTriples,
  evaluateScopedAlignment,
  type SemanticFactTriple,
  type ScopedInvalidationResult,
} from "./quality/index.ts";
export {
  detectConflict,
  flagConflict,
  resolveConflict,
  listConflicts,
  getConflict,
  recordConflict,
  type ConflictRecord,
  evaluateScopedInvalidation,
  extractFactTriples,
  evaluateScopedAlignment,
  type SemanticFactTriple,
  type ScopedInvalidationResult,
};
import {
  initiateFederationHandshake,
  processFederationHandshake,
  getConflictDedupKey,
  computeConflictsChecksum,
  type FederationHandshakePacket,
  type FederationHandshakeResult,
} from "./sync/index.ts";
export {
  initiateFederationHandshake,
  processFederationHandshake,
  getConflictDedupKey,
  computeConflictsChecksum,
  type FederationHandshakePacket,
  type FederationHandshakeResult,
};
import { recoverStaleLocks } from "./outbox.ts";
export * from "./outbox.ts";
import { withStoreLock, acquireStoreLock, releaseStoreLock, StoreLockError } from "./lock.ts";
export { withStoreLock, acquireStoreLock, releaseStoreLock, StoreLockError };
import { getStoreCircuitBreaker, CircuitBreaker } from "./circuit.ts";
export { getStoreCircuitBreaker, CircuitBreaker };
import {
  computeDecayScore,
  computeDefaultExpiresAt,
  loadExpiryPolicyYaml,
  evaluateExpiryPolicy,
  applyExpiryPolicy,
  parseExpiryPolicyYaml,
} from "./retention.ts";
export {
  loadExpiryPolicyYaml,
  parseExpiryPolicyYaml,
  evaluateExpiryPolicy,
  applyExpiryPolicy,
};
import { registerWriteWorker, drainWriteWorkers } from "./async_workers.ts";
export { registerWriteWorker, drainWriteWorkers };
import { touchActivity } from "./optimize.ts";
import type { TemporalMode, MemoryQuality, MemoryUtility, EvidenceItem } from "./types.ts";

export interface StorageLayoutOptions {
  /** T-153: Optional tenant / member ID for per-tenant SQLite DB files (e.g. 'alice' -> 'tenant_alice.db') */
  tenantId?: string;
  /** T-153: Direct database filename or path override (e.g. 'custom.db') */
  dbName?: string;
  /** T-153: Designate as shared team store (uses 'team.db') */
  isTeam?: boolean;
}

/**
 * T-153: Map tenant options to target database filename.
 * Defaults to 'memory.db', team mode to 'team.db', and tenants to 'tenant_<id>.db'.
 */
export function resolveDbFilename(options?: StorageLayoutOptions): string {
  if (options?.dbName) {
    const raw = options.dbName.trim();
    return raw.endsWith(".db") ? raw : `${raw}.db`;
  }
  if (options?.isTeam) {
    return "team.db";
  }
  if (options?.tenantId) {
    const raw = options.tenantId.trim();
    if (raw === "team") return "team.db";
    return raw.startsWith("tenant_") ? (raw.endsWith(".db") ? raw : `${raw}.db`) : `tenant_${raw}.db`;
  }
  const envTenant = process.env.MUSE_TENANT_ID || process.env.MUSE_TENANT;
  if (envTenant) {
    const raw = envTenant.trim();
    if (raw === "team") return "team.db";
    return raw.startsWith("tenant_") ? (raw.endsWith(".db") ? raw : `${raw}.db`) : `tenant_${raw}.db`;
  }
  return "memory.db";
}

export interface StorageLayout {
  root: string;
  memoryDir: string;
  memoriesDir: string;
  dbPath: string;
  currentMd: string;
  userMd: string;
  auditJsonl: string;
  /** T-153: Active tenant or team identifier if operating in multi-DB mode. */
  tenantId?: string;
}

export function getStorageLayout(memoryDir: string, options?: StorageLayoutOptions): StorageLayout {
  const dbFile = resolveDbFilename(options);
  const tenantId = options?.tenantId ?? (options?.isTeam ? "team" : undefined);
  const tenantSuffix = tenantId && tenantId !== "team" ? `_${tenantId.replace(/^tenant_/, "")}` : "";
  const memoriesDir =
    tenantId && tenantId !== "team"
      ? join(memoryDir, `memories${tenantSuffix}`)
      : join(memoryDir, "memories");

  return {
    root: workspaceRootFor(memoryDir),
    memoryDir,
    memoriesDir,
    dbPath: join(memoryDir, dbFile),
    currentMd: join(memoryDir, "CURRENT.md"),
    userMd: join(memoryDir, "USER.md"),
    auditJsonl: join(memoryDir, tenantId ? `audit${tenantSuffix}.jsonl` : "audit.jsonl"),
    tenantId,
  };
}

export interface StoreOptions extends StorageLayoutOptions {
  /** T-023: Skip syncing working constraints on open (e.g. read-only operations). */
  skipSyncConstraints?: boolean;
  /** T-023: Skip automatic wiki re-compilation on open. */
  skipAutoWiki?: boolean;
}

export interface Store {
  dir: string;
  memoryDir?: string;
  layout?: StorageLayout;
  db?: SqliteDatabase;
  cache?: MemoryStoreCache;
  circuit?: CircuitBreaker;
  tenantId?: string;
}

export class IdempotencyConflictError extends Error {
  constructor(
    public readonly idempotencyKey: string,
    public readonly existingEntryId: string,
    message?: string,
  ) {
    super(
      message ||
        `Idempotency conflict: key '${idempotencyKey}' already used with divergent content for memory '${existingEntryId}'`,
    );
    this.name = "IdempotencyConflictError";
  }
}

// --- T-030: tombstone marker ------------------------------------------------------
// Shape: two nullable columns on `memories`, `deleted_at` / `deleted_by` (migration v2).
// NULL = live. Set = soft-deleted: the row, its YAML mirror and its audit event all survive,
// and only the read paths stop surfacing it. Deliberately NOT an entry field, so a tombstoned
// row cannot leak the marker into schema.json validation or the YAML/JSON export shape.

/** Ids carrying a tombstone marker. Empty without a SQLite primary (nothing can be tombstoned). */
function tombstonedIds(store: Store): Set<string> {
  if (!store.db) return new Set();
  try {
    return new Set(
      store.db
        .query<{ id: string }>(`SELECT id FROM memories WHERE deleted_at IS NOT NULL`)
        .all()
        .map((r) => r.id),
    );
  } catch {
    return new Set();
  }
}

export function isTombstoned(store: Store, id: string): boolean {
  if (!store.db) return false;
  try {
    const row = store.db
      .query<{ c: number }>(`SELECT count(*) AS c FROM memories WHERE id = ? AND deleted_at IS NOT NULL`)
      .get([id]);
    return (row?.c ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Write or clear the marker. Must run AFTER `save()` in the same transaction: INSERT OR
 * REPLACE rewrites the row and drops any column the writer does not know about.
 */
function setTombstone(store: Store, id: string, marker: { at: string; by: string } | null): void {
  if (!store.db) return;
  store.db.run(
    marker
      ? `UPDATE memories SET deleted_at = ?, deleted_by = ? WHERE id = ?`
      : `UPDATE memories SET deleted_at = NULL, deleted_by = NULL WHERE id = ?`,
    marker ? [marker.at, marker.by, id] : [id],
  );
}

const openWriteTx = new WeakSet<SqliteDatabase>();

/**
 * T-025: run a multi-statement write path as one SQLite commit instead of one commit
 * per statement. Re-entrant per connection — a nested call (get() inside list()) or a
 * caller-owned transaction (optimizeStore, health/reconcile) is joined, not restarted.
 */
function withTransaction<T>(db: SqliteDatabase | undefined, fn: () => T): T {
  if (!db || openWriteTx.has(db)) return fn();
  let began = false;
  openWriteTx.add(db);
  try {
    try {
      db.exec("BEGIN IMMEDIATE");
      began = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/within a transaction/i.test(msg)) throw err;
      began = false; // a transaction is already open on this connection — join it
    }
    const out = fn();
    if (began) db.exec("COMMIT");
    return out;
  } catch (err) {
    if (began) {
      try {
        db.exec("ROLLBACK");
      } catch {}
    }
    throw err;
  } finally {
    openWriteTx.delete(db);
  }
}

/**
 * T-020: SQLite's total change counter moves on every committed write, including
 * writes that never touch the memories directory. Used as the query-cache write
 * generation so a cached result is never served after a write.
 */
function dbWriteGeneration(db: SqliteDatabase | undefined): number | undefined {
  if (!db) return undefined;
  try {
    return db.query<{ t: number }>(`SELECT total_changes() AS t`).get()?.t;
  } catch {
    return undefined;
  }
}

function getStoreMemoriesFingerprint(store: Store): string {
  if (store.db) {
    try {
      const row = store.db.query<{ count: number; max_up: string }>(
        `SELECT count(*) AS count, coalesce(max(updated_at), '') AS max_up FROM memories`
      ).get();
      if (row) return `${row.count}:${row.max_up}`;
    } catch {}
  }
  if (existsSync(store.dir)) {
    try {
      return `dir:${statSync(store.dir).mtimeMs}`;
    } catch {}
  }
  return "none";
}

interface StoreDirtyState {
  lastWikiFingerprint?: string;
  lastConstraintsFingerprint?: string;
  lastConstraintsMtimeMs?: number;
}

const storeDirtyStateRegistry = new Map<string, StoreDirtyState>();

/**
 * Resets the in-process dirty gate state for a memory directory (or all directories).
 * Useful for test isolation or forced recompilation.
 */
export function resetStoreDirtyState(memoryDir?: string): void {
  if (memoryDir) {
    for (const key of storeDirtyStateRegistry.keys()) {
      if (key === memoryDir || key.startsWith(memoryDir)) {
        storeDirtyStateRegistry.delete(key);
      }
    }
  } else {
    storeDirtyStateRegistry.clear();
  }
}

/**
 * Open the memories directory & SQLite primary database for a memory dir, creating it if missing.
 * T-153: Supports multi-DB topologies (e.g. options.tenantId, options.isTeam, options.dbName).
 */
export function openStore(memoryDir: string, options?: StoreOptions): Store {
  const layout = getStorageLayout(memoryDir, options);
  mkdirSync(layout.memoriesDir, { recursive: true });
  mkdirSync(memoryDir, { recursive: true });

  let db: SqliteDatabase | undefined;
  try {
    const opened = openDatabase(layout.dbPath);
    // T-368: additive ALTERs for stores created by an older build. No rollback code —
    // the YAML mirror (which openStore rehydrates into SQLite below) is the rollback.
    runMigrations(opened);
    // T-042: Stale-lock recovery sweep on store open (300s expiration)
    try {
      recoverStaleLocks(opened, 300);
    } catch {}
    db = opened;
  } catch (err) {
    // If SQLite initialization fails on unusual environment, fallback gracefully
  }

  // T-153: Key cache and circuit breaker by dbPath to isolate per-tenant and team databases
  const cacheKey = layout.dbPath;
  const cache = getOrCreateStoreCache(cacheKey);
  const circuit = getStoreCircuitBreaker(cacheKey);
  const store: Store = {
    dir: layout.memoriesDir,
    memoryDir,
    layout,
    db,
    cache,
    circuit,
    tenantId: layout.tenantId,
  };

  // R21: ensure the embedding vector + pipeline-fingerprint tables exist.
  if (db) {
    try {
      initEmbedTables(db);
    } catch {}
  }

  // Fast startup sync: only sync YAML files into SQLite database if DB is empty or missing entries
  if (db && existsSync(layout.memoriesDir)) {
    try {
      const memCountRow = db.query<{ count: number }>(`SELECT count(*) as count FROM memories`).get();
      const memCount = memCountRow?.count ?? 0;
      if (memCount === 0) {
        const yamlFiles = readdirSync(layout.memoriesDir).filter((f) => f.endsWith(".yaml"));
        // T-025: one commit for the whole rehydrate, not three per entry.
        withTransaction(db, () => {
          for (const f of yamlFiles) {
            const yId = f.slice(0, -5);
            const entry = getFromYaml(store, yId);
            if (entry) {
              insertOrReplaceMemory(db!, entry);
              cache.setEntry(entry);
            }
          }
        });
      }
    } catch {}
  }

  // T-023: Dirty-gated constraint synchronization and wiki compilation
  const dirtyKey = layout.dbPath || memoryDir;
  let dirtyState = storeDirtyStateRegistry.get(dirtyKey);
  if (!dirtyState) {
    dirtyState = {};
    storeDirtyStateRegistry.set(dirtyKey, dirtyState);
  }

  const currentFingerprint = getStoreMemoriesFingerprint(store);

  if (!options?.skipSyncConstraints) {
    const currentMdPath = join(memoryDir, "CURRENT.md");
    const currentMtime = existsSync(currentMdPath) ? statSync(currentMdPath).mtimeMs : 0;
    const isConstraintsClean =
      dirtyState.lastConstraintsFingerprint !== undefined &&
      dirtyState.lastConstraintsFingerprint === currentFingerprint &&
      dirtyState.lastConstraintsMtimeMs === currentMtime;

    if (!isConstraintsClean) {
      try {
        syncConstraints(memoryDir, store);
        dirtyState.lastConstraintsFingerprint = getStoreMemoriesFingerprint(store);
        dirtyState.lastConstraintsMtimeMs = existsSync(currentMdPath) ? statSync(currentMdPath).mtimeMs : 0;
      } catch {}
    }
  }

  if (!options?.skipAutoWiki) {
    const isWikiClean =
      dirtyState.lastWikiFingerprint !== undefined &&
      dirtyState.lastWikiFingerprint === currentFingerprint;

    if (!isWikiClean) {
      try {
        autoCompileWiki(store, memoryDir);
        dirtyState.lastWikiFingerprint = getStoreMemoriesFingerprint(store);
      } catch {}
    }
  }

  return store;
}

/** Append a working constraint to CURRENT.md and record an audit event. */
export function addConstraint(memoryDir: string, text: string, project: string): string[] {
  const updated = setCurrent(memoryDir, text, project);
  recordAuditEvent(memoryDir, {
    operation: "propose",
    entry_id: "CURRENT.md",
    project,
    actor: "agent",
    details: { constraint: text },
  });
  return updated;
}

/** Safe slug from an id: keep [a-z0-9_-], trim leading/trailing dashes and underscores. */
export function slugifyId(id: string): string {
  const slug = id
    .replace(/[^a-z0-9_-]/gi, "")
    .replace(/^[-_]+|[-_]+$/g, "")
    .toLowerCase();
  return slug.length > 0 ? slug : "entry";
}

export function fileForId(store: Store, id: string): string {
  const safeFilename = `${slugifyId(id)}.yaml`;
  const target = resolve(store.dir, safeFilename);
  const base = resolve(store.dir);
  if (!target.startsWith(base)) {
    throw new Error(`Security Violation: Path traversal detected for id "${id}"`);
  }
  return target;
}

export function listIds(store: Store): string[] {
  const ids = new Set<string>();
  if (store.db) {
    for (const e of listMemories(store.db)) {
      ids.add(e.id);
    }
  }
  if (existsSync(store.dir)) {
    for (const f of readdirSync(store.dir)) {
      if (f.endsWith(".yaml")) {
        ids.add(f.slice(0, -5));
      }
    }
  }
  return [...ids];
}

function getFromYaml(store: Store, id: string): MemoryEntry | null {
  const file = fileForId(store, id);
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = yaml.load(raw, { schema: yaml.JSON_SCHEMA });
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as MemoryEntry;
  } catch {
    return null;
  }
}

/** R23: Track access timestamp and count on retrieval (used by retention scoring). */
export function recordAccess(store: Store, entry: MemoryEntry): MemoryEntry {
  const now = nowIso();
  const currentCount = entry.access_count ?? 0;
  entry.last_accessed_at = now;
  entry.access_count = currentCount + 1;
  if (store.db) {
    try {
      store.db.run(
        `UPDATE memories SET last_accessed_at = ?, access_count = ?, updated_at = ? WHERE id = ?`,
        [now, entry.access_count, entry.updated_at, entry.id],
      );
    } catch {}
  }
  return entry;
}

export function get(store: Store, id: string): MemoryEntry | null {
  if (store.circuit?.isDegraded()) {
    return store.cache?.getEntry(id) ?? null;
  }
  // T-030: a tombstoned entry is invisible to reads even though its row and YAML survive.
  if (isTombstoned(store, id)) return null;
  try {
    const entry = readEntry(store, id);
    if (entry) store.circuit?.recordSuccess();
    return entry ? recordAccess(store, entry) : null;
  } catch (err) {
    store.circuit?.recordFailure(err);
    if (store.circuit?.isDegraded()) {
      return store.cache?.getEntry(id) ?? null;
    }
    throw err;
  }
}

/** `get()` minus the tombstone gate and the access bookkeeping: the raw stored entry. */
function readEntry(store: Store, id: string): MemoryEntry | null {
  const file = fileForId(store, id);
  let fileMtime: number | undefined;

  if (existsSync(file)) {
    try {
      fileMtime = statSync(file).mtimeMs;
    } catch {}

    // 1. Check L0 cache if mtime matches
    if (store.cache && fileMtime !== undefined) {
      const cached = store.cache.getEntry(id, fileMtime);
      if (cached) return cached;
    }

    // 2. Parse YAML from disk (either cache miss or externally modified)
    const fromYaml = getFromYaml(store, id);
    if (!fromYaml) {
      // Corrupted or unparseable YAML file
      if (store.cache) store.cache.deleteEntry(id);
      return null;
    }

    if (store.db) {
      // T-025: row + FTS sync in one commit.
      try {
        withTransaction(store.db, () => insertOrReplaceMemory(store.db!, fromYaml));
      } catch {}
    }
    if (store.cache) {
      store.cache.setEntry(fromYaml, undefined, fileMtime);
    }
    return fromYaml;
  }

  // File does not exist on disk, check L0 cache then SQLite
  if (store.cache) {
    const cached = store.cache.getEntry(id);
    if (cached) return cached;
  }
  if (store.db) {
    const dbEntry = getMemoryById(store.db, id);
    if (dbEntry) {
      if (store.cache) store.cache.setEntry(dbEntry);
      return dbEntry;
    }
  }

  return null;
}

export function list(
  store: Store,
  filters?: { project?: string; type?: string; status?: string },
): MemoryEntry[] {
  const cacheKey = filters
    ? `filter:${filters.project || ""}:${filters.type || ""}:${filters.status || ""}`
    : "all";

  let dirMtime: number | undefined;
  if (existsSync(store.dir)) {
    try {
      dirMtime = statSync(store.dir).mtimeMs;
    } catch {}
  }

  // T-055: If circuit breaker is open (degraded mode), return cache without crashing
  if (store.circuit?.isDegraded()) {
    const cached = store.cache?.getQuery(cacheKey, dirMtime);
    return cached ?? [];
  }

  // 1. Check L0 query cache. T-020: the write generation guards against writes the
  // dir mtime cannot see (coarse mtimes, SQLite-only writes).
  if (store.cache) {
    const cached = store.cache.getQuery(cacheKey, dirMtime, dbWriteGeneration(store.db));
    if (cached) return cached;
  }

  // 2. High-speed path: SQLite indexed table (avoids O(N) filesystem stat storm)
  let entries: MemoryEntry[] = [];
  if (store.db) {
    entries = listMemories(store.db, filters);
    // Check if new external YAML files were dropped on disk that are not yet in SQLite
    if (existsSync(store.dir)) {
      const dbIds = new Set(entries.map((e) => e.id));
      const diskFiles = readdirSync(store.dir);
      // T-025: reconcile the whole batch as one commit instead of three per file.
      withTransaction(store.db, () => {
        for (const f of diskFiles) {
          if (f.endsWith(".yaml")) {
            const diskId = f.slice(0, -5);
            if (!dbIds.has(diskId)) {
              const externalEntry = get(store, diskId);
              if (externalEntry) {
                try {
                  insertOrReplaceMemory(store.db!, externalEntry);
                } catch {}
                let matches = true;
                if (filters?.project && externalEntry.project !== filters.project) matches = false;
                if (filters?.type && externalEntry.type !== filters.type) matches = false;
                if (filters?.status && externalEntry.status !== filters.status) matches = false;
                if (matches) entries.push(externalEntry);
              }
            }
          }
        }
      });
    }
  } else {
    // Fallback: file scan if SQLite is unavailable
    const ids = listIds(store);
    entries = ids
      .map((id) => get(store, id))
      .filter((e): e is MemoryEntry => e !== null);

    if (filters?.project) entries = entries.filter((e) => e.project === filters.project);
    if (filters?.type) entries = entries.filter((e) => e.type === filters.type);
    if (filters?.status) entries = entries.filter((e) => e.status === filters.status);
  }

  // T-030: tombstoned rows stay queryable for audit and replay but never surface here, which
  // is also what keeps recall (queryContext), rankAndRetrieveMemories and hybridSearch out.
  const tombstones = tombstonedIds(store);
  if (tombstones.size > 0) entries = entries.filter((e) => !tombstones.has(e.id));

  if (store.cache) {
    for (const e of entries) {
      store.cache.setEntry(e);
    }
    // Cache the query result last: setEntry() invalidates the query cache, so
    // caching it first would self-destruct. Stamped with the post-write generation
    // so results computed before a reconciliation write are never served (T-020).
    store.cache.setQuery(cacheKey, entries, undefined, dirMtime, dbWriteGeneration(store.db));
  }

  return entries;
}

/**
 * T-037: Fast integer count of stored memories without loading, parsing, or allocating all entries.
 */
export function countMemories(store: Store): number {
  if (store.circuit?.isDegraded() && store.cache) {
    return store.cache.size();
  }
  if (store.db) {
    try {
      const row = store.db.query<{ count: number }>(
        `SELECT COUNT(*) as count FROM memories WHERE (deleted_at IS NULL OR deleted_at = '')`,
      ).get();
      if (row && typeof row.count === "number") return row.count;
    } catch {}
  }
  if (store.cache && store.cache.size() > 0) {
    return store.cache.size();
  }
  return list(store).length;
}

/** Helper to extract all scannable text from a memory entry. */
export function extractEntryText(entry: Partial<MemoryEntry>): string {
  const parts: string[] = [
    entry.title ?? "",
    entry.content ?? "",
    ...(entry.tags ?? []),
    entry.verification?.method ?? "",
    entry.verification?.test_command ?? "",
    entry.verification?.test_result ?? "",
    entry.graph?.impact_query ?? "",
    ...(entry.graph?.symbol_names ?? []),
  ];
  return parts.filter(Boolean).join(" ");
}

/** Atomic write: SQLite primary database + dual YAML file sync. Validates secrets before writing. */
export function save(store: Store, entry: MemoryEntry, options: { skipSecretCheck?: boolean; lock?: boolean } = {}): void {
  const doSave = () => {
    if (!options.skipSecretCheck) {
      const textToScan = extractEntryText(entry);
      const secrets = scanSecrets(textToScan);
      if (secrets.length > 0) {
        throw new Error(`Secret detected during save: ${secrets.join(", ")}`);
      }
    }

    // T-074: Ensure decay_score is calculated via importance-gated half-life
    if (entry.decay_score === undefined) {
      entry.decay_score = computeDecayScore(entry);
    }

    // 1. Primary write to SQLite database
    if (store.db) {
      try {
        // T-025: memories row + FTS delete/insert as a single commit.
        withTransaction(store.db, () => insertOrReplaceMemory(store.db!, entry));
        store.circuit?.recordSuccess();
      } catch (err) {
        store.circuit?.recordFailure(err);
        throw err;
      }
    }

    // 2. Dual write to YAML file for exportability
    let mtimeMs: number | undefined;
    try {
      const file = fileForId(store, entry.id);
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, yaml.dump(entry, { lineWidth: 120 }), "utf8");
      renameSync(tmp, file);
      try {
        mtimeMs = statSync(file).mtimeMs;
      } catch {}
    } catch (err: unknown) {
      console.warn(`[WARN] Dual-write YAML failed for memory '${entry.id}':`, err instanceof Error ? err.message : String(err));
    }

    // 3. L0 Cache update with mtime
    if (store.cache) {
      store.cache.setEntry(entry, undefined, mtimeMs);
    }

    // T-304: Incrementally upsert into vector index.json if present
    if (store.memoryDir) {
      try {
        const { upsertIndexEntry } = require("./vector.ts");
        upsertIndexEntry(entry, store.memoryDir);
      } catch {}
    }
  };

  if (options.lock && store.memoryDir) {
    withStoreLock(store.memoryDir, doSave);
  } else {
    doSave();
  }

  // T-029: Touch optimization activity on store writes
  if (store.memoryDir) {
    touchActivity(store.memoryDir);
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

let lastGeneratedTs = 0;
let generatedSeq = 0;

export function makeId(slug: string): string {
  const clean = slugifyId(slug);
  const now = Date.now();
  if (now <= lastGeneratedTs) {
    generatedSeq++;
  } else {
    lastGeneratedTs = now;
    generatedSeq = 0;
  }
  const idTimestamp = generatedSeq === 0 ? String(now) : `${now}${String(generatedSeq).padStart(3, "0")}`;
  return `m_${idTimestamp}_${clean}`;
}

function normalizeIdArray(val: string | string[] | null | undefined): string[] {
  if (!val) return [];
  if (typeof val === "string") return [val];
  return val;
}

/** Bi-temporal close-out: stamp valid_to once and decrement reinforcement. (T-082) */
export function closeOutValidity(entry: MemoryEntry, options?: { valid_to_exact?: boolean; valid_to?: string }): void {
  if (!entry.valid_to) entry.valid_to = options?.valid_to ?? nowIso();
  if (options?.valid_to_exact !== undefined) {
    entry.valid_to_exact = options.valid_to_exact;
  } else if (entry.valid_to_exact === undefined) {
    entry.valid_to_exact = false;
  }
  entry.reinforcement = (entry.reinforcement ?? 0) - 1;
}

/**
 * T-075: Derives provenance trust tier from source or explicit parameter.
 * - trusted: user, human, manual, direct, owner, admin, principal
 * - untrusted: web, external, third-party, unknown, scrape, url, crawler
 * - candidate: agent, transcript, inference, distillation, session, assistant
 */
export function deriveTrustTier(source?: string, explicitTrust?: TrustTier): TrustTier {
  if (explicitTrust) return explicitTrust;
  if (!source) return "candidate";
  const s = source.toLowerCase().trim();
  if (["t1", "trusted", "user", "human", "manual", "direct", "owner", "admin", "principal"].includes(s)) {
    return "trusted";
  }
  if (["t4", "untrusted", "web", "external", "third-party", "unknown", "scrape", "url", "crawler"].includes(s)) {
    return "untrusted";
  }
  return "candidate";
}

/** Create a new entry. Defaults: status candidate, type discovery, verification unverified. */
export function propose(
  store: Store,
  opts: {
    content: string;
    project: string;
    title?: string;
    /** Deterministic id override (content-hash idempotent re-ingest). Must match ^m_[0-9]+_[a-z0-9_-]+$. */
    id?: string;
    tags?: string[];
    source?: string;
    type?: MemoryType;
    confirmed?: boolean;
    verification?: Verification;
    salience?: number;
    validFrom?: string;
    validTo?: string;
    validToExact?: boolean;
    valid_from?: string;
    valid_to?: string;
    valid_to_exact?: boolean;
    /** T-090: Original timestamp of underlying evidence or source document. */
    src_ts?: string;
    srcTs?: string;
    dueAt?: string;
    expiresAt?: string | null;
    due_at?: string;
    expires_at?: string | null;
    createdAt?: string;
    created_at?: string;
    updatedAt?: string;
    updated_at?: string;
    /** T-078 & T-080: Pin status exempting memory from expiration policies. */
    pinned?: boolean;
    /** T-078: Enable automatic per-type default expiration calculation even when type is default. */
    autoExpire?: boolean;
    test_command?: string;
    graph?: GraphMetadata;
    fingerprint?: string;
    temporal_mode?: TemporalMode;
    quality?: MemoryQuality;
    utility?: MemoryUtility;
    evidence?: EvidenceItem[];
    conflict_ids?: string[];
    dedup?: boolean;
    checkConflict?: boolean;
    /** R23: Semantic dotted-path addressing (e.g. "auth.session.jwt-expiry"). */
    mem_path?: string;
    /** T-038: Unique idempotency key to prevent duplicate writes during retries. */
    idempotency_key?: string;
    /** T-040: Normalized content hash for fast SQLite deduplication. */
    content_hash?: string;
    /** T-075: Provenance trust tier override. */
    trust?: TrustTier;
    /** T-104: Skip retention gate for internal migrations or tests. */
    skipRetentionGate?: boolean;
    /** T-391: Citation source IDs referencing sources in sources.json. */
    source_ids?: string[];
    /** T-095: Explicit write-time linked memory IDs. */
    linked_memory_ids?: string[];
    linkedMemoryIds?: string[];
    /** T-095: Whether to auto-seed write-time linked memory IDs if omitted (default: true). */
    autoLink?: boolean;
    session_id?: string;
  },
): MemoryEntry {
  if (!opts.content || !opts.content.trim()) {
    throw new Error("Cannot propose memory entry with empty content");
  }
  if (!opts.project || !opts.project.trim()) {
    throw new Error("Cannot propose memory entry with empty project");
  }

  // T-038 & T-039: Idempotency key handling (retry -> 0 writes; divergent retry -> named conflict)
  if (opts.idempotency_key && store.db) {
    const existing = getMemoryByIdempotencyKey(store.db, opts.idempotency_key);
    if (existing) {
      const incomingHash = opts.content_hash ?? computeContentHash(opts.content);
      const existingHash = existing.content_hash || computeContentHash(existing.content);
      if (existingHash === incomingHash) {
        return existing;
      } else {
        throw new IdempotencyConflictError(opts.idempotency_key, existing.id);
      }
    }
  }

  const title = (opts.title ?? opts.content.slice(0, 120)).slice(0, 120);
  const content_hash = opts.content_hash ?? computeContentHash(opts.content);

  // T-104: Retention admission gate
  const retention = calculateRetentionScore(opts.content, {
    title,
    tags: opts.tags,
    salience: opts.salience,
    type: opts.type,
    confirmed: opts.confirmed,
  });
  if (!opts.skipRetentionGate && !retention.passed) {
    throw new Error(`Retention gate rejected write (score ${retention.score.toFixed(2)} < 0.30): ${retention.reason}`);
  }

  // T-391: Citation grounding validation against live registry
  if (opts.source_ids && opts.source_ids.length > 0) {
    const existingSources = store.memoryDir ? loadSources(store.memoryDir) : [];
    const existingIds = new Set(existingSources.map((s) => s.id));
    for (const srcId of opts.source_ids) {
      if (!existingIds.has(srcId)) {
        throw new Error(`Grounding failure: unknown source_id "${srcId}" in memory citation`);
      }
    }
  }

  // Deduplication check: consolidate into canonical memory if exact duplicate exists (T-040)
  if (opts.dedup) {
    if (store.db) {
      const dupe = getMemoryByContentHash(store.db, content_hash, opts.project);
      if (dupe) {
        return consolidateIntoCanonical(store, dupe.id, {
          source: opts.source,
          evidence: opts.evidence?.[0],
        });
      }
    }
    const dupes = findDuplicates(store, { title, content: opts.content, project: opts.project });
    if (dupes.exact) {
      return consolidateIntoCanonical(store, dupes.exact.id, {
        source: opts.source,
        evidence: opts.evidence?.[0],
      });
    }
  }

  const secrets = scanSecrets(
    extractEntryText({
      title,
      content: opts.content,
      tags: opts.tags,
      verification: opts.verification,
    }),
  );
  if (secrets.length > 0) {
    throw new Error(`Probable secret detected: ${secrets.join(", ")}`);
  }

  const now = nowIso();
  const createdAt = opts.createdAt ?? opts.created_at ?? now;
  const updatedAt = opts.updatedAt ?? opts.updated_at ?? now;
  const fingerprint = opts.fingerprint ?? computeFingerprint(title, opts.content);
  const temporal_mode = opts.temporal_mode ?? inferTemporalMode(title, opts.content, opts.type);
  const trust = deriveTrustTier(opts.source, opts.trust);

  // T-090: src_ts evidence-age stamping (derive from explicit option or evidence items)
  let src_ts = opts.src_ts ?? opts.srcTs;
  if (!src_ts && opts.evidence && opts.evidence.length > 0) {
    for (const ev of opts.evidence) {
      const evTs = (ev as any).timestamp || (ev as any).ts || (ev as any).created_at || (ev as any).date;
      if (evTs) {
        src_ts = evTs;
        break;
      }
    }
  }

  // T-078 & T-080: Expiry & Pinning Policy evaluation (first-match-wins)
  // Explicit overrides (string) win; explicit null opts out; pinned/timeless exempt.
  let pinned = opts.pinned;
  let expires_at: string | undefined;

  if (opts.expiresAt !== undefined || opts.expires_at !== undefined) {
    const rawExpiry = opts.expiresAt ?? opts.expires_at;
    expires_at = rawExpiry === null ? undefined : rawExpiry;
  } else {
    // T-080: Check for declarative expiry.yaml in store.memoryDir
    if (!pinned && store.memoryDir) {
      const customPolicy = loadExpiryPolicyYaml(store.memoryDir);
      if (customPolicy) {
        const candidateEntry: any = {
          title,
          content: opts.content,
          project: opts.project,
          type: opts.type ?? "discovery",
          tags: opts.tags ?? [],
          trust,
          temporal_mode,
          created_at: createdAt,
          pinned,
        };
        const match = evaluateExpiryPolicy(candidateEntry, customPolicy, Date.now());
        if (match) {
          if (match.pinned) pinned = true;
          if (match.expires_at) expires_at = match.expires_at;
        }
      }
    }

    if (!pinned && temporal_mode !== "timeless" && expires_at === undefined && (opts.type !== undefined || opts.autoExpire === true)) {
      expires_at = computeDefaultExpiresAt(opts.type ?? "discovery", createdAt);
    }
  }

  // T-095: linked_memory_ids write-time edges seeded during capture (mem0 pattern)
  let linked_memory_ids: string[] = [];
  if (Array.isArray(opts.linked_memory_ids) || Array.isArray(opts.linkedMemoryIds)) {
    const rawIds = (opts.linked_memory_ids ?? opts.linkedMemoryIds ?? []).map(String).filter(Boolean);
    linked_memory_ids = Array.from(new Set(rawIds)).slice(0, 10);
  } else if (opts.autoLink !== false) {
    if (store.db) {
      try {
        const recentRows = store.db.query<{ id: string; title: string; tags: string; session_id: string | null }>(`
          SELECT id, title, COALESCE(json_extract(data, '$.tags'), '') as tags, session_id
          FROM memories
          WHERE project = ? AND status NOT IN ('superseded', 'expired', 'rejected') AND (deleted_at IS NULL)
          ORDER BY updated_at DESC
          LIMIT 10
        `).all([opts.project]);

        const scoredCandidates: { id: string; score: number }[] = [];
        const incomingTags = new Set((opts.tags ?? []).map((t) => t.toLowerCase()));
        const incomingTitleWords = new Set(
          (title + " " + opts.content).toLowerCase().split(/[^a-z0-9_-]+/).filter((w) => w.length >= 3)
        );

        for (const row of recentRows) {
          if (opts.id && row.id === opts.id) continue;
          let score = 0.5; // base temporal recency score
          if (opts.session_id && row.session_id === opts.session_id) {
            score += 1.0; // strong boost for same session
          }
          try {
            const rowTags: string[] = JSON.parse(row.tags || "[]");
            for (const rt of rowTags) {
              if (incomingTags.has(rt.toLowerCase())) score += 0.8;
            }
          } catch {}
          const rowTitleWords = row.title.toLowerCase().split(/[^a-z0-9_-]+/).filter((w) => w.length >= 3);
          for (const rw of rowTitleWords) {
            if (incomingTitleWords.has(rw)) score += 0.3;
          }
          scoredCandidates.push({ id: row.id, score });
        }

        scoredCandidates.sort((a, b) => b.score - a.score);
        linked_memory_ids = scoredCandidates.slice(0, 5).map((c) => c.id);
      } catch {}
    }
  }

  const entry: MemoryEntry = {
    id: opts.id ?? makeId(opts.title ?? opts.content.slice(0, 60)),
    title,
    content: opts.content,
    project: opts.project,
    status: opts.confirmed ? "confirmed" : "candidate",
    type: opts.type ?? "discovery",
    created_at: createdAt,
    updated_at: updatedAt,
    source: opts.source ?? "manual",
    tags: opts.tags?.slice(0, 8) ?? [],
    salience: typeof opts.salience === "number" ? opts.salience : undefined,
    valid_from: opts.validFrom ?? opts.valid_from,
    valid_to: opts.validTo ?? opts.valid_to,
    valid_to_exact:
      opts.validToExact !== undefined
        ? opts.validToExact
        : opts.valid_to_exact !== undefined
        ? opts.valid_to_exact
        : opts.validTo || opts.valid_to
        ? true
        : undefined,
    src_ts,
    linked_memory_ids: linked_memory_ids.length > 0 ? linked_memory_ids : undefined,
    due_at: opts.dueAt ?? opts.due_at,
    expires_at,
    pinned,
    test_command: opts.test_command,
    verification: opts.verification ?? (opts.confirmed ? { level: "user-confirmed", verified_at: now } : { level: "unverified" }),
    graph: opts.graph ?? (store.memoryDir ? autoStampGraphMetadata(`${opts.title ?? ""} ${opts.content}`, store.memoryDir) : undefined),
    fingerprint,
    temporal_mode,
    evidence: opts.evidence,
    conflict_ids: opts.conflict_ids,
    mem_path: opts.mem_path,
    idempotency_key: opts.idempotency_key,
    content_hash,
    trust,
    score_retain: retention.score,
    source_ids: opts.source_ids,
    decay_score:
      typeof (opts as any).decay_score === "number"
        ? (opts as any).decay_score
        : computeDecayScore({
            type: opts.type ?? "discovery",
            created_at: now,
            updated_at: now,
            valid_from: opts.validFrom ?? opts.valid_from,
            src_ts,
            verification: opts.verification ?? (opts.confirmed ? { level: "user-confirmed", verified_at: now } : { level: "unverified" }),
            reinforcement: opts.confirmed ? 1 : 0,
            access_count: 0,
            salience: typeof opts.salience === "number" ? opts.salience : undefined,
            temporal_mode,
          }),
  };

  entry.quality = opts.quality ?? determineQuality(entry);
  entry.utility = opts.utility ?? ensureUtility(entry);

  // Resurrection guard: an explicit id colliding with a tombstoned row must go
  // through memory_restore, not silently clear the marker via INSERT OR REPLACE.
  if (opts.id && isTombstoned(store, entry.id)) {
    throw new Error(`Entry ${entry.id} is deleted — use memory_restore to bring it back, not propose`);
  }

  if (opts.confirmed) entry.last_confirmed_at = now;
  save(store, entry);

  // Optional automated contradiction detection
  if (opts.checkConflict) {
    const conflict = detectConflict(store, {
      title: entry.title,
      content: entry.content,
      project: entry.project,
      type: entry.type,
      id: entry.id,
    });
    if (conflict.conflicted && conflict.conflictingEntry) {
      const flagged = flagConflict(
        store,
        conflict.conflictingEntry.id,
        entry.id,
        conflict.reason || "Contradiction detected",
      );
      return flagged.incoming;
    }
  }

  if (entry.type === "constraint" && store.memoryDir) {
    try {
      syncConstraints(store.memoryDir, store);
    } catch {}
  }
  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "propose",
      entry_id: entry.id,
      project: entry.project,
      actor: opts.source ?? "agent",
      details: { title: entry.title, type: entry.type, status: entry.status },
    });
  }
  return entry;
}

/** candidate/disputed/stale -> confirmed, records verification. */
export function confirm(store: Store, id: string): MemoryEntry | null {
  const entry = get(store, id);
  if (!entry) return null;
  if (entry.status !== "candidate" && entry.status !== "disputed" && entry.status !== "stale") return null;
  const now = nowIso();
  entry.status = "confirmed";
  entry.disputed_by = undefined;
  entry.last_confirmed_at = now;
  entry.reinforcement = (entry.reinforcement ?? 0) + 1;
  entry.verification = { level: "user-confirmed", verified_at: now };
  entry.quality = determineQuality(entry);
  entry.updated_at = now;
  save(store, entry);
  if (entry.type === "constraint" && store.memoryDir) {
    try {
      syncConstraints(store.memoryDir, store);
    } catch {}
  }
  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "confirm",
      entry_id: entry.id,
      project: entry.project,
      actor: "user",
    });
  }
  return entry;
}

/** Mark old superseded (sets superseded_by), sets new's supersedes. Requires new to be confirmed. (T-082) */
export function supersede(
  store: Store,
  oldId: string,
  newId: string,
  options?: { valid_to_exact?: boolean; valid_to?: string }
): MemoryEntry | null {
  const old = get(store, oldId);
  const next = get(store, newId);
  if (!old || !next) return null;
  if (oldId === newId) return null;
  if (next.status !== "confirmed") return null;

  old.status = "superseded";
  closeOutValidity(old, options);
  old.quality = determineQuality(old);
  const prevOld = normalizeIdArray(old.superseded_by);
  if (!prevOld.includes(newId)) {
    old.superseded_by = [...prevOld, newId];
  }
  old.updated_at = nowIso();

  const prevNext = normalizeIdArray(next.supersedes);
  if (!prevNext.includes(oldId)) {
    next.supersedes = [...prevNext, oldId];
  }
  next.quality = determineQuality(next);
  next.updated_at = nowIso();

  save(store, old);
  save(store, next);
  if ((old.type === "constraint" || next.type === "constraint") && store.memoryDir) {
    try {
      syncConstraints(store.memoryDir, store);
    } catch {}
  }
  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "supersede",
      entry_id: old.id,
      project: old.project,
      details: { superseded_by: newId },
    });
  }
  return old;
}

/** Mark an entry stale; reason appended to content. (T-082) */
export function markStale(
  store: Store,
  id: string,
  reason?: string,
  options?: { valid_to_exact?: boolean; valid_to?: string }
): MemoryEntry | null {
  const entry = get(store, id);
  if (!entry) return null;
  entry.status = "stale";
  entry.quality = determineQuality(entry);
  closeOutValidity(entry, options);
  if (reason) entry.content = `${entry.content}\n\nStale: ${reason}`;
  entry.updated_at = nowIso();
  save(store, entry);
  if (entry.type === "constraint" && store.memoryDir) {
    try {
      syncConstraints(store.memoryDir, store);
    } catch {}
  }
  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "mark_stale",
      entry_id: entry.id,
      project: entry.project,
      reason,
    });
  }
  return entry;
}

/**
 * Migration archive transition: candidate -> superseded for imported records whose
 * source state was archived/superseded and which have no replacement pair in this
 * store (pair-based supersessions must use supersede(oldId, newId)). Logs audit. (T-082)
 */
export function markSuperseded(
  store: Store,
  id: string,
  reason?: string,
  options?: { valid_to_exact?: boolean; valid_to?: string }
): MemoryEntry | null {
  const entry = get(store, id);
  if (!entry) return null;
  entry.status = "superseded";
  entry.quality = determineQuality(entry);
  closeOutValidity(entry, options);
  if (reason) entry.content = `${entry.content}\n\nSuperseded: ${reason}`;
  entry.updated_at = nowIso();
  save(store, entry);
  if (entry.type === "constraint" && store.memoryDir) {
    try {
      syncConstraints(store.memoryDir, store);
    } catch {}
  }
  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "supersede",
      entry_id: entry.id,
      project: entry.project,
      actor: "migrator",
      details: { reason: reason ?? "migrated archived state" },
    });
  }
  return entry;
}

/**
 * T-079: Transition a memory entry to expired status, stamping expired_at and expired_by rule name.
 * Respects pin exemptions (pinned: true entries cannot be expired unless forced).
 */
export function expireEntry(
  store: Store,
  id: string,
  options?: {
    rule?: string;
    expired_at?: string;
    reason?: string;
    force?: boolean;
    valid_to_exact?: boolean;
    valid_to?: string;
  },
): MemoryEntry | null {
  const entry = get(store, id);
  if (!entry) return null;

  // Pin-capable exemption: pinned entries never expire unless explicitly forced
  if (entry.pinned && !options?.force) {
    return entry;
  }

  const now = options?.expired_at ?? nowIso();
  const ruleName = options?.rule ?? "rule:default_expiry";

  entry.status = "expired";
  entry.expired_at = now;
  entry.expired_by = ruleName;
  entry.quality = determineQuality(entry);
  closeOutValidity(entry, {
    valid_to: options?.valid_to ?? now,
    valid_to_exact: options?.valid_to_exact,
  });

  if (options?.reason) {
    entry.content = `${entry.content}\n\nExpired: [${ruleName}] ${options.reason}`;
  }
  entry.updated_at = now;
  save(store, entry);

  if (entry.type === "constraint" && store.memoryDir) {
    try {
      syncConstraints(store.memoryDir, store);
    } catch {}
  }

  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "expire",
      entry_id: entry.id,
      project: entry.project,
      reason: options?.reason,
      details: {
        expired_at: now,
        expired_by: ruleName,
      },
    });
  }

  return entry;
}

/** T-079: Alias for expireEntry */
export const markExpired = expireEntry;

/**
 * T-079: Sweep and expire all entries in the store whose expires_at is past now.
 */
export function sweepExpiredEntries(
  store: Store,
  options?: {
    now?: number;
    rule?: string;
    project?: string;
  },
): { expired: MemoryEntry[]; skippedPinned: number } {
  const nowMs = options?.now ?? Date.now();
  const entries = list(store, { project: options?.project });
  const expired: MemoryEntry[] = [];
  let skippedPinned = 0;

  for (const entry of entries) {
    if (entry.status === "expired" || entry.status === "archived" || entry.status === "superseded") {
      continue;
    }
    if (entry.pinned) {
      skippedPinned++;
      continue;
    }
    if (entry.expires_at) {
      const expiresMs = Date.parse(entry.expires_at);
      if (!Number.isNaN(expiresMs) && expiresMs <= nowMs) {
        const res = expireEntry(store, entry.id, {
          rule: options?.rule ?? `ttl_${entry.type ?? "discovery"}`,
          expired_at: new Date(nowMs).toISOString(),
        });
        if (res) expired.push(res);
      }
    }
  }

  return { expired, skippedPinned };
}

/** Two-way link: union related_memory_ids on both sides, no dupes. */
export function link(store: Store, id: string, relatedIds: string[]): MemoryEntry | null {
  const primary = get(store, id);
  if (!primary) return null;
  const targets = relatedIds.filter((r) => r !== id);
  for (const rid of targets) {
    if (!get(store, rid)) return null;
  }
  const union = (existing: string[] | undefined, add: string[]): string[] => {
    const out = [...(existing ?? [])];
    for (const x of add) if (!out.includes(x)) out.push(x);
    return out;
  };
  primary.related_memory_ids = union(primary.related_memory_ids, targets);
  primary.updated_at = nowIso();
  save(store, primary);

  for (const rid of targets) {
    const other = get(store, rid)!;
    other.related_memory_ids = union(other.related_memory_ids, [id]);
    other.updated_at = nowIso();
    save(store, other);
  }
  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "link",
      entry_id: primary.id,
      project: primary.project,
      details: { related: targets },
    });
  }
  return primary;
}

/** Reject an entry. (T-082) */
export function reject(
  store: Store,
  id: string,
  options?: { valid_to_exact?: boolean; valid_to?: string }
): MemoryEntry | null {
  const entry = get(store, id);
  if (!entry) return null;
  entry.status = "rejected";
  entry.quality = determineQuality(entry);
  closeOutValidity(entry, options);
  entry.updated_at = nowIso();
  save(store, entry);
  if (entry.type === "constraint" && store.memoryDir) {
    try {
      syncConstraints(store.memoryDir, store);
    } catch {}
  }
  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "reject",
      entry_id: entry.id,
      project: entry.project,
    });
  }
  return entry;
}

/**
 * T-030: soft delete. The row, its YAML mirror and its audit event all survive; only the
 * marker and the FTS text are removed, so no read path can surface it again.
 * `restoreEntry` reverses this. Without a SQLite primary there is nowhere to persist the
 * marker, so the degraded path still unlinks — shortcut: openStore always provides a db.
 */
export function deleteEntry(store: Store, id: string, reason?: string, actor?: string): boolean {
  const entry = get(store, id);
  if (!entry) return false;
  const who = actor ?? "agent";

  if (!store.db) {
    const file = fileForId(store, id);
    if (existsSync(file)) unlinkSync(file);
    if (store.cache) store.cache.deleteEntry(id);
    return true;
  }

  // T-025: row + marker + FTS eviction as one commit. save() first so a YAML-only entry
  // gets a row to tombstone; the marker must follow save() because INSERT OR REPLACE
  // rewrites the row and drops columns its writer does not know about.
  withTransaction(store.db, () => {
    save(store, entry);
    setTombstone(store, id, { at: nowIso(), by: who });
    store.db!.run(`DELETE FROM memories_fts WHERE id = ?`, [id]);
  });

  // 1. Evict from L0 Cache
  if (store.cache) {
    store.cache.deleteEntry(id);
  }

  // T-304: Remove from vector index.json if present
  if (store.memoryDir) {
    try {
      const { removeIndexEntry } = require("./vector.ts");
      removeIndexEntry(id, store.memoryDir);
    } catch {}
  }

  if (store.memoryDir && entry) {
    recordAuditEvent(store.memoryDir, {
      operation: "delete",
      entry_id: id,
      project: entry.project,
      actor: who,
      reason,
      // T-032: snapshot of what was tombstoned, so replayFromAudit can rebuild the content
      // if the row and the YAML mirror are later lost. Reported as reconstruction gaps otherwise.
      details: {
        tombstone: true,
        title: entry.title,
        type: entry.type,
        status: entry.status,
        tags: entry.tags,
        content: entry.content,
      },
    });
    if (entry.type === "constraint") {
      try {
        syncConstraints(store.memoryDir, store, [entry.content]);
      } catch {}
    }
  }
  return true;
}

export type RestoreFailure = "not_found" | "not_deleted" | "no_store";
export type RestoreOutcome = { ok: true; entry: MemoryEntry } | { ok: false; reason: RestoreFailure };

/**
 * T-031: clear a tombstone so the entry returns to every read path. Fails cleanly on an
 * unknown id or an entry that was never deleted. The content is reused as-is; use
 * `replayFromAudit` when the stored copy is gone.
 */
export function restoreEntry(store: Store, id: string, actor = "agent"): RestoreOutcome {
  if (!store.db) return { ok: false, reason: "no_store" };
  // Read the row, not the YAML mirror: readEntry() re-syncs rows with INSERT OR REPLACE, which
  // drops the marker columns and would clear the tombstone we are about to test for.
  const entry = getMemoryById(store.db, id);
  if (!entry) return { ok: false, reason: "not_found" };
  if (!isTombstoned(store, id)) return { ok: false, reason: "not_deleted" };

  // Same ordering rule as deleteEntry: save() re-adds the FTS row, then the marker clears.
  withTransaction(store.db, () => {
    save(store, entry);
    setTombstone(store, id, null);
  });
  if (store.cache) store.cache.deleteEntry(id);

  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "restore",
      entry_id: id,
      project: entry.project,
      actor,
      details: { tombstone_restore: true, title: entry.title },
    });
    if (entry.type === "constraint") {
      try {
        syncConstraints(store.memoryDir, store);
      } catch {}
    }
  }
  return { ok: true, entry };
}

export interface ReplayReport {
  ok: boolean;
  entry: MemoryEntry | null;
  /** Fields rebuilt from the audit ledger. */
  reconstructed: string[];
  /** Fields the ledger does not carry, left at defaults rather than invented. */
  missing: string[];
  reason?: string;
}

/**
 * Fields the audit ledger never records, so a replay can always be expected to report them.
 * `rehydrate`/`delete`/`supersede` events carry identifiers and lifecycle state, not payloads.
 */
const REPLAY_UNRECONSTRUCTABLE = [
  "verification",
  "fingerprint",
  "quality",
  "utility",
  "evidence",
  "graph",
  "related_memory_ids",
  "supersedes",
] as const;

/**
 * T-032: best-effort rebuild of an entry from audit.jsonl. Needed when the tombstoned row and
 * its YAML mirror are gone (purged, or written by a build that hard-deleted). Dry run by
 * default: `apply: true` writes the rebuilt entry and clears the tombstone.
 */
export function replayFromAudit(store: Store, id: string, options: { apply?: boolean } = {}): ReplayReport {
  const fail = (reason: string): ReplayReport => ({ ok: false, entry: null, reconstructed: [], missing: [], reason });
  if (!store.memoryDir) return fail("store has no memory directory, so no audit ledger");

  const trail = getAuditTrail(store.memoryDir, { entryId: id });
  if (trail.length === 0) return fail(`no audit history for ${id}`);

  // getAuditTrail is newest-first: the most recent snapshot wins, older events only fill gaps.
  const snap = trail.find((e) => typeof e.details?.content === "string" && e.details.content)?.details;
  if (!snap?.content) return fail(`audit history for ${id} carries no content snapshot`);

  const oldest = trail[trail.length - 1];
  const entry: MemoryEntry = {
    id,
    title: String(snap.title ?? `Reconstructed ${id}`),
    content: String(snap.content),
    project: String(snap.project ?? oldest.project ?? "unknown"),
    status: (snap.status ?? "candidate") as MemoryEntry["status"],
    type: (snap.type ?? "discovery") as MemoryEntry["type"],
    created_at: oldest.timestamp,
    updated_at: nowIso(),
    source: "audit_replay",
    tags: Array.isArray(snap.tags) ? snap.tags.map(String) : [],
    verification: { level: "unverified", method: "audit_replay" },
  };

  const reconstructed = ["id", "content", "created_at", "updated_at", "status", "type", "source", "verification"];
  if (snap.title) reconstructed.push("title");
  if (snap.tags) reconstructed.push("tags");
  const missing: string[] = [...REPLAY_UNRECONSTRUCTABLE];
  if (!snap.title) missing.push("title");
  if (!snap.tags) missing.push("tags");

  if (options.apply) {
    withTransaction(store.db, () => {
      save(store, entry);
      setTombstone(store, id, null);
    });
    if (store.memoryDir) {
      recordAuditEvent(store.memoryDir, {
        operation: "restore",
        entry_id: id,
        project: entry.project,
        actor: "audit_replay",
        details: { replay_restore: true, missing },
      });
    }
  }
  return { ok: true, entry, reconstructed, missing };
}

/**
 * Distill text into structured harvest units and propose each as a memory entry.
 * Units that fail to propose (e.g. probable secret) are skipped; survivors returned.
 */
export function harvestMemories(
  store: Store,
  params: { text: string; project: string; confirmed?: boolean },
): MemoryEntry[] {
  const units = extractHarvestUnits(params.text);
  const created: MemoryEntry[] = [];
  for (const u of units) {
    try {
      created.push(
        propose(store, {
          content: u.content,
          project: params.project,
          title: u.title,
          tags: u.tags,
          type: u.type,
          confirmed: params.confirmed === true,
          salience: u.salience,
        }),
      );
    } catch {
      // skip units that cannot be proposed
    }
  }
  return created;
}

// --- T-024: bounded FTS preflight -------------------------------------------------

/** Max whitespace-separated terms accepted before an FTS query is rejected. */
export const FTS_MAX_QUERY_TERMS = 32;
/** Max raw query length accepted before an FTS query is rejected. */
export const FTS_MAX_QUERY_CHARS = 512;

export interface FtsPreflight {
  ok: boolean;
  terms: number;
  reason?: string;
}

/**
 * T-024: bound the work FTS5 can be asked to do. Each term becomes one OR branch of
 * the MATCH expression, so an unbounded term list turns a lookup into a table scan
 * per term. Returns a verdict instead of throwing so callers can degrade or report.
 */
export function preflightFtsQuery(query: string): FtsPreflight {
  const raw = query ?? "";
  const clean = raw.trim().replace(/['"*]/g, "");
  if (!clean) return { ok: false, terms: 0, reason: "empty query" };
  if (raw.length > FTS_MAX_QUERY_CHARS) {
    return {
      ok: false,
      terms: 0,
      reason: `query is ${raw.length} characters, limit is ${FTS_MAX_QUERY_CHARS}`,
    };
  }
  const terms = clean.split(/\s+/).filter(Boolean);
  if (terms.length > FTS_MAX_QUERY_TERMS) {
    return {
      ok: false,
      terms: terms.length,
      reason: `query has ${terms.length} terms, limit is ${FTS_MAX_QUERY_TERMS}`,
    };
  }
  return { ok: true, terms: terms.length };
}

/** Store-level FTS read path: preflight the query, then BM25 search. */
export function searchMemories(
  store: Store,
  query: string,
  filters?: { project?: string; type?: string; status?: string; limit?: number },
): FtsSearchHits {
  const preflight = preflightFtsQuery(query);
  if (!preflight.ok) throw new Error(`FTS query rejected: ${preflight.reason}`);
  if (!store.db) {
    const empty: FtsSearchHits = [];
    empty.degraded = false;
    return empty;
  }
  const hits = searchMemoriesFts(store.db, query, filters);
  // T-030: the delete path already evicts the FTS row; this holds the read path closed even if
  // a row carries a marker without that eviction having run.
  const tombstones = tombstonedIds(store);
  if (tombstones.size === 0) return hits;
  const filtered = hits.filter((h) => !tombstones.has(h.entry.id)) as FtsSearchHits;
  filtered.degraded = hits.degraded;
  filtered.error = hits.error;
  return filtered;
}

// --- T-026: FTS <-> row parity ----------------------------------------------------

/** Cap on ids reported per desync class so a broken index cannot flood a caller. */
const FTS_PARITY_SAMPLE = 50;

export interface FtsParityReport {
  ok: boolean;
  rowCount: number;
  indexedCount: number;
  /** Memory rows with no FTS index row. */
  missingCount: number;
  /** FTS index rows with no memory row. */
  orphanedCount: number;
  /** Sample of memory rows with no FTS index row. */
  missing: string[];
  /** Sample of FTS index rows with no memory row. */
  orphaned: string[];
  /** Set by repairFtsIndex() to record that a rebuild was performed. */
  repaired?: boolean;
}

/** Compare the FTS index against the memories table without mutating anything. */
export function checkFtsParity(store: Store): FtsParityReport {
  const db = store.db;
  if (!db) {
    return { ok: true, rowCount: 0, indexedCount: 0, missingCount: 0, orphanedCount: 0, missing: [], orphaned: [] };
  }
  const count = (sql: string): number => {
    try {
      return db.query<{ c: number }>(sql).get()?.c ?? 0;
    } catch {
      return 0;
    }
  };
  const ids = (sql: string): string[] =>
    db
      .query<{ id: string }>(sql)
      .all([FTS_PARITY_SAMPLE])
      .map((r) => r.id);

  // T-030: a tombstoned row is intentionally absent from FTS, so it is not a desync.
  const missingCount = count(
    `SELECT count(*) AS c FROM memories WHERE deleted_at IS NULL AND id NOT IN (SELECT id FROM memories_fts)`,
  );
  const orphanedCount = count(`SELECT count(*) AS c FROM memories_fts WHERE id NOT IN (SELECT id FROM memories)`);
  return {
    ok: missingCount === 0 && orphanedCount === 0,
    rowCount: count(`SELECT count(*) AS c FROM memories`),
    indexedCount: count(`SELECT count(DISTINCT id) AS c FROM memories_fts`),
    missingCount,
    orphanedCount,
    missing: missingCount > 0 ? ids(`SELECT id FROM memories WHERE deleted_at IS NULL AND id NOT IN (SELECT id FROM memories_fts) ORDER BY updated_at DESC LIMIT ?`) : [],
    orphaned: orphanedCount > 0 ? ids(`SELECT id FROM memories_fts WHERE id NOT IN (SELECT id FROM memories) LIMIT ?`) : [],
  };
}

/**
 * T-026: rebuild the FTS index from the memories table in one commit (drops orphaned
 * and duplicate index rows, re-adds missing ones), then re-report. Tombstoned rows are
 * left unindexed (T-030) — re-adding them would make deleted text searchable again.
 */
export function repairFtsIndex(store: Store): FtsParityReport {
  const db = store.db;
  if (!db) return checkFtsParity(store);
  withTransaction(db, () => {
    db!.run(`DELETE FROM memories_fts`);
    const rows = db!.query<{ id: string; title: string; content: string; tags: string }>(
      `SELECT id, title, content, COALESCE(json_extract(data, '$.tags'), '') as tags FROM memories WHERE deleted_at IS NULL`,
    ).all();
    for (const r of rows) {
      db!.run(
        `INSERT INTO memories_fts (id, title, content, tags) VALUES (?, ?, ?, ?)`,
        [r.id, redactSecrets(r.title), redactSecrets(r.content), r.tags],
      );
    }
  });
  return { ...checkFtsParity(store), repaired: true };
}

/**
 * T-084: Five-Verb Lifecycle Interfaces & Engine
 */
export interface ChangeOptions {
  valid_from?: string;
  valid_to_exact?: boolean;
  reason?: string;
  actor?: string;
}

/**
 * T-084: Five-verb lifecycle — `change`.
 * Represents a historical state transition where a fact ceases to be valid going forward
 * and is replaced by a new fact. The old fact is superseded and closed out bi-temporally.
 */
export function change(
  store: Store,
  oldId: string,
  newDraftOrId: string | Parameters<typeof propose>[1],
  options?: ChangeOptions,
): { old: MemoryEntry; next: MemoryEntry } | null {
  const old = get(store, oldId);
  if (!old) return null;

  let next: MemoryEntry | null = null;
  const now = options?.valid_from ?? nowIso();

  if (typeof newDraftOrId === "string") {
    next = get(store, newDraftOrId);
    if (!next) return null;
    if (next.status !== "confirmed") {
      confirm(store, next.id);
      next = get(store, next.id)!;
    }
  } else {
    next = propose(store, {
      ...newDraftOrId,
      project: newDraftOrId.project ?? old.project,
      confirmed: newDraftOrId.confirmed ?? true,
      valid_from: newDraftOrId.valid_from ?? now,
    });
  }

  const superseded = supersede(store, old.id, next.id, {
    valid_to: now,
    valid_to_exact: options?.valid_to_exact ?? true,
  });
  if (!superseded) return null;

  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "lifecycle_change",
      entry_id: old.id,
      project: old.project,
      actor: options?.actor ?? "agent",
      reason: options?.reason,
      details: { new_id: next.id, verb: "change", valid_to: now },
    });
  }

  return { old: get(store, old.id)!, next: get(store, next.id)! };
}

export interface EndOptions {
  reason?: string;
  valid_to?: string;
  valid_to_exact?: boolean;
  actor?: string;
}

/**
 * T-084: Five-verb lifecycle — `end`.
 * Concludes a fact's validity when it ceases to be true without a replacement fact.
 * Closes out valid_to bi-temporally and transitions status to stale.
 */
export function end(
  store: Store,
  id: string,
  options?: EndOptions,
): MemoryEntry | null {
  const entry = get(store, id);
  if (!entry) return null;

  const validTo = options?.valid_to ?? nowIso();
  const validToExact = options?.valid_to_exact ?? true;

  entry.status = "stale";
  entry.ended_at = validTo;
  closeOutValidity(entry, { valid_to: validTo, valid_to_exact: validToExact });
  if (options?.reason) {
    entry.content = `${entry.content}\n\nEnded: ${options.reason}`;
  }
  entry.updated_at = nowIso();
  entry.quality = determineQuality(entry);
  save(store, entry);

  if (entry.type === "constraint" && store.memoryDir) {
    try {
      syncConstraints(store.memoryDir, store);
    } catch {}
  }

  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "lifecycle_end",
      entry_id: entry.id,
      project: entry.project,
      actor: options?.actor ?? "agent",
      reason: options?.reason,
      details: { verb: "end", valid_to: validTo, valid_to_exact: validToExact },
    });
  }

  return entry;
}

export interface CorrectOptions {
  reason?: string;
  actor?: string;
}

/**
 * T-084: Five-verb lifecycle — `correct`.
 * Retroactively fixes an erroneous fact recorded by mistake.
 * Unlike `change`, this does NOT imply historical continuity: the prior recording was wrong.
 * Amends the entry directly with an audit trail note.
 */
export function correct(
  store: Store,
  id: string,
  correction: string | Partial<MemoryEntry>,
  options?: CorrectOptions,
): MemoryEntry | null {
  const entry = get(store, id);
  if (!entry) return null;

  const prevContent = entry.content;
  if (typeof correction === "string") {
    entry.content = correction;
  } else {
    if (correction.content) entry.content = correction.content;
    if (correction.title) entry.title = correction.title;
    if (correction.tags) entry.tags = correction.tags;
    if (correction.type) entry.type = correction.type;
    if (correction.salience !== undefined) entry.salience = correction.salience;
    if (correction.verification) entry.verification = correction.verification;
  }

  const now = nowIso();
  entry.updated_at = now;
  entry.corrected_at = now;
  if (options?.reason) {
    entry.correction_reason = options.reason;
  }
  entry.quality = determineQuality(entry);
  save(store, entry);

  if (entry.type === "constraint" && store.memoryDir) {
    try {
      syncConstraints(store.memoryDir, store);
    } catch {}
  }

  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "lifecycle_correct",
      entry_id: entry.id,
      project: entry.project,
      actor: options?.actor ?? "agent",
      reason: options?.reason,
      details: { verb: "correct", previous_content: prevContent },
    });
  }

  return entry;
}

export interface RevertOptions {
  reason?: string;
  actor?: string;
}

/**
 * T-084: Five-verb lifecycle — `revert`.
 * Restores a previously superseded, ended, or stale fact back into active confirmed knowledge.
 * Clears valid_to and bi-temporal closeout, resets status to confirmed, and unlinks supersessions.
 */
export function revert(
  store: Store,
  id: string,
  options?: RevertOptions,
): MemoryEntry | null {
  const entry = get(store, id);
  if (!entry) return null;

  const prevStatus = entry.status;
  const now = nowIso();
  entry.status = "confirmed";
  delete entry.valid_to;
  delete entry.valid_to_exact;
  delete entry.expired_at;
  delete entry.expired_by;
  delete entry.ended_at;
  entry.reverted_at = now;
  entry.reinforcement = (entry.reinforcement ?? 0) + 1;
  entry.last_confirmed_at = now;
  entry.updated_at = now;

  // Unlink incoming supersession references from replacing memories
  const supersededBy = normalizeIdArray(entry.superseded_by);
  for (const sId of supersededBy) {
    const sEntry = get(store, sId);
    if (sEntry) {
      const sSupersedes = normalizeIdArray(sEntry.supersedes).filter((x) => x !== id);
      sEntry.supersedes = sSupersedes.length > 0 ? sSupersedes : null;
      sEntry.updated_at = now;
      save(store, sEntry);
    }
  }
  entry.superseded_by = null;
  entry.quality = determineQuality(entry);
  save(store, entry);

  if (entry.type === "constraint" && store.memoryDir) {
    try {
      syncConstraints(store.memoryDir, store);
    } catch {}
  }

  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "lifecycle_revert",
      entry_id: entry.id,
      project: entry.project,
      actor: options?.actor ?? "agent",
      reason: options?.reason,
      details: { verb: "revert", previous_status: prevStatus },
    });
  }

  return entry;
}

export interface ForgetOptions {
  reason?: string;
  actor?: string;
  hard?: boolean;
}

/**
 * T-084: Five-verb lifecycle — `forget`.
 * Right-to-be-forgotten / complete soft tombstone or hard erasure.
 * Excludes the memory from all active recall, FTS, and indexing.
 */
export function forget(
  store: Store,
  id: string,
  options?: ForgetOptions,
): boolean {
  if (options?.hard) {
    const entry = get(store, id);
    if (!entry) return false;
    const file = fileForId(store, id);
    if (existsSync(file)) unlinkSync(file);
    if (store.db) {
      store.db.run(`DELETE FROM memories WHERE id = ?`, [id]);
      store.db.run(`DELETE FROM memories_fts WHERE id = ?`, [id]);
    }
    if (store.cache) store.cache.deleteEntry(id);
    if (store.memoryDir) {
      try {
        const { removeIndexEntry } = require("./vector.ts");
        removeIndexEntry(id, store.memoryDir);
      } catch {}
      recordAuditEvent(store.memoryDir, {
        operation: "lifecycle_forget",
        entry_id: id,
        project: entry.project,
        actor: options?.actor ?? "agent",
        reason: options?.reason,
        details: { verb: "forget", hard: true },
      });
    }
    return true;
  }

  const ok = deleteEntry(store, id, options?.reason, options?.actor);
  if (ok && store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "lifecycle_forget",
      entry_id: id,
      project: get(store, id)?.project ?? "default",
      actor: options?.actor ?? "agent",
      reason: options?.reason,
      details: { verb: "forget", hard: false },
    });
  }
  return ok;
}

/**
 * T-056 & T-055: Gracefully closes store, awaiting all in-flight async write workers
 * within a bounded join and running WAL checkpoint optimization to keep disk compact.
 */
export async function closeStore(store: Store): Promise<void> {
  try {
    await drainWriteWorkers(5000);
  } catch {}

  if (store.db) {
    try {
      store.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch {}
    try {
      store.db.close();
    } catch {}
  }
}

export {
  resolveVeracityClass,
  getVeracityWeight,
  VERACITY_RANK_WEIGHTS,
  type VeracityClass,
} from "./retrieval.ts";

