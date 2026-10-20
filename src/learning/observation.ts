import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "../store.ts";
import type { ObservationEntry } from "../types.ts";
import { scanSecrets } from "../secrets.ts";

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
