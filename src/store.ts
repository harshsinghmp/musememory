import { readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { MemoryEntry, MemoryType, Verification } from "./types.ts";
import { scanSecrets } from "./secrets.ts";
import { recordAuditEvent } from "./audit.ts";
import { getCurrent, setCurrent, syncConstraints } from "./current.ts";
import { autoCompileWiki } from "./wiki/compiler.ts";
import { extractHarvestUnits } from "./harvest.ts";
import { workspaceRootFor } from "./root.ts";
import {
  openDatabase,
  insertOrReplaceMemory,
  getMemoryById,
  listMemories,
  deleteMemoryById,
  type SqliteDatabase,
} from "./sqlite.ts";

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
}

/** Open the memories directory & SQLite primary database for a memory dir, creating it if missing. */
export function openStore(memoryDir: string): Store {
  const layout = getStorageLayout(memoryDir);
  mkdirSync(layout.memoriesDir, { recursive: true });
  mkdirSync(memoryDir, { recursive: true });

  let db: SqliteDatabase | undefined;
  try {
    db = openDatabase(layout.dbPath);
  } catch (err) {
    // If SQLite initialization fails on unusual environment, fallback gracefully
  }

  const store: Store = { dir: layout.memoriesDir, memoryDir, layout, db };

  // Sync existing YAML files into SQLite database if DB is newly initialized
  if (db && existsSync(layout.memoriesDir)) {
    try {
      const yamlIds = listIds(store);
      for (const yId of yamlIds) {
        if (!getMemoryById(db, yId)) {
          const entry = getFromYaml(store, yId);
          if (entry) {
            insertOrReplaceMemory(db, entry);
          }
        }
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
  return join(store.dir, `${slugifyId(id)}.yaml`);
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

export function get(store: Store, id: string): MemoryEntry | null {
  const file = fileForId(store, id);
  if (existsSync(file)) {
    const fromYaml = getFromYaml(store, id);
    if (!fromYaml) {
      // Corrupted or unparseable YAML file
      return null;
    }
    if (store.db) {
      const dbEntry = getMemoryById(store.db, id);
      if (dbEntry) return dbEntry;
      // Sync into SQLite
      try {
        insertOrReplaceMemory(store.db, fromYaml);
      } catch {}
    }
    return fromYaml;
  }
  if (store.db) {
    return getMemoryById(store.db, id);
  }
  return null;
}

export function list(store: Store): MemoryEntry[] {
  return listIds(store)
    .map((id) => get(store, id))
    .filter((e): e is MemoryEntry => e !== null);
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
    insertOrReplaceMemory(store.db, entry);
  }

  // 2. Dual write to YAML file for exportability
  try {
    const file = fileForId(store, entry.id);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, yaml.dump(entry, { lineWidth: 120 }), "utf8");
    renameSync(tmp, file);
  } catch {}
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeId(slug: string): string {
  const clean = slugifyId(slug);
  return `m_${Date.now()}_${clean}`;
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
  },
): MemoryEntry {
  if (!opts.content || !opts.content.trim()) {
    throw new Error("Cannot propose memory entry with empty content");
  }
  if (!opts.project || !opts.project.trim()) {
    throw new Error("Cannot propose memory entry with empty project");
  }

  const secrets = scanSecrets(
    extractEntryText({
      title: opts.title,
      content: opts.content,
      tags: opts.tags,
      verification: opts.verification,
    }),
  );
  if (secrets.length > 0) {
    throw new Error(`Probable secret detected: ${secrets.join(", ")}`);
  }

  const now = nowIso();
  const entry: MemoryEntry = {
    id: opts.id ?? makeId(opts.title ?? opts.content.slice(0, 60)),
    title: (opts.title ?? opts.content.slice(0, 120)).slice(0, 120),
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
  };
  if (opts.confirmed) entry.last_confirmed_at = now;
  save(store, entry);
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
  const prevOld = normalizeIdArray(old.superseded_by);
  if (!prevOld.includes(newId)) {
    old.superseded_by = [...prevOld, newId];
  }
  old.updated_at = nowIso();

  const prevNext = normalizeIdArray(next.supersedes);
  if (!prevNext.includes(oldId)) {
    next.supersedes = [...prevNext, oldId];
  }
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

/** Delete an entry permanently from store and record audit event. */
export function deleteEntry(store: Store, id: string, reason?: string, actor?: string): boolean {
  const entry = get(store, id);
  if (!entry) return false;

  let deleted = false;
  if (store.db) {
    deleted = deleteMemoryById(store.db, id) || deleted;
  }

  const file = fileForId(store, id);
  if (existsSync(file)) {
    unlinkSync(file);
    deleted = true;
  }

  if (store.memoryDir && entry) {
    recordAuditEvent(store.memoryDir, {
      operation: "delete",
      entry_id: id,
      project: entry.project,
      actor: actor ?? "agent",
      reason,
    });
    if (entry.type === "constraint") {
      try {
        syncConstraints(store.memoryDir, store, [entry.content]);
      } catch {}
    }
  }
  return deleted;
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

