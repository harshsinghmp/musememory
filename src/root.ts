import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { initUserProfile, userFilePath } from "./user.ts";
import { ensureWikiStructure } from "./wiki/index.ts";

export type MarkerKind = "memory" | "git" | "global" | "env" | "auto" | null;

/** Recognized memory storage directory names. */
export const MEMORY_DIR_NAMES = [".memory", ".musememory", ".muse-memory"] as const;

/** True when path points at a memory storage dir (.memory/.musememory/.muse-memory suffix). */
export function isMemoryDirPath(path: string): boolean {
  return MEMORY_DIR_NAMES.some((n) => path.endsWith(n));
}

/** Workspace root for a memory dir path (its parent); non-memory paths returned unchanged. */
export function workspaceRootFor(memoryDir: string): string {
  return isMemoryDirPath(memoryDir) ? dirname(memoryDir) : memoryDir;
}

export interface RootResult {
  root: string | null;
  marker: MarkerKind;
  memoryDirName?: string;
}

export interface ResolveOptions {
  global?: boolean;
}

/**
 * Returns the global memory system directory (~/.memory or $MEMORY_DIR / $MUSEMEMORY_DIR).
 */
export function getGlobalMemoryDir(): string {
  const custom = process.env.MEMORY_DIR || process.env.MUSEMEMORY_DIR;
  if (custom) return custom;
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  return join(home, ".memory");
}

function ensureMemoryDirectory(memoryDir: string): void {
  const memoriesDir = join(memoryDir, "memories");
  if (!existsSync(memoriesDir)) {
    mkdirSync(memoriesDir, { recursive: true });
  }
  const currentPath = join(memoryDir, "CURRENT.md");
  if (!existsSync(currentPath)) {
    writeFileSync(currentPath, "# Active Project Constraints\n", "utf8");
  }

  // Ensure USER.md exists (local points to global; global creates default developer template)
  const uPath = userFilePath(memoryDir);
  if (!existsSync(uPath)) {
    const isGlobal = memoryDir === getGlobalMemoryDir();
    initUserProfile(memoryDir, "developer", false, !isGlobal);
  }

  // Ensure wiki directory structure exists
  ensureWikiStructure(memoryDir);
}

/**
 * Hierarchical upward scan from startDir:
 * 1. If options.global is true -> global ~/.memory
 * 2. If $MEMORY_DIR or $MUSEMEMORY_DIR is set -> custom path
 * 3. Nearest ancestor dir containing `.memory/` (or `.musememory/`, `.muse-memory/`) wins
 * 4. Else nearest containing `.git/` (defaults to `.memory/` inside it)
 * 5. Else null
 */
export function findProjectRoot(startDir: string, options: ResolveOptions = {}): RootResult {
  if (options.global) {
    const gDir = getGlobalMemoryDir();
    return { root: gDir, marker: "global", memoryDirName: "" };
  }

  const envDir = process.env.MEMORY_DIR || process.env.MUSEMEMORY_DIR;
  if (envDir) {
    return { root: envDir, marker: "env", memoryDirName: "" };
  }

  const ancestors = ancestorChain(startDir);
  for (const dir of ancestors) {
    if (existsSync(join(dir, ".memory"))) return { root: dir, marker: "memory", memoryDirName: ".memory" };
    if (existsSync(join(dir, ".musememory"))) return { root: dir, marker: "memory", memoryDirName: ".musememory" };
    if (existsSync(join(dir, ".muse-memory"))) return { root: dir, marker: "memory", memoryDirName: ".muse-memory" };
  }
  for (const dir of ancestors) {
    if (existsSync(join(dir, ".git"))) {
      let dirName = ".memory";
      if (existsSync(join(dir, ".musememory"))) dirName = ".musememory";
      else if (existsSync(join(dir, ".muse-memory"))) dirName = ".muse-memory";
      return { root: dir, marker: "git", memoryDirName: dirName };
    }
  }
  return { root: null, marker: null };
}

/**
 * Resolve project root or automatically initialize `.memory/` (and CURRENT.md) in startDir (or global) if none found.
 */
export function findOrCreateProjectRoot(
  startDir: string,
  options: ResolveOptions = {},
): { root: string; memoryDir: string; marker: MarkerKind } {
  if (options.global) {
    const globalDir = getGlobalMemoryDir();
    ensureMemoryDirectory(globalDir);
    return { root: globalDir, memoryDir: globalDir, marker: "global" };
  }

  const res = findProjectRoot(startDir, options);
  if (res.marker === "env" || res.marker === "global") {
    const memoryDir = res.root!;
    ensureMemoryDirectory(memoryDir);
    return { root: memoryDir, memoryDir, marker: res.marker };
  }

  const root = res.root ?? startDir;
  const memoryDirName =
    res.memoryDirName ?? MEMORY_DIR_NAMES.find((n) => existsSync(join(root, n))) ?? ".memory";
  const memoryDir = join(root, memoryDirName);
  const marker = res.marker ?? "auto";
  ensureMemoryDirectory(memoryDir);
  return { root, memoryDir, marker };
}

function ancestorChain(startDir: string): string[] {
  const chain: string[] = [];
  let dir = startDir;
  for (;;) {
    chain.push(dir);
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return chain;
}
