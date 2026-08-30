import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, isAbsolute, relative } from "node:path";
import type { MemoryEntry } from "./types.ts";
import { openStore, list } from "./store.ts";
import { resolveMemoryDir } from "./root.ts";

export interface DriftItem {
  memoryId: string;
  title: string;
  affectedPath: string;
  symbols: string[];
  driftType: "modified" | "deleted" | "renamed";
  suggestedAction: "supersede" | "verify" | "mark_stale";
}

export interface DriftReport {
  isDrifted: boolean;
  driftCount: number;
  driftedMemories: DriftItem[];
  scannedFilesCount: number;
  changedFiles: string[];
}

/**
 * Pure evaluation: compares memory entries against a list of git-changed file paths.
 */
export function scanCodeDriftFromDiff(
  entries: MemoryEntry[],
  changedFiles: string[],
  workspaceRoot?: string,
): DriftReport {
  const root = workspaceRoot || process.cwd();
  const normalizedChanged = new Set(
    changedFiles.map((f) => f.trim().replace(/^[\.\/]+/, "")).filter(Boolean),
  );

  const drifted: DriftItem[] = [];

  for (const entry of entries) {
    if (entry.status !== "confirmed" && entry.status !== "candidate") continue;
    const paths = entry.graph?.affected_paths || [];
    const symbols = entry.graph?.symbol_names || [];

    for (const p of paths) {
      const norm = p.trim().replace(/^[\.\/]+/, "");
      // Check if this path or a parent/child is in the git changed list
      const matched = Array.from(normalizedChanged).find(
        (cf) => cf === norm || cf.endsWith(`/${norm}`) || norm.endsWith(`/${cf}`),
      );

      if (matched) {
        const fullPath = isAbsolute(p) ? p : join(root, p);
        const exists = existsSync(fullPath);
        drifted.push({
          memoryId: entry.id,
          title: entry.title,
          affectedPath: p,
          symbols,
          driftType: exists ? "modified" : "deleted",
          suggestedAction: exists ? "verify" : "mark_stale",
        });
        break;
      }
    }
  }

  return {
    isDrifted: drifted.length > 0,
    driftCount: drifted.length,
    driftedMemories: drifted,
    scannedFilesCount: normalizedChanged.size,
    changedFiles: Array.from(normalizedChanged),
  };
}

/**
 * Retrieves git-modified file list from the local repository.
 */
export function getGitChangedFiles(workspaceRoot?: string): string[] {
  const root = workspaceRoot || process.cwd();
  try {
    const stdout = execSync("git status --porcelain", {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    const files: string[] = [];
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Git status line format: XY path or XY path -> newpath
      const parts = trimmed.split(/\s+/);
      const filePath = parts.length >= 2 ? parts[parts.length - 1] : "";
      if (filePath) files.push(filePath);
    }

    // Also get diff against HEAD if any commits exist
    try {
      const diffOut = execSync("git diff --name-only HEAD", {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      for (const line of diffOut.split("\n")) {
        const f = line.trim();
        if (f && !files.includes(f)) files.push(f);
      }
    } catch {}

    return files;
  } catch {
    return [];
  }
}

/**
 * Full scan: inspects repository git status against all active memories.
 */
export function scanCodeDrift(options: {
  workspaceRoot?: string;
  memoryDir?: string;
} = {}): DriftReport {
  const root = options.workspaceRoot || process.cwd();
  const changedFiles = getGitChangedFiles(root);
  const memDir = options.memoryDir || resolveMemoryDir({ global: false, root });
  const store = openStore(memDir);
  const entries = list(store);
  return scanCodeDriftFromDiff(entries, changedFiles, root);
}
