import { resolve } from "node:path";
import { readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { MemoryEntry, MemoryType, Verification, GraphMetadata } from "./types.ts";
import { scanSecrets } from "./secrets.ts";
import { recordAuditEvent, getAuditTrail } from "./audit.ts";
import { getCurrent, setCurrent, syncConstraints } from "./current.ts";
import { autoCompileWiki } from "./wiki/compiler.ts";
import { extractHarvestUnits } from "./harvest.ts";
import { autoStampGraphMetadata } from "./graph.ts";
import { workspaceRootFor } from "./root.ts";
import {
  openDatabase,
  insertOrReplaceMemory,
  getMemoryById,
  listMemories,
  searchMemoriesFts,
  type SqliteDatabase,
} from "./sqlite.ts";
import { runMigrations } from "./migrate.ts";
import { getOrCreateStoreCache, type MemoryStoreCache } from "./cache.ts";
import { initEmbedTables } from "./retrieval/embedders.ts";
import {
  computeFingerprint,
  inferTemporalMode,
  determineQuality,
  ensureUtility,
  findDuplicates,
  consolidateIntoCanonical,
  detectConflict,
  flagConflict,
} from "./quality/index.ts";
import type { TemporalMode, MemoryQuality, MemoryUtility, EvidenceItem } from "./types.ts";

export interface StorageLayout {
  root: string;
  memoryDir: string;
  memoriesDir: string;
  dbPath: string;
  currentMd: string;
  userMd: string;
  auditJsonl: string;
}

export function getStorageLayout(memoryDir: string): StorageLayout {
  return {
    root: workspaceRootFor(memoryDir),
    memoryDir,
    memoriesDir: join(memoryDir, "memories"),
    dbPath: join(memoryDir, "memory.db"),
    currentMd: join(memoryDir, "CURRENT.md"),
    userMd: join(memoryDir, "USER.md"),
    auditJsonl: join(memoryDir, "audit.jsonl"),
  };
}

export interface Store {
  dir: string;
  memoryDir?: string;
  layout?: StorageLayout;
  db?: SqliteDatabase;
  cache?: MemoryStoreCache;
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

function isTombstoned(store: Store, id: string): boolean {
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

/** Open the memories directory & SQLite primary database for a memory dir, creating it if missing. */
export function openStore(memoryDir: string): Store {
  const layout = getStorageLayout(memoryDir);
  mkdirSync(layout.memoriesDir, { recursive: true });
  mkdirSync(memoryDir, { recursive: true });

  let db: SqliteDatabase | undefined;
  try {
    const opened = openDatabase(layout.dbPath);
    // T-368: additive ALTERs for stores created by an older build. No rollback code —
    // the YAML mirror (which openStore rehydrates into SQLite below) is the rollback.
    runMigrations(opened);
    db = opened;
  } catch (err) {
    // If SQLite initialization fails on unusual environment, fallback gracefully
  }

  const cache = getOrCreateStoreCache(memoryDir);
  const store: Store = { dir: layout.memoriesDir, memoryDir, layout, db, cache };

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

  try {
    syncConstraints(memoryDir, store);
  } catch {}
  try {
    autoCompileWiki(store, memoryDir);
  } catch {}
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
  // T-030: a tombstoned entry is invisible to reads even though its row and YAML survive.
  if (isTombstoned(store, id)) return null;
  const entry = readEntry(store, id);
  return entry ? recordAccess(store, entry) : null;
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
export function save(store: Store, entry: MemoryEntry, options: { skipSecretCheck?: boolean } = {}): void {
  if (!options.skipSecretCheck) {
    const textToScan = extractEntryText(entry);
    const secrets = scanSecrets(textToScan);
    if (secrets.length > 0) {
      throw new Error(`Secret detected during save: ${secrets.join(", ")}`);
    }
  }

  // 1. Primary write to SQLite database
  if (store.db) {
    // T-025: memories row + FTS delete/insert as a single commit.
    withTransaction(store.db, () => insertOrReplaceMemory(store.db!, entry));
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

/** Bi-temporal close-out: stamp valid_to once and decrement reinforcement. */
function closeOutValidity(entry: MemoryEntry): void {
  if (!entry.valid_to) entry.valid_to = nowIso();
  entry.reinforcement = (entry.reinforcement ?? 0) - 1;
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
    dueAt?: string;
    expiresAt?: string;
    valid_from?: string;
    valid_to?: string;
    due_at?: string;
    expires_at?: string;
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
  },
): MemoryEntry {
  if (!opts.content || !opts.content.trim()) {
    throw new Error("Cannot propose memory entry with empty content");
  }
  if (!opts.project || !opts.project.trim()) {
    throw new Error("Cannot propose memory entry with empty project");
  }

  const title = (opts.title ?? opts.content.slice(0, 120)).slice(0, 120);

  // Deduplication check: consolidate into canonical memory if exact duplicate exists
  if (opts.dedup) {
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
  const fingerprint = opts.fingerprint ?? computeFingerprint(title, opts.content);
  const temporal_mode = opts.temporal_mode ?? inferTemporalMode(title, opts.content, opts.type);

  const entry: MemoryEntry = {
    id: opts.id ?? makeId(opts.title ?? opts.content.slice(0, 60)),
    title,
    content: opts.content,
    project: opts.project,
    status: opts.confirmed ? "confirmed" : "candidate",
    type: opts.type ?? "discovery",
    created_at: now,
    updated_at: now,
    source: opts.source ?? "manual",
    tags: opts.tags?.slice(0, 8) ?? [],
    salience: typeof opts.salience === "number" ? opts.salience : undefined,
    valid_from: opts.validFrom ?? opts.valid_from,
    valid_to: opts.validTo ?? opts.valid_to,
    due_at: opts.dueAt ?? opts.due_at,
    expires_at: opts.expiresAt ?? opts.expires_at,
    test_command: opts.test_command,
    verification: opts.verification ?? (opts.confirmed ? { level: "user-confirmed", verified_at: now } : { level: "unverified" }),
    graph: opts.graph ?? (store.memoryDir ? autoStampGraphMetadata(`${opts.title ?? ""} ${opts.content}`, store.memoryDir) : undefined),
    fingerprint,
    temporal_mode,
    evidence: opts.evidence,
    conflict_ids: opts.conflict_ids,
    mem_path: opts.mem_path,
  };

  entry.quality = opts.quality ?? determineQuality(entry);
  entry.utility = opts.utility ?? ensureUtility(entry);

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

/** Mark old superseded (sets superseded_by), sets new's supersedes. Requires new to be confirmed. */
export function supersede(store: Store, oldId: string, newId: string): MemoryEntry | null {
  const old = get(store, oldId);
  const next = get(store, newId);
  if (!old || !next) return null;
  if (oldId === newId) return null;
  if (next.status !== "confirmed") return null;

  old.status = "superseded";
  closeOutValidity(old);
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

/** Mark an entry stale; reason appended to content. */
export function markStale(store: Store, id: string, reason?: string): MemoryEntry | null {
  const entry = get(store, id);
  if (!entry) return null;
  entry.status = "stale";
  entry.quality = determineQuality(entry);
  closeOutValidity(entry);
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
 * store (pair-based supersessions must use supersede(oldId, newId)). Logs audit.
 */
export function markSuperseded(store: Store, id: string, reason?: string): MemoryEntry | null {
  const entry = get(store, id);
  if (!entry) return null;
  entry.status = "superseded";
  entry.quality = determineQuality(entry);
  closeOutValidity(entry);
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

/** Reject an entry. */
export function reject(store: Store, id: string): MemoryEntry | null {
  const entry = get(store, id);
  if (!entry) return null;
  entry.status = "rejected";
  entry.quality = determineQuality(entry);
  closeOutValidity(entry);
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
      operation: "rehydrate", // existing op for "bring this memory back into active knowledge"
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
        operation: "rehydrate",
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
): { entry: MemoryEntry; rank: number }[] {
  const preflight = preflightFtsQuery(query);
  if (!preflight.ok) throw new Error(`FTS query rejected: ${preflight.reason}`);
  if (!store.db) return [];
  const hits = searchMemoriesFts(store.db, query, filters);
  // T-030: the delete path already evicts the FTS row; this holds the read path closed even if
  // a row carries a marker without that eviction having run.
  const tombstones = tombstonedIds(store);
  return tombstones.size === 0 ? hits : hits.filter((h) => !tombstones.has(h.entry.id));
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
    db!.run(
      `INSERT INTO memories_fts (id, title, content, tags)
       SELECT id, title, content, COALESCE(json_extract(data, '$.tags'), '') FROM memories WHERE deleted_at IS NULL`,
    );
  });
  return { ...checkFtsParity(store), repaired: true };
}

