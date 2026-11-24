import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  openSync,
  readSync,
  statSync,
  closeSync,
  realpathSync,
} from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import type { Store } from "./store.ts";
import { list, save, get, extractEntryText } from "./store.ts";
import { validateEntry } from "./schema.ts";
import { scanSecrets, redactSecrets } from "./secrets.ts";
import { recordAuditEvent } from "./audit.ts";
import type { MemoryEntry } from "./types.ts";
import { getSettings } from "./settings.ts";
import { resolveWithin } from "./paths.ts";

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
  options: { overwrite?: boolean; secretScanEnabled?: boolean } = {},
): { imported: number; skipped: number; errors: string[] } {
  if (!snapshot || !Array.isArray(snapshot.entries)) {
    return { imported: 0, skipped: 0, errors: ["Invalid snapshot format: missing entries array"] };
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  // T-394: Enforce imports.secretScanEnabled setting
  const settings = getSettings(store.memoryDir);
  const shouldScanSecrets = options.secretScanEnabled ?? settings.imports?.secretScanEnabled ?? true;

  for (const entry of snapshot.entries) {
    const validRes = validateEntry(entry);
    if (!validRes.valid) {
      errors.push(`Validation failed for ${entry.id ?? "unknown"}: ${validRes.errors.join(", ")}`);
      continue;
    }

    if (shouldScanSecrets) {
      const secrets = scanSecrets(extractEntryText(entry));
      if (secrets.length > 0) {
        errors.push(`Secret detected in entry ${entry.id}: ${secrets.join(", ")}`);
        continue;
      }
    }

    const existing = get(store, entry.id);
    if (existing && !options.overwrite) {
      skipped++;
      continue;
    }

    try {
      save(store, entry, { skipSecretCheck: !shouldScanSecrets });
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

/** A frozen task brief is a short instruction, never a data dump. */
const MAX_TASK_FILE_BYTES = 64 * 1024;

interface TaskFileContent {
  content: string;
  path: string;
  truncated: boolean;
  redacted: boolean;
}

/**
 * Reads a file-backed task brief, confined to `workspaceRoot`.
 *
 * Issue #451: `freeze_run` used to read whatever path arrived in `task`, which
 * turned a documented "task string" parameter into an arbitrary file read (the
 * contents landed in `.memory/runs/<id>/snapshot.json` and came back out of
 * `memory_freeze_list`). A file-backed task is now opt-in through `task_file`,
 * and that option is contained, size-capped and redacted here.
 */
function readTaskFile(workspaceRoot: string, taskFile: string): TaskFileContent {
  // Rejects absolute paths, NUL bytes and lexical traversal (`../outside.md`).
  const resolved = resolveWithin(workspaceRoot, taskFile);

  // resolveWithin is lexical only, so a symlink inside the workspace could
  // still resolve to /etc/passwd. Re-check containment on the real paths.
  let realRoot: string;
  let realPath: string;
  try {
    realRoot = realpathSync(workspaceRoot);
    realPath = realpathSync(resolved);
  } catch {
    throw new Error(`task_file not found: ${taskFile}`);
  }
  try {
    resolveWithin(realRoot, relative(realRoot, realPath));
  } catch {
    throw new Error(`task_file "${taskFile}" resolves outside the workspace (${realPath})`);
  }

  let stat;
  try {
    stat = statSync(realPath);
  } catch {
    throw new Error(`task_file not found: ${taskFile}`);
  }
  // A FIFO or device inside the workspace would block or stream forever.
  if (!stat.isFile()) throw new Error(`task_file is not a regular file: ${taskFile}`);

  let fd: number;
  try {
    fd = openSync(realPath, "r");
  } catch {
    throw new Error(`task_file cannot be read: ${taskFile}`);
  }

  let raw = "";
  let truncated = false;
  try {
    // Cap the read so a huge file cannot be pulled into a snapshot.
    const buffer = Buffer.alloc(MAX_TASK_FILE_BYTES);
    const bytesRead = readSync(fd, buffer, 0, MAX_TASK_FILE_BYTES, 0);
    truncated = stat.size > bytesRead;
    raw = buffer.subarray(0, bytesRead).toString("utf-8");
  } finally {
    closeSync(fd);
  }

  // Secrets never enter a snapshot: the same redaction the write gates use.
  const content = redactSecrets(raw);
  return {
    content,
    path: relative(workspaceRoot, resolved),
    truncated,
    redacted: content !== raw,
  };
}

/**
 * Captures an immutable execution snapshot.
 *
 * `task` is opaque instruction text and is recorded verbatim — it is never
 * interpreted as a path (issue #451). Pass `taskFile` for a file-backed brief:
 * it is resolved inside `workspaceRoot`, capped at 64 KiB and redacted.
 */
export function freezeExecutionSnapshot(options: {
  workspaceRoot: string;
  memoryDir: string;
  task: string;
  /** Optional workspace-relative path to a task brief file. */
  taskFile?: string;
  runId?: string;
  store?: Store;
  metadata?: Record<string, any>;
}): ExecutionSnapshot {
  const { workspaceRoot, memoryDir } = options;
  const runId = options.runId ?? `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const timestamp = new Date().toISOString();

  // 1. Task instruction. A plain instruction is stored exactly as given: the
  // old `existsSync(task)` probe made every string a potential file read.
  let task = options.task;
  let taskMeta: Record<string, unknown> | undefined;
  if (options.taskFile) {
    const file = readTaskFile(workspaceRoot, options.taskFile);
    task = file.content.trim();
    taskMeta = {
      task_file: file.path,
      task_file_truncated: file.truncated,
      task_file_redacted: file.redacted,
    };
    // Keep the caller's label instead of silently discarding it.
    if (options.task.trim()) taskMeta.task_label = options.task.trim();
  }
  const metadata = taskMeta ? { ...(options.metadata ?? {}), ...taskMeta } : options.metadata;

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
    metadata,
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

export interface SnapshotRingResult {
  snapshotPath: string;
  snapshotName: string;
  target: "current" | "state";
  prunedCount: number;
}

/**
 * Captures an atomic pre-mutation snapshot into .memory/snapshots/ with rolling rotation.
 * Closes T-177.
 */
export function captureSnapshotRing(
  target: "current" | "state",
  memoryDir: string,
  maxSnapshots: number = 30,
): SnapshotRingResult {
  const snapshotsDir = join(memoryDir, "snapshots");
  mkdirSync(snapshotsDir, { recursive: true });

  const sourceFile = target === "current" ? "CURRENT.md" : "state.db";
  const sourcePath = join(memoryDir, sourceFile);

  if (!existsSync(sourcePath)) {
    throw new Error(`Cannot capture snapshot: ${sourcePath} does not exist`);
  }

  const isoTimestamp = new Date().toISOString().replace(/[:.]/g, "-") + "_" + Math.random().toString(36).slice(2, 7);
  const ext = target === "current" ? "md" : "db";
  const snapshotName = `${target}__${isoTimestamp}.${ext}`;
  const snapshotPath = join(snapshotsDir, snapshotName);

  const content = readFileSync(sourcePath);
  writeFileSync(snapshotPath, content);

  // Rotate ring buffer
  const prefix = `${target}__`;
  const existing = readdirSync(snapshotsDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(`.${ext}`))
    .sort();

  let prunedCount = 0;
  if (existing.length > maxSnapshots) {
    const toDelete = existing.slice(0, existing.length - maxSnapshots);
    for (const f of toDelete) {
      try {
        unlinkSync(join(snapshotsDir, f));
        prunedCount++;
      } catch {
        // ignore deletion failures
      }
    }
  }

  return { snapshotPath, snapshotName, target, prunedCount };
}

export function listSnapshotRing(target: "current" | "state", memoryDir: string): string[] {
  const snapshotsDir = join(memoryDir, "snapshots");
  if (!existsSync(snapshotsDir)) return [];
  const ext = target === "current" ? "md" : "db";
  return readdirSync(snapshotsDir)
    .filter((f) => f.startsWith(`${target}__`) && f.endsWith(`.${ext}`))
    .sort()
    .reverse();
}

export function restoreSnapshotRing(snapshotName: string, memoryDir: string): void {
  // Containment: the snapshot name is caller-supplied, so it must be
  // resolved strictly inside .memory/snapshots/. Without this, a name like
  // "../../etc/passwd" would read an arbitrary file and copy it over
  // .memory/CURRENT.md. The sibling loader (loadExecutionSnapshot)
  // sanitises its identifier for the same reason.
  const safeName = snapshotName.replace(/[^a-zA-Z0-9_\-\.]/g, "_");
  const snapshotsDir = join(memoryDir, "snapshots");
  const snapPath = resolveWithin(snapshotsDir, safeName);
  if (!existsSync(snapPath)) {
    throw new Error(`Snapshot not found: ${snapPath}`);
  }

  const targetFile = safeName.startsWith("current__") ? "CURRENT.md" : "state.db";
  const targetPath = join(memoryDir, targetFile);

  const content = readFileSync(snapPath);
  writeFileSync(targetPath, content);
}

