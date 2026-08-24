import { readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { MemoryEntry, MemoryType, Verification } from "./types.ts";
import { scanSecrets } from "./secrets.ts";
import { recordAuditEvent } from "./audit.ts";
import { getCurrent, setCurrent } from "./current.ts";
import { getUserProfile, setUserProfile, initUserProfile } from "./user.ts";
import { workspaceRootFor } from "./root.ts";

export interface StorageLayout {
  root: string;
  memoryDir: string;
  memoriesDir: string;
  currentMd: string;
  userMd: string;
  auditJsonl: string;
}

export function getStorageLayout(memoryDir: string): StorageLayout {
  return {
    root: workspaceRootFor(memoryDir),
    memoryDir,
    memoriesDir: join(memoryDir, "memories"),
    currentMd: join(memoryDir, "CURRENT.md"),
    userMd: join(memoryDir, "USER.md"),
    auditJsonl: join(memoryDir, "audit.jsonl"),
  };
}

export interface Store {
  dir: string;
  memoryDir?: string;
  layout?: StorageLayout;
}

export { getUserProfile, setUserProfile, initUserProfile, type UserArchetype } from "./user.ts";

/** Open the memories directory for a memory dir, creating it if missing. */
export function openStore(memoryDir: string): Store {
  const layout = getStorageLayout(memoryDir);
  mkdirSync(layout.memoriesDir, { recursive: true });
  return { dir: layout.memoriesDir, memoryDir, layout };
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
  if (!existsSync(store.dir)) return [];
  return readdirSync(store.dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.slice(0, -5));
}

export function get(store: Store, id: string): MemoryEntry | null {
  const file = fileForId(store, id);
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, "utf8");
    // JSON_SCHEMA: keep ISO timestamps as strings (default schema resolves them to Date, breaking Ajv format checks)
    return yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as MemoryEntry;
  } catch {
    return null;
  }
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

/** Atomic write: temp file + rename. Validates secrets before writing. */
export function save(store: Store, entry: MemoryEntry, options: { skipSecretCheck?: boolean } = {}): void {
  if (!options.skipSecretCheck) {
    const textToScan = extractEntryText(entry);
    const secrets = scanSecrets(textToScan);
    if (secrets.length > 0) {
      throw new Error(`Secret detected during save: ${secrets.join(", ")}`);
    }
  }
  const file = fileForId(store, entry.id);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, yaml.dump(entry, { lineWidth: 120 }), "utf8");
  renameSync(tmp, file);
}

export function mtimeOf(store: Store, id: string): number {
  const file = fileForId(store, id);
  if (!existsSync(file)) return 0;
  return statSync(file).mtimeMs;
}

export function maxMtime(store: Store): number {
  const ids = listIds(store);
  if (ids.length === 0) return 0;
  return Math.max(...ids.map((id) => mtimeOf(store, id)));
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
    tags?: string[];
    source?: string;
    type?: MemoryType;
    confirmed?: boolean;
    verification?: Verification;
    salience?: number;
    validFrom?: string;
    validTo?: string;
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
    id: makeId(opts.title ?? opts.content.slice(0, 60)),
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
    valid_from: opts.validFrom,
    valid_to: opts.validTo,
    test_command: opts.test_command,
    verification: opts.verification ?? (opts.confirmed ? { level: "user-confirmed", verified_at: now } : { level: "unverified" }),
  };
  if (opts.confirmed) entry.last_confirmed_at = now;
  save(store, entry);
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
  const file = fileForId(store, id);
  if (!existsSync(file)) return false;
  const entry = get(store, id);
  unlinkSync(file);
  if (store.memoryDir && entry) {
    recordAuditEvent(store.memoryDir, {
      operation: "delete",
      entry_id: id,
      project: entry.project,
      actor: actor ?? "agent",
      reason,
    });
  }
  return true;
}

