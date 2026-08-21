import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type MarkerKind = "memory" | "git" | "auto" | null;

export interface RootResult {
  root: string | null;
  marker: MarkerKind;
  memoryDirName?: string;
}

/**
 * Hierarchical upward scan from startDir:
 * 1. nearest ancestor dir containing `.muse-memory/` (or legacy `.memory/`) wins
 * 2. else nearest containing `.git/`
 * 3. else null
 */
export function findProjectRoot(startDir: string): RootResult {
  const ancestors = ancestorChain(startDir);
  for (const dir of ancestors) {
    if (existsSync(join(dir, ".muse-memory"))) return { root: dir, marker: "memory", memoryDirName: ".muse-memory" };
    if (existsSync(join(dir, ".memory"))) return { root: dir, marker: "memory", memoryDirName: ".memory" };
  }
  for (const dir of ancestors) {
    if (existsSync(join(dir, ".git"))) {
      const dirName = existsSync(join(dir, ".memory")) ? ".memory" : ".muse-memory";
      return { root: dir, marker: "git", memoryDirName: dirName };
    }
  }
  return { root: null, marker: null };
}

/**
 * Resolve project root or automatically initialize `.muse-memory/` in startDir if none found.
 */
export function findOrCreateProjectRoot(startDir: string): { root: string; memoryDir: string; marker: MarkerKind } {
  const res = findProjectRoot(startDir);
  const root = res.root ?? startDir;
  const memoryDirName = res.memoryDirName ?? (existsSync(join(root, ".memory")) ? ".memory" : ".muse-memory");
  const memoryDir = join(root, memoryDirName);
  const marker = res.marker ?? "auto";
  if (!existsSync(memoryDir)) {
    mkdirSync(join(memoryDir, "memories"), { recursive: true });
  }
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
