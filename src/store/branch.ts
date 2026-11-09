import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { workspaceRootFor } from "../root.ts";
import type { Store } from "../store.ts";
import { list, get, save } from "../store.ts";
import type { MemoryEntry } from "../types.ts";
import { validateEntry } from "../schema.ts";
import { scanSecrets } from "../secrets.ts";
import { withStoreLock } from "../lock.ts";
import { recordAuditEvent } from "../audit.ts";
import { archiveMemory } from "../promotion/archival.ts";
import { mergeMemories3Way, type MergeStrategy, type MergeConflict } from "../quality/branch_merge.ts";

export interface BranchOverlayMeta {
  branch: string;
  base_branch?: string;
  created_at: string;
  updated_at: string;
}

export interface BranchOverlay {
  meta: BranchOverlayMeta;
  /** Base revisions captured at creation, for three-way merge. */
  base_entries: MemoryEntry[];
  entries: MemoryEntry[];
  deleted_ids: string[];
}

const MAX_BRANCH_LENGTH = 200;

function validateBranch(branch: string): string {
  if (!branch.trim() || branch.length > MAX_BRANCH_LENGTH || /[\u0000-\u001f]/.test(branch)) {
    throw new Error(`Invalid branch name '${branch}'`);
  }
  return branch;
}

function encodedBranch(branch: string): string {
  return Buffer.from(validateBranch(branch), "utf8").toString("base64url");
}

export function branchOverlayPath(memoryDir: string, branch: string): string {
  return join(memoryDir, "overlays", `${encodedBranch(branch)}.json`);
}

export function currentGitBranch(cwd: string = process.cwd()): string | null {
  try {
    const symbolic = execFileSync("git", ["symbolic-ref", "--short", "-q", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (symbolic) return symbolic;
  } catch {
    return null;
  }
  return null;
}

function assertValidEntries(entries: unknown, label: string): MemoryEntry[] {
  if (!Array.isArray(entries)) throw new Error(`${label} is not an array`);
  const validated: MemoryEntry[] = [];
  for (const entry of entries) {
    const result = validateEntry(entry);
    if (!result.valid) throw new Error(`${label} contains an invalid memory: ${result.errors?.join("; ")}`);
    const secrets = scanSecrets(`${(entry as MemoryEntry).title}\n${(entry as MemoryEntry).content}`);
    if (secrets.length > 0) throw new Error(`${label} contains a credential: ${secrets[0]}`);
    validated.push(entry as MemoryEntry);
  }
  return validated;
}

export function loadBranchOverlay(memoryDir: string, branch: string): BranchOverlay | null {
  const path = branchOverlayPath(memoryDir, branch);
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<BranchOverlay>;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.entries)) {
    throw new Error(`Invalid branch overlay at ${path}`);
  }
  if (parsed.meta?.branch !== branch) {
    throw new Error(`Overlay identity mismatch at ${path}: expected '${branch}', found '${parsed.meta?.branch}'`);
  }
  return {
    meta: {
      branch,
      base_branch: parsed.meta?.base_branch,
      created_at: parsed.meta?.created_at ?? new Date().toISOString(),
      updated_at: parsed.meta?.updated_at ?? new Date().toISOString(),
    },
    base_entries: Array.isArray(parsed.base_entries) ? (parsed.base_entries as MemoryEntry[]) : [],
    entries: parsed.entries as MemoryEntry[],
    deleted_ids: Array.isArray(parsed.deleted_ids) ? parsed.deleted_ids.map(String) : [],
  };
}

function writeOverlay(memoryDir: string, overlay: BranchOverlay): void {
  assertValidEntries(overlay.entries, "branch overlay");
  const dir = join(memoryDir, "overlays");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = branchOverlayPath(memoryDir, overlay.meta.branch);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(overlay, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}

export function createBranchOverlay(
  store: Store,
  options: { branch?: string; baseBranch?: string } = {},
): BranchOverlay {
  const branch = options.branch ?? currentGitBranch(workspaceRootFor(store.memoryDir ?? store.dir));
  if (!branch) throw new Error("Cannot determine branch: pass --branch (detached HEAD)");
  validateBranch(branch);
  const memoryDir = store.memoryDir ?? store.dir;
  const existing = loadBranchOverlay(memoryDir, branch);
  if (existing) return existing;
  const now = new Date().toISOString();
  const overlay: BranchOverlay = {
    meta: { branch, base_branch: options.baseBranch, created_at: now, updated_at: now },
    base_entries: list(store),
    entries: [],
    deleted_ids: [],
  };
  writeOverlay(memoryDir, overlay);
  return overlay;
}

/** Base store plus branch overlay, with overlay entries winning by id. */
export function listBranchMemories(store: Store, branch: string): MemoryEntry[] {
  const overlay = loadBranchOverlay(store.memoryDir ?? store.dir, branch);
  if (!overlay) return list(store);
  const deleted = new Set(overlay.deleted_ids);
  const byId = new Map(list(store).filter((entry) => !deleted.has(entry.id)).map((entry) => [entry.id, entry]));
  for (const entry of overlay.entries) byId.set(entry.id, entry);
  return [...byId.values()];
}

export function writeBranchEntry(store: Store, branch: string, entry: MemoryEntry): BranchOverlay {
  const memoryDir = store.memoryDir ?? store.dir;
  const overlay = loadBranchOverlay(memoryDir, branch) ?? createBranchOverlay(store, { branch });
  const validated = assertValidEntries([entry], "branch overlay entry")[0];
  overlay.entries = overlay.entries.filter((candidate) => candidate.id !== entry.id);
  overlay.entries.push(validated);
  overlay.deleted_ids = overlay.deleted_ids.filter((id) => id !== entry.id);
  overlay.meta.updated_at = new Date().toISOString();
  writeOverlay(memoryDir, overlay);
  recordAuditEvent(memoryDir, {
    operation: "overlay_set",
    entry_id: entry.id,
    project: entry.project,
    actor: `overlay:${branch}`,
    reason: "branch_overlay_write",
    details: { branch },
  });
  return overlay;
}

export function deleteBranchEntry(store: Store, branch: string, id: string): BranchOverlay {
  const memoryDir = store.memoryDir ?? store.dir;
  const overlay = loadBranchOverlay(memoryDir, branch) ?? createBranchOverlay(store, { branch });
  overlay.entries = overlay.entries.filter((entry) => entry.id !== id);
  if (!overlay.deleted_ids.includes(id)) overlay.deleted_ids.push(id);
  overlay.meta.updated_at = new Date().toISOString();
  writeOverlay(memoryDir, overlay);
  recordAuditEvent(memoryDir, {
    operation: "overlay_set",
    entry_id: id,
    actor: `overlay:${branch}`,
    reason: "branch_overlay_delete",
    details: { branch, deleted: true },
  });
  return overlay;
}

function sameMergeFields(a: MemoryEntry, b: MemoryEntry): boolean {
  const fields = (entry: MemoryEntry) => JSON.stringify({
    title: entry.title,
    content: entry.content,
    status: entry.status,
    type: entry.type,
    tags: entry.tags ?? [],
    anchors: entry.anchors ?? [],
    valid_from: entry.valid_from,
    valid_to: entry.valid_to,
  });
  return fields(a) === fields(b);
}

export interface MergeReport {
  branch: string;
  applied: string[];
  archived: string[];
  conflicts: MergeConflict[];
}

/** Apply a branch overlay to the base store through the T-439 three-way resolver. */
export function mergeBranchOverlay(
  store: Store,
  branch: string,
  options: { strategy?: MergeStrategy } = {},
): MergeReport {
  const memoryDir = store.memoryDir ?? store.dir;
  const overlay = loadBranchOverlay(memoryDir, branch);
  if (!overlay) return { branch, applied: [], archived: [], conflicts: [] };

  const base = overlay.base_entries.length > 0 ? overlay.base_entries : list(store);
  const ours = listBranchMemories(store, branch);
  const theirs = list(store);
  const result = mergeMemories3Way(base, ours, theirs, { strategy: options.strategy ?? "semantic" });
  if (result.conflicts.length > 0) {
    return { branch, applied: [], archived: [], conflicts: result.conflicts };
  }

  const mergedIds = new Set(result.merged.map((entry) => entry.id));
  const archiveIds = theirs.filter((entry) => !mergedIds.has(entry.id)).map((entry) => entry.id);
  assertValidEntries(result.merged, "merged overlay entries");

  const applied: string[] = [];
  const archived: string[] = [];
  withStoreLock(memoryDir, () => {
    for (const entry of result.merged) {
      const current = get(store, entry.id);
      if (current && sameMergeFields(current, entry)) continue;
      save(store, entry);
      applied.push(entry.id);
      recordAuditEvent(memoryDir, {
        operation: "overlay_merge",
        entry_id: entry.id,
        project: entry.project,
        actor: `overlay:${branch}`,
        reason: "branch_overlay_merge",
        details: { strategy: options.strategy ?? "semantic", branch },
      });
    }
    for (const id of archiveIds) {
      if (archiveMemory(store, id, "archived", `overlay merge: ${branch}`, `overlay:${branch}`)) {
        archived.push(id);
      }
    }
  });

  const path = branchOverlayPath(memoryDir, branch);
  if (existsSync(path)) renameSync(path, `${path}.merged.${Date.now()}`);
  return { branch, applied, archived, conflicts: [] };
}

/** Remove merged/dropped overlay archives older than the retention window. */
export function pruneOverlayArchives(
  store: Store,
  options: { maxAgeDays?: number; now?: number } = {},
): string[] {
  const dir = join(store.memoryDir ?? store.dir, "overlays");
  if (!existsSync(dir)) return [];
  const cutoff = (options.now ?? Date.now()) - (options.maxAgeDays ?? 30) * 86_400_000;
  const removed: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(merged|dropped)\.\d+$/.test(entry.name)) continue;
    const path = join(dir, entry.name);
    if (statSync(path).mtimeMs > cutoff) continue;
    rmSync(path, { force: true });
    removed.push(entry.name);
  }
  return removed;
}

export function dropBranchOverlay(store: Store, branch: string): boolean {
  const path = branchOverlayPath(store.memoryDir ?? store.dir, branch);
  if (!existsSync(path)) return false;
  recordAuditEvent(store.memoryDir ?? store.dir, {
    operation: "overlay_drop",
    entry_id: "overlay",
    actor: "cli",
    reason: "branch_overlay_drop",
    details: { branch },
  });
  renameSync(path, `${path}.dropped.${Date.now()}`);
  return true;
}
