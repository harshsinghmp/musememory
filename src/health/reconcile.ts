import { basename } from "node:path";
import type { Store } from "../store.ts";
import { list, save } from "../store.ts";
import { recordAuditEvent } from "../audit.ts";
import { verifyCodeAnchor } from "../anchors/resolver.ts";
import type { CodeAnchor } from "../types.ts";

export interface ReconcileOptions {
  prune?: boolean;
  markStale?: boolean;
  updateHashes?: boolean;
  dryRun?: boolean;
  workspaceRoot?: string;
  actor?: string;
}

export interface ReconcileDetail {
  entryId: string;
  title: string;
  actionsTaken: string[];
  orphanedAnchors: string[];
  driftedAnchors: string[];
}

export interface ReconcileReport {
  totalAuditedEntries: number;
  totalAnchors: number;
  validCount: number;
  driftedCount: number;
  orphanedCount: number;
  prunedAnchorsCount: number;
  repairedEntriesCount: number;
  staleEntriesCount: number;
  details: ReconcileDetail[];
}

/**
 * Interactively audits and reconciles orphaned and drifted code anchors across all memories.
 * Prunes dead anchors, optionally updates drifted structural hashes, and marks abandoned memories stale.
 */
export async function reconcileCodeAnchors(
  store: Store,
  options: ReconcileOptions = {}
): Promise<ReconcileReport> {
  const root = options.workspaceRoot || store.dir || process.cwd();
  const dryRun = options.dryRun === true;
  const prune = options.prune === true;
  const markStale = options.markStale === true;
  const updateHashes = options.updateHashes === true;
  const actor = options.actor || "reconciler";

  const entries = list(store);
  let totalAuditedEntries = 0;
  let totalAnchors = 0;
  let validCount = 0;
  let driftedCount = 0;
  let orphanedCount = 0;
  let prunedAnchorsCount = 0;
  let repairedEntriesCount = 0;
  let staleEntriesCount = 0;

  const details: ReconcileDetail[] = [];

  for (const entry of entries) {
    if (!entry.anchors || entry.anchors.length === 0) continue;
    totalAuditedEntries++;

    const survivingAnchors: CodeAnchor[] = [];
    const entryOrphaned: string[] = [];
    const entryDrifted: string[] = [];
    const actionsTaken: string[] = [];

    let entryModified = false;

    for (const anchor of entry.anchors) {
      totalAnchors++;
      const verification = verifyCodeAnchor(root, anchor);

      if (verification.status === "valid") {
        validCount++;
        survivingAnchors.push(anchor);
      } else if (verification.status === "drifted") {
        driftedCount++;
        entryDrifted.push(`${anchor.file_path}${anchor.symbol_name ? `::${anchor.symbol_name}` : ""}`);

        if (updateHashes && verification.current_hash) {
          if (!dryRun) {
            anchor.structural_hash = verification.current_hash;
            anchor.verified_at = new Date().toISOString();
          }
          entryModified = true;
          actionsTaken.push(`Updated structural hash for drifted anchor '${anchor.id}'`);
        }
        survivingAnchors.push(anchor);
      } else {
        // Orphaned
        orphanedCount++;
        entryOrphaned.push(`${anchor.file_path}${anchor.symbol_name ? `::${anchor.symbol_name}` : ""}`);

        if (prune) {
          entryModified = true;
          prunedAnchorsCount++;
          actionsTaken.push(`Pruned orphaned anchor '${anchor.id}' (${verification.drift_details || "code deleted"})`);
        } else {
          survivingAnchors.push(anchor);
        }
      }
    }

    if (prune && entryModified) {
      if ((!survivingAnchors || survivingAnchors.length === 0) && markStale && entry.status === "confirmed") {
        staleEntriesCount++;
        actionsTaken.push(`Marked memory '${entry.id}' as stale (all code anchors orphaned)`);
      }

      if (!dryRun) {
        entry.anchors = survivingAnchors.length > 0 ? survivingAnchors : undefined;
        if ((!entry.anchors || entry.anchors.length === 0) && markStale && entry.status === "confirmed") {
          entry.status = "stale";
          (entry as any).stale_reason = "All associated code anchors were orphaned and pruned";
        }
        entry.updated_at = new Date().toISOString();
        save(store, entry);
      }
      repairedEntriesCount++;
    } else if (updateHashes && entryModified) {
      if (!dryRun) {
        entry.anchors = survivingAnchors.length > 0 ? survivingAnchors : undefined;
        entry.updated_at = new Date().toISOString();
        save(store, entry);
      }
      repairedEntriesCount++;
    }

    if (entryOrphaned.length > 0 || entryDrifted.length > 0 || actionsTaken.length > 0) {
      details.push({
        entryId: entry.id,
        title: entry.title,
        actionsTaken,
        orphanedAnchors: entryOrphaned,
        driftedAnchors: entryDrifted,
      });
    }
  }

  if (!dryRun && store.memoryDir && (prunedAnchorsCount > 0 || staleEntriesCount > 0)) {
    recordAuditEvent(store.memoryDir, {
      operation: "anchor_reconciled",
      entry_id: "reconcile_sweep",
      project: basename(store.dir),
      actor,
      reason: `Reconciled code anchors: ${prunedAnchorsCount} pruned, ${staleEntriesCount} staled`,
      details: {
        totalAuditedEntries,
        prunedAnchorsCount,
        staleEntriesCount,
        validCount,
        driftedCount,
        orphanedCount,
      } as any,
    });
  }

  return {
    totalAuditedEntries,
    totalAnchors,
    validCount,
    driftedCount,
    orphanedCount,
    prunedAnchorsCount,
    repairedEntriesCount,
    staleEntriesCount,
    details,
  };
}

/**
 * Formats a clean human-readable terminal report for code anchor reconciliation.
 */
export function formatReconcileReport(report: ReconcileReport, dryRun = false): string {
  const modeStr = dryRun ? " [DRY RUN]" : "";
  const header = `\n┌─────────────────────────────────────────────────────────────┐\n│ ⚓ CODE ANCHOR RECONCILIATION & ORPHAN SWEEPER${modeStr.padEnd(16)}│\n└─────────────────────────────────────────────────────────────┘\n`;

  let out = header;
  out += `\nAudited Memories:   ${report.totalAuditedEntries}\n`;
  out += `Total Code Anchors: ${report.totalAnchors}\n`;
  out += `  * Valid Anchors:    \x1b[32m${report.validCount}\x1b[0m\n`;
  out += `  * Drifted Anchors:  \x1b[33m${report.driftedCount}\x1b[0m\n`;
  out += `  * Orphaned Anchors: \x1b[31m${report.orphanedCount}\x1b[0m\n`;

  out += `\n🔧 Actions Summary:\n`;
  out += `  * Pruned Anchors:   ${report.prunedAnchorsCount}\n`;
  out += `  * Repaired Entries: ${report.repairedEntriesCount}\n`;
  out += `  * Staled Memories:  ${report.staleEntriesCount}\n`;

  if (report.details.length > 0) {
    out += `\n📋 Detailed Reconciliation Ledger:\n`;
    for (const d of report.details.slice(0, 10)) {
      out += `  - \x1b[1m${d.title}\x1b[0m (${d.entryId})\n`;
      for (const act of d.actionsTaken) {
        out += `      ✓ ${act}\n`;
      }
      for (const orph of d.orphanedAnchors) {
        out += `      ⚠️ Orphaned: ${orph}\n`;
      }
      for (const drift of d.driftedAnchors) {
        out += `      ~ Drifted: ${drift}\n`;
      }
    }
    if (report.details.length > 10) {
      out += `  ...and ${report.details.length - 10} more entries.\n`;
    }
  }

  out += `\n`;
  return out;
}
