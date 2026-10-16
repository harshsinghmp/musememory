import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AuditEntry, AuditOperation } from "./types.ts";
import { appendJsonlWithFsync } from "./lock.ts";

export function auditFilePath(memoryDir: string): string {
  return join(memoryDir, "audit.jsonl");
}

/**
 * Appends a structured audit event to the append-only audit ledger (.memory/audit.jsonl).
 * T-044: Guarantees fsync crash durability on every event line written.
 */
export function recordAuditEvent(
  memoryDir: string,
  event: {
    operation: AuditOperation;
    entry_id: string;
    project?: string;
    actor?: string;
    reason?: string;
    details?: Record<string, any>;
  },
): AuditEntry {
  const auditPath = auditFilePath(memoryDir);
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }

  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    operation: event.operation,
    entry_id: event.entry_id,
    project: event.project,
    actor: event.actor ?? "agent",
    reason: event.reason,
    details: event.details,
  };

  appendJsonlWithFsync(auditPath, JSON.stringify(entry));
  return entry;
}

export interface AuditQueryOptions {
  operation?: string;
  entryId?: string;
  limit?: number;
}

/**
 * Reads audit trail from .memory/audit.jsonl in reverse chronological order.
 */
export function getAuditTrail(memoryDir: string, options: AuditQueryOptions = {}): AuditEntry[] {
  const auditPath = auditFilePath(memoryDir);
  if (!existsSync(auditPath)) return [];

  const raw = readFileSync(auditPath, "utf8");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const entries: AuditEntry[] = [];

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]) as AuditEntry;
      if (options.operation && parsed.operation !== options.operation) {
        continue;
      }
      if (options.entryId && parsed.entry_id !== options.entryId) {
        continue;
      }
      entries.push(parsed);
      if (options.limit && entries.length >= options.limit) {
        break;
      }
    } catch {
      // Ignore corrupt lines
    }
  }

  return entries;
}
