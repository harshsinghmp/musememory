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

export function isBiTemporallyVisible(entry: MemoryEntry, query: BiTemporalQuery): boolean {
  if (query.validAt) {
    const from = entry.valid_from ?? entry.created_at;
    if (from && from > query.validAt) return false;
    const to = entry.valid_to ?? entry.ended_at;
    if (to && to <= query.validAt) return false;
  }
  if (query.assertedAt) {
    const asserted = entry.asserted_at ?? entry.created_at;
    if (asserted && asserted > query.assertedAt) return false;
  }
  return true;
}

export function filterBiTemporal(entries: MemoryEntry[], query: BiTemporalQuery): MemoryEntry[] {
  if (!query.validAt && !query.assertedAt) return entries;
  return entries.filter((entry) => isBiTemporallyVisible(entry, query));
}
