import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import type { Store } from "./store.ts";
import { list, save, get, extractEntryText } from "./store.ts";
import { validateEntry } from "./schema.ts";
import { scanSecrets } from "./secrets.ts";
import { recordAuditEvent } from "./audit.ts";
import type { MemoryEntry } from "./types.ts";

/**
 * Export all entries from store into a portable JSON snapshot.
 */
export function exportSnapshot(store: Store): {
  version: string;
  exported_at: string;
  total: number;
  entries: MemoryEntry[];
} {
  const entries = list(store);
  return {
    version: "1.0.0",
    exported_at: new Date().toISOString(),
    total: entries.length,
    entries,
  };
}

/**
 * Import a memory snapshot into the store with validation and secret defenses.
 */
export function importSnapshot(
  store: Store,
  snapshot: { entries: MemoryEntry[] },
  options: { overwrite?: boolean } = {},
): { imported: number; skipped: number; errors: string[] } {
  if (!snapshot || !Array.isArray(snapshot.entries)) {
    return { imported: 0, skipped: 0, errors: ["Invalid snapshot format: missing entries array"] };
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const entry of snapshot.entries) {
    const validRes = validateEntry(entry);
    if (!validRes.valid) {
      errors.push(`Validation failed for ${entry.id ?? "unknown"}: ${validRes.errors.join(", ")}`);
      continue;
    }

    const secrets = scanSecrets(extractEntryText(entry));
    if (secrets.length > 0) {
      errors.push(`Secret detected in entry ${entry.id}: ${secrets.join(", ")}`);
      continue;
    }

    const existing = get(store, entry.id);
    if (existing && !options.overwrite) {
      skipped++;
      continue;
    }

    try {
      save(store, entry);
      imported++;
    } catch (err: unknown) {
      errors.push(`Failed to save ${entry.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (imported > 0 && store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "import",
      entry_id: "snapshot_batch",
      details: { imported_count: imported, skipped_count: skipped, error_count: errors.length },
    });
  }

  return { imported, skipped, errors };
}

export interface MemoryHashRecord {
  id: string;
  title: string;
  type?: string;
  hash: string;
}

export interface ExecutionSnapshot {
  run_id: string;
  task: string;
  timestamp: string;
  git_commit?: string;
  constraints: string[];
  memory_hashes: MemoryHashRecord[];
  file_inventory: string[];
  metadata?: Record<string, any>;
}

export function freezeExecutionSnapshot(options: {
  workspaceRoot: string;
  memoryDir: string;
  task: string;
  runId?: string;
  store?: Store;
  metadata?: Record<string, any>;
}): ExecutionSnapshot {
  const { workspaceRoot, memoryDir } = options;
  const runId = options.runId ?? `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const timestamp = new Date().toISOString();

  // 1. Task instruction
  let task = options.task;
  if (existsSync(task)) {
    try {
      task = readFileSync(task, "utf-8").trim();
    } catch {
      // Keep as string
    }
  }

  // 2. Git commit hash (if available)
  let gitCommit: string | undefined;
  try {
    const { execSync } = require("node:child_process");
    gitCommit = execSync("git rev-parse HEAD", { cwd: workspaceRoot, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    gitCommit = undefined;
  }

  // 3. Active constraints
  const currentPath = join(memoryDir, "CURRENT.md");
  let constraints: string[] = [];
  if (existsSync(currentPath)) {
    const currentContent = readFileSync(currentPath, "utf-8");
    constraints = currentContent
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- ") || l.startsWith("* "))
      .map((l) => l.replace(/^[-*]\s+/, ""));
  }

  // 4. Memory IDs and SHA-256 hashes
  const { createHash } = require("node:crypto");
  const entries = options.store ? list(options.store) : [];
  const memory_hashes: MemoryHashRecord[] = entries.map((e) => {
    const contentToHash = `${e.id}\n${e.title}\n${e.content}\n${e.status}\n${e.type ?? ""}`;
    const hash = createHash("sha256").update(contentToHash).digest("hex");
    return {
      id: e.id,
      title: e.title,
      type: e.type,
      hash,
    };
  });

  // 5. Workspace file inventory (top-level or recursive excluding node_modules / .git / .memory)
  const file_inventory: string[] = [];
  function scanDir(dir: string, base: string) {
    if (!existsSync(dir)) return;
    const items = readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.name === "node_modules" || item.name === ".git" || item.name === ".memory") continue;
      const fullPath = join(dir, item.name);
      const relPath = relative(base, fullPath);
      if (item.isDirectory()) {
        scanDir(fullPath, base);
      } else {
        file_inventory.push(relPath);
      }
    }
  }
  scanDir(workspaceRoot, workspaceRoot);

  const snapshot: ExecutionSnapshot = {
    run_id: runId,
    task,
    timestamp,
    git_commit: gitCommit,
    constraints,
    memory_hashes,
    file_inventory,
    metadata: options.metadata,
  };

  const safeRunId = runId.replace(/[^a-zA-Z0-9_\-\.]/g, "_");
  const runDir = join(memoryDir, "runs", safeRunId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "snapshot.json"), JSON.stringify(snapshot, null, 2), "utf-8");

  return snapshot;
}

export function loadExecutionSnapshot(memoryDir: string, runId: string): ExecutionSnapshot | null {
  const safeRunId = runId.replace(/[^a-zA-Z0-9_\-\.]/g, "_");
  const snapshotPath = join(memoryDir, "runs", safeRunId, "snapshot.json");
  if (!existsSync(snapshotPath)) return null;
  try {
    return JSON.parse(readFileSync(snapshotPath, "utf-8"));
  } catch {
    return null;
  }
}

export function listExecutionSnapshots(memoryDir: string): ExecutionSnapshot[] {
  const runsDir = join(memoryDir, "runs");
  if (!existsSync(runsDir)) return [];
  const entries = readdirSync(runsDir, { withFileTypes: true });
  const snapshots: ExecutionSnapshot[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const snap = loadExecutionSnapshot(memoryDir, entry.name);
      if (snap) snapshots.push(snap);
    }
  }
  return snapshots.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
