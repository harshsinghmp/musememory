import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getAuditStorageStats } from "./audit.ts";

/** Parsed fields from `/proc/self/io` (kernel counters are byte counts). */
export interface IoCounters {
  [field: string]: number;
}

/**
 * Parses the `key: value` lines of `/proc/self/io`. Unknown lines are ignored
 * so kernel additions do not break the report.
 */
export function parseProcIo(text: string): IoCounters {
  const counters: IoCounters = {};
  for (const raw of text.split("\n")) {
    const match = /^([a-z_]+):\s*(\d+)\s*$/.exec(raw.trim());
    if (match) counters[match[1]] = Number(match[2]);
  }
  return counters;
}

export function readProcIo(path: string = "/proc/self/io"): IoCounters | null {
  try {
    if (!existsSync(path)) return null;
    return parseProcIo(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export interface StoreDiskUsage {
  memory_db_bytes: number;
  wal_bytes: number;
  audit_bytes: number;
  observations_bytes: number;
  total_bytes: number;
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/** Byte footprint of the store's append-only and SQLite artifacts. */
export function storeDiskUsage(memoryDir: string): StoreDiskUsage {
  const memory_db_bytes = fileSize(join(memoryDir, "memory.db"));
  const wal_bytes = fileSize(join(memoryDir, "memory.db-wal")) + fileSize(join(memoryDir, "memory.db-shm"));
  const audit_bytes = getAuditStorageStats(memoryDir).bytes;
  const observations_bytes = fileSize(join(memoryDir, "observations.jsonl"));
  return {
    memory_db_bytes,
    wal_bytes,
    audit_bytes,
    observations_bytes,
    total_bytes: memory_db_bytes + wal_bytes + audit_bytes + observations_bytes,
  };
}

export interface IoReport {
  available: boolean;
  counters: IoCounters;
  disk: StoreDiskUsage;
}

export function collectIoReport(memoryDir: string, procIoPath: string = "/proc/self/io"): IoReport {
  const counters = readProcIo(procIoPath);
  return {
    available: counters !== null,
    counters: counters ?? {},
    disk: storeDiskUsage(memoryDir),
  };
}
