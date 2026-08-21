import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type MarkerKind = "memory" | "git" | "auto" | null;

export interface RootResult {
  root: string | null;
  marker: MarkerKind;
}

/**
 * Hierarchical upward scan from startDir, two-pass:
 * 1. nearest ancestor dir containing `.memory/` wins (marker kind "memory")
 * 2. else nearest containing `.git/` (kind "git")
 * 3. else null
 */
export function findProjectRoot(startDir: string): RootResult {
  const ancestors = ancestorChain(startDir);
  for (const dir of ancestors) {
    if (existsSync(join(dir, ".memory"))) return { root: dir, marker: "memory" };
  }
  for (const dir of ancestors) {
    if (existsSync(join(dir, ".git"))) return { root: dir, marker: "git" };
  }
  return { root: null, marker: null };
}

/**
 * Resolve project root or automatically initialize `.memory/` in startDir if none found.
 */
export function findOrCreateProjectRoot(startDir: string): { root: string; memoryDir: string; marker: MarkerKind } {
  const res = findProjectRoot(startDir);
  const root = res.root ?? startDir;
  const memoryDir = join(root, ".memory");
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
