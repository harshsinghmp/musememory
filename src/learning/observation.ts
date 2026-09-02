import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "../store.ts";
import type { ObservationEntry } from "../types.ts";
import { scanSecrets } from "../secrets.ts";

export function observationsFilePath(memoryDir: string): string {
  return join(memoryDir, "observations.jsonl");
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

  // Intercept secrets
  const secrets = scanSecrets(`${obs.summary ?? ""} ${obs.raw}`);
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
    writeFileSync(filePath, `${newLines.join("\n")}\n`, "utf8");
  }

  return updated;
}
