import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { Store } from "../store.ts";
import { list, get, save } from "../store.ts";
import type { MemoryEntry } from "../types.ts";

export interface BranchOverlayMeta {
  branch: string;
  base_branch?: string;
  created_at: string;
  updated_at: string;
}

export interface BranchOverlay {
  meta: BranchOverlayMeta;
  entries: MemoryEntry[];
  deleted_ids: string[];
}

function safeName(branch: string): string {
  return branch.replace(/[^A-Za-z0-9._-]/g, "_");
}

export function branchOverlayPath(memoryDir: string, branch: string): string {
  return join(memoryDir, "branches", `${safeName(branch)}.json`);
}

export function currentGitBranch(cwd: string = process.cwd()): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

export function loadBranchOverlay(memoryDir: string, branch: string): BranchOverlay | null {
  const path = branchOverlayPath(memoryDir, branch);
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<BranchOverlay>;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.entries)) {
    throw new Error(`Invalid branch overlay at ${path}`);
  }
  return {
    meta: {
      branch: parsed.meta?.branch ?? branch,
      base_branch: parsed.meta?.base_branch,
      created_at: parsed.meta?.created_at ?? new Date().toISOString(),
      updated_at: parsed.meta?.updated_at ?? new Date().toISOString(),
    },
    entries: parsed.entries as MemoryEntry[],
    deleted_ids: Array.isArray(parsed.deleted_ids) ? parsed.deleted_ids : [],
  };
}

function writeOverlay(memoryDir: string, overlay: BranchOverlay): void {
  const dir = join(memoryDir, "branches");
  mkdirSync(dir, { recursive: true });
  const path = branchOverlayPath(memoryDir, overlay.meta.branch);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(overlay, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

export function createBranchOverlay(
  store: Store,
  options: { branch?: string; baseBranch?: string } = {},
): BranchOverlay {
  const branch = options.branch ?? currentGitBranch(store.dir);
  if (!branch) throw new Error("Cannot determine branch: pass --branch");
  const existing = loadBranchOverlay(store.memoryDir ?? store.dir, branch);
  if (existing) return existing;
  const now = new Date().toISOString();
  const overlay: BranchOverlay = {
    meta: { branch, base_branch: options.baseBranch, created_at: now, updated_at: now },
    entries: [],
    deleted_ids: [],
  };
  writeOverlay(store.memoryDir ?? store.dir, overlay);
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
  overlay.entries = overlay.entries.filter((candidate) => candidate.id !== entry.id);
  overlay.entries.push(entry);
  overlay.deleted_ids = overlay.deleted_ids.filter((id) => id !== entry.id);
  overlay.meta.updated_at = new Date().toISOString();
  writeOverlay(memoryDir, overlay);
  return overlay;
}

export function deleteBranchEntry(store: Store, branch: string, id: string): BranchOverlay {
  const memoryDir = store.memoryDir ?? store.dir;
  const overlay = loadBranchOverlay(memoryDir, branch) ?? createBranchOverlay(store, { branch });
  overlay.entries = overlay.entries.filter((entry) => entry.id !== id);
  if (!overlay.deleted_ids.includes(id)) overlay.deleted_ids.push(id);
  overlay.meta.updated_at = new Date().toISOString();
  writeOverlay(memoryDir, overlay);
  return overlay;
}

export interface MergeReport {
  branch: string;
  applied: string[];
  deleted: string[];
}

/** Apply an overlay to the base store and clear it. */
export function mergeBranchOverlay(store: Store, branch: string): MergeReport {
  const memoryDir = store.memoryDir ?? store.dir;
  const overlay = loadBranchOverlay(memoryDir, branch);
  if (!overlay) return { branch, applied: [], deleted: [] };
  const applied: string[] = [];
  for (const entry of overlay.entries) {
    const current = get(store, entry.id);
    save(store, current ? { ...current, ...entry } : entry);
    applied.push(entry.id);
  }
  for (const id of overlay.deleted_ids) {
    const current = get(store, id);
    if (current) save(store, { ...current, status: "archived" });
  }
  const path = branchOverlayPath(memoryDir, branch);
  if (existsSync(path)) renameSync(path, `${path}.merged`);
  return { branch, applied, deleted: overlay.deleted_ids };
}

export function dropBranchOverlay(store: Store, branch: string): boolean {
  const path = branchOverlayPath(store.memoryDir ?? store.dir, branch);
  if (!existsSync(path)) return false;
  renameSync(path, `${path}.dropped`);
  return true;
}
