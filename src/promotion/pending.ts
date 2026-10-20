import fs from "node:fs";
import path from "node:path";
import type { Store } from "../store.ts";
import { get, save } from "../store.ts";
import { recordAuditEvent } from "../audit.ts";
import type { MemoryScope } from "../types.ts";
import type {
  PendingPromotionEntry,
  StagePendingOptions,
  FlushPendingOptions,
  FlushPendingResult,
} from "./types.ts";
import { evaluatePromotion, getEntryScope, promoteMemory } from "./engine.ts";

export function getPendingFilePath(memoryDir: string): string {
  return path.join(memoryDir, "pending_promotions.json");
}

export function loadPendingPromotions(memoryDir: string): PendingPromotionEntry[] {
  const filePath = getPendingFilePath(memoryDir);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingPromotionEntry[]) : [];
  } catch {
    return [];
  }
}

export function savePendingPromotions(memoryDir: string, entries: PendingPromotionEntry[]): void {
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }
  const filePath = getPendingFilePath(memoryDir);
  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
  fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}

/**
 * Stages a memory entry into the pending promotion tier.
 * Intra-session changes stage here before session-end evaluation and flush.
 */
export function stagePendingPromotion(
  store: Store,
  memoryId: string,
  options: StagePendingOptions = {}
): PendingPromotionEntry {
  const entry = get(store, memoryId);
  if (!entry) {
    throw new Error(`Memory entry '${memoryId}' not found in store`);
  }

  const currentScope = getEntryScope(entry);
  const targetScope: MemoryScope =
    options.targetScope ?? (currentScope === "local" ? "project" : "global");

  const evalResult = evaluatePromotion(entry, { forceManual: options.forceManual });

  const now = new Date().toISOString();
  const pendingId = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const pendingEntry: PendingPromotionEntry = {
    id: pendingId,
    memory_id: memoryId,
    current_scope: currentScope,
    target_scope: targetScope,
    staged_at: now,
    session_id: options.sessionId,
    actor: options.actor ?? "agent",
    reason: options.reason,
    generalized_content: options.generalizedContent,
    force_manual: options.forceManual,
    status: "pending",
    evaluation: evalResult,
  };

  const dir = store.memoryDir;
  if (dir) {
    const existing = loadPendingPromotions(dir);
    existing.push(pendingEntry);
    savePendingPromotions(dir, existing);

    recordAuditEvent(dir, {
      operation: "stage_pending_promotion",
      entry_id: memoryId,
      project: entry.project,
      actor: options.actor ?? "agent",
      reason: options.reason ?? "Staged in pending promotion tier",
      details: {
        pending_id: pendingId,
        target_scope: targetScope,
        eligible: evalResult.eligible,
      },
    });
  }

  return pendingEntry;
}

/**
 * Lists pending promotion entries with optional filtering.
 */
export function listPendingPromotions(
  store: Store,
  options: { sessionId?: string; status?: "pending" | "flushed" | "cancelled" | "rejected" } = {}
): PendingPromotionEntry[] {
  const dir = store.memoryDir;
  if (!dir) return [];
  const entries = loadPendingPromotions(dir);
  return entries.filter((entry) => {
    if (options.status && entry.status !== options.status) return false;
    if (options.sessionId && entry.session_id !== options.sessionId) return false;
    return true;
  });
}

/**
 * Cancels a pending promotion.
 */
export function cancelPendingPromotion(
  store: Store,
  pendingIdOrMemoryId: string,
  reason?: string
): boolean {
  const dir = store.memoryDir;
  if (!dir) return false;
  const entries = loadPendingPromotions(dir);
  let found = false;

  for (const item of entries) {
    if ((item.id === pendingIdOrMemoryId || item.memory_id === pendingIdOrMemoryId) && item.status === "pending") {
      item.status = "cancelled";
      found = true;
      if (dir) {
        recordAuditEvent(dir, {
          operation: "cancel_pending_promotion",
          entry_id: item.memory_id,
          actor: "agent",
          reason: reason ?? "Pending promotion cancelled",
          details: { pending_id: item.id },
        });
      }
      break;
    }
  }

  if (found) {
    savePendingPromotions(dir, entries);
  }

  return found;
}

/**
 * Flushes pending promotions for a session or globally.
 * Evaluates pending entries and applies promotion or marks rejection.
 */
export function flushPendingPromotions(
  store: Store,
  options: FlushPendingOptions = {}
): FlushPendingResult {
  const dir = store.memoryDir;
  if (!dir) {
    return {
      total_staged: 0,
      promoted_count: 0,
      rejected_count: 0,
      results: [],
    };
  }

  const entries = loadPendingPromotions(dir);
  const toFlush = entries.filter((item) => {
    if (item.status !== "pending") return false;
    if (options.sessionId && item.session_id !== options.sessionId) return false;
    return true;
  });

  const results: FlushPendingResult["results"] = [];
  let promotedCount = 0;
  let rejectedCount = 0;

  for (const item of toFlush) {
    if (options.dryRun) {
      const currentEntry = get(store, item.memory_id);
      if (!currentEntry) {
        results.push({
          memory_id: item.memory_id,
          pending_id: item.id,
          target_scope: item.target_scope,
          promoted: false,
          message: `Memory entry '${item.memory_id}' not found in store`,
        });
        rejectedCount++;
      } else {
        const evaluation = evaluatePromotion(currentEntry, { forceManual: item.force_manual });
        results.push({
          memory_id: item.memory_id,
          pending_id: item.id,
          target_scope: item.target_scope,
          promoted: evaluation.eligible,
          message: evaluation.eligible
            ? "Dry run: qualifies for promotion"
            : `Dry run: rejected (${evaluation.reasons.join("; ")})`,
        });
        if (evaluation.eligible) {
          promotedCount++;
        } else {
          rejectedCount++;
        }
      }
      continue;
    }

    const promoResult = promoteMemory(store, item.memory_id, {
      forceManual: item.force_manual,
      targetScope: item.target_scope,
      actor: options.actor ?? item.actor,
      customGeneralizedContent: item.generalized_content,
    });

    if (promoResult.promoted) {
      item.status = "flushed";
      item.flushed_at = new Date().toISOString();
      promotedCount++;
      results.push({
        memory_id: item.memory_id,
        pending_id: item.id,
        target_scope: item.target_scope,
        promoted: true,
        message: promoResult.message,
      });
    } else {
      item.status = "rejected";
      rejectedCount++;
      results.push({
        memory_id: item.memory_id,
        pending_id: item.id,
        target_scope: item.target_scope,
        promoted: false,
        message: promoResult.message,
      });
    }
  }

  if (!options.dryRun && toFlush.length > 0) {
    savePendingPromotions(dir, entries);

    recordAuditEvent(dir, {
      operation: "flush_pending_promotions",
      entry_id: options.sessionId ?? "pending_promotion_flush",
      actor: options.actor ?? "agent",
      reason: "Flushed pending promotions at session close or manual trigger",
      details: {
        total_staged: toFlush.length,
        promoted: promotedCount,
        rejected: rejectedCount,
        session_id: options.sessionId,
      },
    });
  }

  return {
    total_staged: toFlush.length,
    promoted_count: promotedCount,
    rejected_count: rejectedCount,
    results,
  };
}
