import type { MemoryEntry } from "./types.ts";

/**
 * T-429: bi-temporal windows. `validAt` asks what was true in the world;
 * `assertedAt` asks what the system believed at that time. An entry is
 * visible only when both clocks admit it.
 */
export interface BiTemporalQuery {
  validAt?: string;
  assertedAt?: string;
}

function epoch(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`Invalid ${label} timestamp: ${value}`);
  return parsed;
}

export function isBiTemporallyVisible(entry: MemoryEntry, query: BiTemporalQuery): boolean {
  if (query.validAt) {
    const at = epoch(query.validAt, "validAt");
    const fromValue = entry.valid_from ?? entry.created_at;
    if (fromValue && epoch(fromValue, "valid_from") > at) return false;
    if (entry.valid_to && epoch(entry.valid_to, "valid_to") <= at) return false;
  }
  if (query.assertedAt) {
    const at = epoch(query.assertedAt, "assertedAt");
    const asserted = entry.asserted_at ?? entry.created_at;
    if (asserted && epoch(asserted, "asserted_at") > at) return false;
  }
  return true;
}

export function filterBiTemporal(entries: MemoryEntry[], query: BiTemporalQuery): MemoryEntry[] {
  if (!query.validAt && !query.assertedAt) return entries;
  return entries.filter((entry) => isBiTemporallyVisible(entry, query));
}
