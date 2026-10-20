/**
 * T-133: Degraded Retrieval Fault Signals
 *
 * Provides structured fault signals and explicit fault notes when retrieval
 * operates in degraded or fallback modes (circuit breaker open, FTS5 failure,
 * stale cache, unparseable anchors, corrupted digests).
 */

export interface DegradedFaultSignal {
  degraded: boolean;
  degraded_notes?: string[];
  fault_notes?: string[];
}

/**
 * Creates a structured degraded fault signal from an array of diagnostic notes.
 */
export function createDegradedFaultSignal(notes: string[] = []): DegradedFaultSignal {
  const cleanNotes = notes.map((n) => n.trim()).filter(Boolean);
  const isDegraded = cleanNotes.length > 0;
  return {
    degraded: isDegraded,
    degraded_notes: isDegraded ? cleanNotes : undefined,
    fault_notes: isDegraded ? cleanNotes : undefined,
  };
}

/**
 * Merges multiple fault signals into a single unified degraded fault signal.
 */
export function mergeDegradedFaults(
  ...signals: Array<DegradedFaultSignal | { degraded?: boolean; degraded_notes?: string[]; fault_notes?: string[] } | undefined>
): DegradedFaultSignal {
  const allNotes: string[] = [];
  let isDegraded = false;

  for (const sig of signals) {
    if (!sig) continue;
    if (sig.degraded) isDegraded = true;
    const notes = sig.degraded_notes || sig.fault_notes;
    if (notes) {
      for (const n of notes) {
        if (n && !allNotes.includes(n)) {
          allNotes.push(n);
        }
      }
    }
  }

  if (isDegraded && allNotes.length === 0) {
    allNotes.push("retrieval_degraded: operating in fallback mode due to subsystem fault");
  }

  return {
    degraded: isDegraded || allNotes.length > 0,
    degraded_notes: allNotes.length > 0 ? allNotes : undefined,
    fault_notes: allNotes.length > 0 ? allNotes : undefined,
  };
}

/**
 * Renders an explicit warning block in Markdown detailing degraded retrieval faults.
 */
export function formatDegradedFaultNotice(notes?: string[]): string {
  if (!notes || notes.length === 0) return "";
  const lines = [
    "> ⚠️ **Degraded Retrieval Fault**: Operating in degraded fallback mode due to:",
    ...notes.map((n) => `> - ${n}`),
    "",
  ];
  return lines.join("\n");
}
