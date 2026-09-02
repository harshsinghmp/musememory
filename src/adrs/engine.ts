import type { Store } from "../store.ts";
import { get, list, save } from "../store.ts";
import { recordAuditEvent } from "../audit.ts";
import type { MemoryEntry, CodeAnchor } from "../types.ts";
import type { RecordAdrOptions, AdrStatus, AdrDetails } from "./types.ts";
import { createCodeAnchor } from "../anchors/resolver.ts";

/**
 * Assigns the next sequential ADR number within the repository.
 */
export function getNextAdrNumber(store: Store): number {
  const entries = list(store);
  let maxNum = 0;

  for (const e of entries) {
    if (e.adr?.adr_number && e.adr.adr_number > maxNum) {
      maxNum = e.adr.adr_number;
    }
  }

  return maxNum + 1;
}

/**
 * Formats structured ADR metadata into readable Markdown content.
 */
export function formatAdrContent(
  adrNum: number,
  options: RecordAdrOptions
): string {
  const status = options.status || "accepted";
  const parts: string[] = [
    `# ADR-${adrNum}: ${options.title}`,
    "",
    `## Status`,
    `${status.toUpperCase()}`,
    "",
    `## Context & Drivers`,
  ];

  for (const driver of options.context_and_drivers) {
    parts.push(`- ${driver}`);
  }

  parts.push("");
  parts.push("## Decision");
  parts.push(options.decision.trim());

  parts.push("");
  parts.push("## Consequences");

  if (options.consequences.positive && options.consequences.positive.length > 0) {
    parts.push("### Positive");
    for (const pos of options.consequences.positive) {
      parts.push(`- ✅ ${pos}`);
    }
  }

  if (options.consequences.negative && options.consequences.negative.length > 0) {
    parts.push("### Negative / Trade-offs");
    for (const neg of options.consequences.negative) {
      parts.push(`- ⚠️ ${neg}`);
    }
  }

  if (options.consequences.neutral && options.consequences.neutral.length > 0) {
    parts.push("### Neutral / Operational");
    for (const neu of options.consequences.neutral) {
      parts.push(`- ℹ️ ${neu}`);
    }
  }

  if (options.options_considered && options.options_considered.length > 0) {
    parts.push("");
    parts.push("## Options Considered");
    for (const opt of options.options_considered) {
      parts.push(`### Option: ${opt.title}`);
      if (opt.pros && opt.pros.length > 0) {
        parts.push(`- **Pros**: ${opt.pros.join("; ")}`);
      }
      if (opt.cons && opt.cons.length > 0) {
        parts.push(`- **Cons**: ${opt.cons.join("; ")}`);
      }
      if (opt.rejected_reason) {
        parts.push(`- **Rejected Reason**: ${opt.rejected_reason}`);
      }
    }
  }

  return parts.join("\n");
}

/**
 * Records a first-class Architecture Decision Record (ADR) as an active memory entity.
 */
export function recordAdr(
  store: Store,
  workspaceRoot: string,
  options: RecordAdrOptions
): MemoryEntry {
  const adrNum = options.adr_number ?? getNextAdrNumber(store);
  const now = new Date().toISOString();
  const status: AdrStatus = options.status || "accepted";
  const id = `m_${Date.now()}_adr_${adrNum}`;

  // 1. Build native code anchors for affected files and symbols
  const anchors: CodeAnchor[] = [];
  if (options.affected_files && options.affected_files.length > 0) {
    for (const file of options.affected_files) {
      const symbols = options.affected_symbols || [];
      if (symbols.length > 0) {
        for (const sym of symbols) {
          const anc = createCodeAnchor(workspaceRoot, {
            kind: "symbol",
            filePath: file,
            symbolName: sym,
          });
          anchors.push(anc);
        }
      } else {
        const anc = createCodeAnchor(workspaceRoot, {
          kind: "file",
          filePath: file,
        });
        anchors.push(anc);
      }
    }
  }

  // 2. Format content
  const content = formatAdrContent(adrNum, options);

  const adrDetails: AdrDetails = {
    adr_number: adrNum,
    status,
    decision: options.decision,
    drivers: options.context_and_drivers,
    consequences: options.consequences,
    options_considered: options.options_considered,
    supersedes: options.supersedes,
  };

  const entry: MemoryEntry = {
    id,
    title: `ADR-${adrNum}: ${options.title}`,
    content,
    project: options.project,
    status: status === "proposed" ? "candidate" : "confirmed",
    type: "adr",
    temporal_mode: "timeless",
    created_at: now,
    updated_at: now,
    source: "adr_recorder",
    tags: Array.from(new Set(["adr", "architecture", ...(options.tags || [])])),
    anchors: anchors.length > 0 ? anchors : undefined,
    adr: adrDetails,
    verification: { level: "authoritative" },
  };

  // 3. Handle supersedes link
  if (options.supersedes) {
    supersedeAdr(store, options.supersedes, id, options.actor);
  }

  save(store, entry);

  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "adr_recorded",
      entry_id: id,
      project: options.project,
      actor: options.actor || "architect",
      reason: `Recorded ADR-${adrNum}: ${options.title} (${status})`,
      details: adrDetails as any,
    });
  }

  return entry;
}

/**
 * Marks an existing ADR as superseded by a newer ADR.
 */
export function supersedeAdr(
  store: Store,
  oldAdrId: string,
  newAdrId: string,
  actor: string = "architect"
): void {
  const oldEntry = get(store, oldAdrId);
  if (!oldEntry) return;

  const now = new Date().toISOString();
  oldEntry.status = "superseded";
  oldEntry.valid_to = now;
  oldEntry.superseded_by = newAdrId;

  if (oldEntry.adr) {
    oldEntry.adr.status = "superseded";
    oldEntry.adr.superseded_by = newAdrId;
  }

  oldEntry.updated_at = now;
  save(store, oldEntry);

  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "adr_superseded",
      entry_id: oldAdrId,
      project: oldEntry.project,
      actor,
      reason: `ADR '${oldAdrId}' superseded by '${newAdrId}'`,
      details: { superseded_by: newAdrId },
    });
  }
}

/**
 * Lists all ADRs in the store, optionally filtered by status.
 */
export function listAdrs(
  store: Store,
  statusFilter?: AdrStatus
): MemoryEntry[] {
  const entries = list(store);
  const adrs = entries.filter((e) => e.type === "adr" || e.adr != null);

  const filtered = statusFilter
    ? adrs.filter((e) => e.adr?.status === statusFilter)
    : adrs;

  return filtered.sort((a, b) => (a.adr?.adr_number || 0) - (b.adr?.adr_number || 0));
}
