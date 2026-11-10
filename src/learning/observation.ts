import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "../store.ts";
import type { ObservationEntry } from "../types.ts";
import { scanSecrets } from "../secrets.ts";
import { appendJsonlWithFsync, withStoreLock } from "../lock.ts";

export const MAX_OBSERVATIONS_FILE_BYTES = 256 * 1024; // 256 KB default cap

export function observationsFilePath(memoryDir: string): string {
  return join(memoryDir, "observations.jsonl");
}

function atomicWriteFileSync(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmpPath, content, "utf8");
  renameSync(tmpPath, filePath);
}

/**
 * Rotates observations.jsonl if it exceeds maxBytes:
 * - Retains all unprocessed observations and recent processed ones in active file.
 * - Rotates older processed observations to observations.1.jsonl.
 */
export function rotateObservationsIfNeeded(
  memoryDir: string,
  maxBytes: number = MAX_OBSERVATIONS_FILE_BYTES,
): boolean {
  const filePath = observationsFilePath(memoryDir);
  if (!existsSync(filePath)) return false;

  const currentSize = statSync(filePath).size;
  if (currentSize <= maxBytes) return false;

  const rawLines = readFileSync(filePath, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const entries: ObservationEntry[] = [];
  for (const line of rawLines) {
    try {
      entries.push(JSON.parse(line));
    } catch {}
  }

  const unprocessed = entries.filter((e) => !e.processed);
  const processed = entries.filter((e) => e.processed);

  // Unprocessed observations MUST be preserved in active log
  const activeEntries: ObservationEntry[] = [...unprocessed];
  let currentBytes = activeEntries.reduce((acc, e) => acc + JSON.stringify(e).length + 1, 0);

  const archivedProcessed: ObservationEntry[] = [];
  const keptProcessed: ObservationEntry[] = [];

  // Take processed items from newest to oldest as long as they fit within maxBytes
  for (let i = processed.length - 1; i >= 0; i--) {
    const item = processed[i];
    const itemBytes = JSON.stringify(item).length + 1;
    if (currentBytes + itemBytes <= maxBytes) {
      keptProcessed.unshift(item);
      currentBytes += itemBytes;
    } else {
      archivedProcessed.unshift(item);
    }
  }

  activeEntries.unshift(...keptProcessed);

  if (archivedProcessed.length > 0) {
    const archivePath = join(memoryDir, "observations.1.jsonl");
    const archiveContent = archivedProcessed.map((e) => JSON.stringify(e)).join("\n") + "\n";
    appendFileSync(archivePath, archiveContent, "utf8");
  }

  const activeContent = activeEntries.length > 0
    ? activeEntries.map((e) => JSON.stringify(e)).join("\n") + "\n"
    : "";

  atomicWriteFileSync(filePath, activeContent);
  return true;
}

/**
 * Records an ephemeral observation (raw event, tool output, test failure, file diff)
 * to .memory/observations.jsonl.
 */
export function recordObservation(
  store: Store,
  obs: {
    source: ObservationEntry["source"];
    project: string;
    raw: string;
    summary?: string;
    metadata?: Record<string, any>;
  },
): ObservationEntry {
  if (!obs.raw || !obs.raw.trim()) {
    throw new Error("Cannot record observation with empty raw content");
  }

  // Intercept secrets across summary, raw content, and stringified metadata (T-389)
  const metaStr = obs.metadata ? JSON.stringify(obs.metadata) : "";
  const secrets = scanSecrets(`${obs.summary ?? ""} ${obs.raw} ${metaStr}`);
  if (secrets.length > 0) {
    throw new Error(`Probable secret detected in observation: ${secrets.join(", ")}`);
  }

  const memoryDir = store.memoryDir || store.dir;
  const filePath = observationsFilePath(memoryDir);

  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }

  const id = `obs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const entry: ObservationEntry = {
    id,
    timestamp: new Date().toISOString(),
    source: obs.source,
    project: obs.project,
    raw: obs.raw,
    summary: obs.summary,
    metadata: obs.metadata,
    processed: false,
  };

  appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf8");
  rotateObservationsIfNeeded(memoryDir);
  return entry;
}

/**
 * Reads all observations from .memory/observations.jsonl with optional filtering.
 */
export function listObservations(
  store: Store,
  options?: { processed?: boolean; project?: string },
): ObservationEntry[] {
  const memoryDir = store.memoryDir || store.dir;
  const filePath = observationsFilePath(memoryDir);
  if (!existsSync(filePath)) return [];

  const lines = readFileSync(filePath, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const results: ObservationEntry[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as ObservationEntry;
      if (options?.processed !== undefined && parsed.processed !== options.processed) {
        continue;
      }
      if (options?.project && parsed.project !== options.project) {
        continue;
      }
      results.push(parsed);
    } catch {}
  }

  return results;
}

/**
 * R31: merge observations from other writers into this store's ledger.
 *
 * The observation log is append-only, so merging is a set union keyed on
 * `id` — an existing observation is never rewritten or dropped, which means
 * re-merging the same batch is idempotent. Entries are appended under the
 * single-writer lock so two concurrent merges cannot interleave partial
 * lines, and each append is fsynced (`appendJsonlWithFsync`) because a
 * half-written observation would corrupt every later read of the file.
 *
 * Returns the ids actually appended, so a caller can report what landed
 * instead of assuming the whole batch was new.
 */
export function mergeObservations(
  store: Store,
  incoming: ObservationEntry[],
): { appended: string[]; skipped: number } {
  if (!Array.isArray(incoming) || incoming.length === 0) return { appended: [], skipped: 0 };

  const memoryDir = store.memoryDir || store.dir;
  if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });
  const filePath = observationsFilePath(memoryDir);

  return withStoreLock(memoryDir, () => {
    const existing = new Set(listObservations(store).map((o) => o.id));
    const appended: string[] = [];
    let skipped = 0;

    for (const entry of incoming) {
      if (!entry || typeof entry.id !== "string" || !entry.id) {
        skipped++;
        continue;
      }
      if (existing.has(entry.id)) {
        skipped++;
        continue;
      }
      // Never admit an unvalidated record: the ledger feeds prompt context.
      if (typeof entry.raw !== "string" || !entry.raw.trim()) {
        skipped++;
        continue;
      }
      appendJsonlWithFsync(filePath, JSON.stringify(entry));
      existing.add(entry.id);
      appended.push(entry.id);
    }

    return { appended, skipped };
  });
}

/**
 * Marks an observation as processed and links the candidate memory entry ID.
 */
export function markObservationProcessed(
  store: Store,
  observationId: string,
  extractedCandidateId?: string,
): boolean {
  const memoryDir = store.memoryDir || store.dir;
  const filePath = observationsFilePath(memoryDir);
  if (!existsSync(filePath)) return false;

  const lines = readFileSync(filePath, "utf8").split("\n").filter((l) => l.trim().length > 0);
  let updated = false;
  const newLines: string[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as ObservationEntry;
      if (parsed.id === observationId) {
        parsed.processed = true;
        if (extractedCandidateId) parsed.extracted_candidate_id = extractedCandidateId;
        updated = true;
      }
      newLines.push(JSON.stringify(parsed));
    } catch {
      newLines.push(line);
    }
  }

  if (updated) {
    atomicWriteFileSync(filePath, `${newLines.join("\n")}\n`);
  }

  return updated;
}
