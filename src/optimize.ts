import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "./store.ts";
import { list, get, deleteEntry } from "./store.ts";
import type { MemoryEntry } from "./types.ts";
import { normalizeText } from "./quality/dedup.ts";
import { recordAuditEvent } from "./audit.ts";
import { syncConstraints } from "./governor.ts";

export interface OptimizeOptions {
  project?: string;
  dryRun?: boolean;
  /** Force immediate optimization, bypassing cadence thresholds (default: false) */
  force?: boolean;
  /** Inactivity threshold in hours before auto-optimizing (default: 48) */
  inactivityHoursThreshold?: number;
  /** Cadence interval in days before auto-optimizing (default: 7) */
  daysIntervalThreshold?: number;
  memoryDir?: string;
}

export interface OptimizeReport {
  timestamp: string;
  totalBefore: number;
  totalAfter: number;
  prunedNoise: number;
  prunedJunk: number;
  prunedDuplicates: number;
  totalPruned: number;
  spaceReclaimedBytes: number;
  vacuumExecuted: boolean;
  skippedReason?: string;
  durationMs: number;
}

export interface OptimizationMetadata {
  last_optimized_at: string;
  last_activity_at: string;
  total_optimizations: number;
  last_report?: OptimizeReport;
}

const META_FILE_NAME = "optimization_meta.json";

function getMetaPath(memoryDir: string): string {
  return join(memoryDir, META_FILE_NAME);
}

export function readOptimizationMetadata(memoryDir: string): OptimizationMetadata {
  const metaPath = getMetaPath(memoryDir);
  if (!existsSync(metaPath)) {
    return {
      last_optimized_at: new Date(0).toISOString(),
      last_activity_at: new Date().toISOString(),
      total_optimizations: 0,
    };
  }
  try {
    const raw = readFileSync(metaPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {
      last_optimized_at: new Date(0).toISOString(),
      last_activity_at: new Date().toISOString(),
      total_optimizations: 0,
    };
  }
}

export function writeOptimizationMetadata(memoryDir: string, meta: OptimizationMetadata): void {
  const metaPath = getMetaPath(memoryDir);
  try {
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
  } catch {}
}

export function touchActivity(memoryDir: string): void {
  try {
    const meta = readOptimizationMetadata(memoryDir);
    meta.last_activity_at = new Date().toISOString();
    writeOptimizationMetadata(memoryDir, meta);
  } catch {}
}

/**
 * Checks whether auto-optimization should trigger based on:
 * 1. Scheduled cadence: every 7 days (or configured daysIntervalThreshold)
 * 2. Inactivity: when idle for 48 hours (or configured inactivityHoursThreshold)
 */
export function shouldAutoOptimize(
  memoryDir: string,
  options: { inactivityHoursThreshold?: number; daysIntervalThreshold?: number } = {},
): { shouldRun: boolean; reason?: string } {
  const meta = readOptimizationMetadata(memoryDir);
  const now = Date.now();

  const daysThreshold = options.daysIntervalThreshold ?? 7;
  const daysMs = daysThreshold * 24 * 60 * 60 * 1000;

  const hoursThreshold = options.inactivityHoursThreshold ?? 48;
  const hoursMs = hoursThreshold * 60 * 60 * 1000;

  const lastOpt = Date.parse(meta.last_optimized_at) || 0;
  const lastAct = Date.parse(meta.last_activity_at) || now;

  // 1. Scheduled Cadence Check (e.g. 7 days elapsed since last optimization)
  if (now - lastOpt >= daysMs) {
    return {
      shouldRun: true,
      reason: `Scheduled ${daysThreshold}-day cadence reached (${Math.round((now - lastOpt) / (24 * 3600 * 1000))}d since last run)`,
    };
  }

  // 2. Inactivity Check (e.g. inactive for >= 48 hours and hasn't been optimized for >= 48 hours)
  if (now - lastAct >= hoursMs && now - lastOpt >= hoursMs) {
    return {
      shouldRun: true,
      reason: `Inactivity threshold reached (${Math.round((now - lastAct) / (3600 * 1000))}h idle)`,
    };
  }

  return { shouldRun: false };
}

/**
 * Detects test assertion noise, stack traces, and mock test outputs in unverified memories.
 */
export function isTestNoise(entry: MemoryEntry): boolean {
  // Never prune user-confirmed or authoritative memories
  if (entry.status === "confirmed" && entry.verification?.level === "user-confirmed") {
    return false;
  }

  const text = `${entry.title} ${entry.content}`;
  return (
    /error:\s*expect\(/i.test(text) ||
    /expect\([^)]+\)\.toBe/i.test(text) ||
    /expect\([^)]+\)\.toEqual/i.test(text) ||
    /expect\([^)]+\)\.toBeGreaterThan/i.test(text) ||
    /expect\(received\)/i.test(text) ||
    /at\s+<anonymous>\s+\([^)]+\.test\.(ts|js)/i.test(text) ||
    /Ran\s+\d+\s+tests\s+across/i.test(text) ||
    /\.test\.(ts|js):\d+:\d+/i.test(text) ||
    /TypeError:\s*store\./i.test(text) ||
    /AssertionError:/i.test(text) ||
    /✗\s+Universal Agent Transcript/i.test(text) ||
    /\b\d+\s+pass\s+\d+\s+fail\b/i.test(text) ||
    /✓\s+[^\n]+\[\d+\.?\d*ms\]/i.test(text)
  );
}

/**
 * Detects junk micro-fragments, single punctuation, or parser transcript headers.
 */
export function isJunkFragment(entry: MemoryEntry): boolean {
  const title = (entry.title || "").trim();
  const content = (entry.content || "").trim();

  // Obvious junk: single characters or numbers even if marked confirmed
  if (content.length <= 5 && (/^['"]?[0-9]+['"]?$/.test(title) || title === "+" || title === "-" || title === "|" || title === ">-")) {
    return true;
  }

  // Massive raw terminal/tool output dumps
  if (
    content.includes("The following code has been modified") ||
    content.includes("The above content does NOT show the entire file contents") ||
    content.includes("MODEL PLANNER_RESPONSE") ||
    content.includes("</SYSTEM_MESSAGE>") ||
    (content.split("\n").length > 50 && content.includes("Completed At:")) ||
    content.includes("<truncated") ||
    (content.includes("expect(") && /expect\([^)]+\)\.toBe/i.test(content))
  ) {
    return true;
  }

  if (entry.status === "confirmed") return false;

  // Single characters or trivial punctuation
  if (title === "1" || title === "+" || title === "-" || title === "|" || title === ">-") {
    return true;
  }

  // Numeric only titles like '12', '34'
  if (/^['"]?[0-9]+['"]?$/.test(title)) {
    return true;
  }

  // Very short content with no meaningful substance
  if (content.length < 15) {
    return true;
  }

  // Accidental transcript delimiters, tool outputs, or diff noise
  if (
    content.includes("create mode 100644") ||
    content.includes("File Path: `file://") ||
    content.includes("Showing lines ")
  ) {
    return true;
  }

  return false;
}

/**
 * Executes a full repository and database optimization pass:
 * 1. Prunes test assertion noise in candidate memories
 * 2. Prunes junk fragments & micro-snippets
 * 3. Deduplicates redundant candidate memories
 * 4. Executes SQLite VACUUM and PRAGMA optimize to defragment and reclaim disk space
 * 5. Logs audit event and updates optimization cadence metadata
 */
export function optimizeStore(store: Store, options: OptimizeOptions = {}): OptimizeReport {
  const startTime = Date.now();
  const memoryDir = options.memoryDir || store.memoryDir || ".memory";

  // Check cadence if not forced
  if (!options.force) {
    const autoCheck = shouldAutoOptimize(memoryDir, {
      inactivityHoursThreshold: options.inactivityHoursThreshold,
      daysIntervalThreshold: options.daysIntervalThreshold,
    });
    if (!autoCheck.shouldRun) {
      return {
        timestamp: new Date().toISOString(),
        totalBefore: 0,
        totalAfter: 0,
        prunedNoise: 0,
        prunedJunk: 0,
        prunedDuplicates: 0,
        totalPruned: 0,
        spaceReclaimedBytes: 0,
        vacuumExecuted: false,
        skippedReason: "Optimization thresholds not met (7-day cadence or 48-hour inactivity)",
        durationMs: Date.now() - startTime,
      };
    }
  }

  const allEntries = list(store, options.project ? { project: options.project } : undefined);
  const totalBefore = allEntries.length;

  const getDbSize = (): number => {
    try {
      const dbPath = join(memoryDir, "memory.db");
      if (existsSync(dbPath)) {
        return statSync(dbPath).size;
      }
    } catch {}
    return 0;
  };

  const dbSizeBefore = getDbSize();

  const toDeleteNoise: string[] = [];
  const toDeleteJunk: string[] = [];
  const toDeleteDuplicates: string[] = [];

  const seenHashes = new Map<string, string>();

  for (const entry of allEntries) {
    if (entry.status !== "confirmed" && isTestNoise(entry)) {
      toDeleteNoise.push(entry.id);
      continue;
    }
    if (isJunkFragment(entry)) {
      toDeleteJunk.push(entry.id);
      continue;
    }

    if (entry.status === "candidate") {
      const normKey = `${normalizeText(entry.title)}|${normalizeText(entry.content.slice(0, 120))}`;
      if (seenHashes.has(normKey)) {
        toDeleteDuplicates.push(entry.id);
      } else {
        seenHashes.set(normKey, entry.id);
      }
    }
  }

  const totalPruned = toDeleteNoise.length + toDeleteJunk.length + toDeleteDuplicates.length;

  if (!options.dryRun) {
    if (store.db) {
      try { store.db.exec("BEGIN TRANSACTION;"); } catch {}
    }

    for (const id of toDeleteNoise) {
      deleteEntry(store, id, "Automated optimize: pruned test assertion noise");
    }
    for (const id of toDeleteJunk) {
      deleteEntry(store, id, "Automated optimize: pruned junk fragment");
    }
    for (const id of toDeleteDuplicates) {
      deleteEntry(store, id, "Automated optimize: pruned duplicate candidate");
    }

    if (store.db) {
      try { store.db.exec("COMMIT;"); } catch {}
    }

    // Vacuum and optimize SQLite storage
    if (store.db) {
      try {
        store.db.exec("VACUUM;");
        store.db.exec("PRAGMA optimize;");
      } catch {}
    }

    // Synchronize and sanitize CURRENT.md constraints
    try {
      syncConstraints(memoryDir, store);
    } catch {}
  }

  const dbSizeAfter = getDbSize();
  const spaceReclaimedBytes = Math.max(0, dbSizeBefore - dbSizeAfter);

  const remainingEntries = list(store, options.project ? { project: options.project } : undefined);
  const totalAfter = options.dryRun ? (totalBefore - totalPruned) : remainingEntries.length;

  const report: OptimizeReport = {
    timestamp: new Date().toISOString(),
    totalBefore,
    totalAfter,
    prunedNoise: toDeleteNoise.length,
    prunedJunk: toDeleteJunk.length,
    prunedDuplicates: toDeleteDuplicates.length,
    totalPruned,
    spaceReclaimedBytes,
    vacuumExecuted: !options.dryRun && !!store.db,
    durationMs: Date.now() - startTime,
  };

  if (!options.dryRun) {
    // Record audit event
    recordAuditEvent(memoryDir, {
      operation: "optimize",
      entry_id: "store",
      project: options.project || "all",
      actor: "system:optimizer",
      reason: `Optimized store: pruned ${totalPruned} items, reclaimed ${spaceReclaimedBytes} bytes`,
    });

    // Update metadata
    const meta = readOptimizationMetadata(memoryDir);
    meta.last_optimized_at = report.timestamp;
    meta.last_activity_at = report.timestamp;
    meta.total_optimizations = (meta.total_optimizations || 0) + 1;
    meta.last_report = report;
    writeOptimizationMetadata(memoryDir, meta);
  }

  return report;
}

/**
 * Pre-flight hook: automatically runs optimization if cadence thresholds are met.
 * Can be safely called on CLI commands or session initializations with negligible overhead.
 */
export function maybeAutoOptimize(store: Store, memoryDir?: string): OptimizeReport | null {
  const dir = memoryDir || store.memoryDir || ".memory";
  const check = shouldAutoOptimize(dir);
  if (!check.shouldRun) return null;

  try {
    return optimizeStore(store, { memoryDir: dir, force: true });
  } catch {
    return null;
  }
}
