import { existsSync, readFileSync } from "node:fs";
import type { Store } from "./store.ts";
import { list, propose, save, get } from "./store.ts";
import { validateEntry } from "./schema.ts";
import { scanSecrets } from "./secrets.ts";
import type { MemoryEntry, MemoryType } from "./types.ts";

export interface HarvestedUnit {
  title: string;
  content: string;
  type: MemoryType;
  salience: number;
  tags: string[];
}

/**
 * Distills raw conversation, transcripts, or forum/issue text into structured
 * outcome and fix memory units (filtering out conversational noise).
 *
 * Extracts explicit markers: Fix, Failure, Decision, Constraint, Architecture, Outcome, Root Cause.
 */
export function extractHarvestUnits(text: string): HarvestedUnit[] {
  if (!text || typeof text !== "string") return [];
  const lines = text.split("\n");
  const units: HarvestedUnit[] = [];

  let currentType: MemoryType | null = null;
  let currentTitle = "";
  let currentBuffer: string[] = [];

  const flush = () => {
    if (currentType && currentBuffer.length > 0) {
      const content = currentBuffer.join("\n").trim();
      if (content.length > 0) {
        const title = currentTitle || content.slice(0, 80).replace(/^[#\-*\s]+/, "");
        const salience = defaultSalienceForType(currentType);
        units.push({
          title: title.slice(0, 120),
          content,
          type: currentType,
          salience,
          tags: ["harvested", currentType],
        });
      }
      currentBuffer = [];
      currentTitle = "";
      currentType = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const typeMatch = trimmed.match(
      /^(?:###?\s*|\*\*\s*|[-*]\s*)?(fix|failure|decision|architecture|constraint|operation|preference|discovery|outcome|root cause|learned|rule)\s*[:\-\u2013]\s*(.*)$/i,
    );

    if (typeMatch) {
      flush();
      const rawTag = typeMatch[1].toLowerCase();
      currentType = normalizeHarvestType(rawTag);
      currentTitle = typeMatch[2].trim();
      if (currentTitle) {
        currentBuffer.push(currentTitle);
      }
    } else if (currentType !== null) {
      currentBuffer.push(trimmed);
    }
  }
  flush();

  return units;
}

function normalizeHarvestType(raw: string): MemoryType {
  switch (raw) {
    case "fix":
    case "root cause":
      return "fix";
    case "failure":
      return "failure";
    case "decision":
    case "outcome":
    case "rule":
      return "decision";
    case "architecture":
      return "architecture";
    case "constraint":
      return "constraint";
    case "operation":
      return "operation";
    case "preference":
      return "preference";
    case "learned":
    case "discovery":
    default:
      return "discovery";
  }
}

export function defaultSalienceForType(type: MemoryType): number {
  switch (type) {
    case "constraint":
      return 0.95;
    case "fix":
      return 0.9;
    case "decision":
      return 0.85;
    case "architecture":
      return 0.8;
    case "failure":
      return 0.75;
    case "operation":
      return 0.7;
    case "discovery":
      return 0.6;
    case "preference":
      return 0.5;
    case "session":
      return 0.4;
    default:
      return 0.5;
  }
}

/**
 * Extracts plain text strings from varied JSONL transcript step objects
 * (supporting Claude Code, Antigravity, Cursor, and OpenAI/generic agent formats).
 */
export function parseJsonlTranscript(jsonlText: string): string[] {
  if (!jsonlText) return [];
  const lines = jsonlText.split("\n").map((l) => l.trim()).filter(Boolean);
  const blocks: string[] = [];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      // Direct string fields
      if (typeof obj.content === "string") {
        blocks.push(obj.content);
      } else if (Array.isArray(obj.content)) {
        for (const item of obj.content) {
          if (typeof item === "string") blocks.push(item);
          else if (item && typeof item.text === "string") blocks.push(item.text);
        }
      }
      if (typeof obj.thinking === "string") {
        blocks.push(obj.thinking);
      }
      if (typeof obj.message === "string") {
        blocks.push(obj.message);
      }
      if (typeof obj.text === "string") {
        blocks.push(obj.text);
      }
      if (obj.tool_calls && Array.isArray(obj.tool_calls)) {
        for (const tc of obj.tool_calls) {
          if (tc.arguments && typeof tc.arguments === "string") blocks.push(tc.arguments);
        }
      }
    } catch {
      // Plain text fallback
      blocks.push(line);
    }
  }

  return blocks;
}

export interface TranscriptImportOptions {
  project?: string;
  confirmed?: boolean;
  source?: string;
}

export interface TranscriptImportResult {
  imported: number;
  entries: MemoryEntry[];
  errors: string[];
}

/**
 * Parses and ingests conversation transcripts (.jsonl or text) and auto-distills
 * actionable memories into the store.
 */
export function importTranscript(
  store: Store,
  transcriptPathOrContent: string,
  options: TranscriptImportOptions = {},
): TranscriptImportResult {
  let content = transcriptPathOrContent;
  if (existsSync(transcriptPathOrContent)) {
    content = readFileSync(transcriptPathOrContent, "utf8");
  }

  const blocks = parseJsonlTranscript(content);
  const fullText = blocks.join("\n\n");
  const units = extractHarvestUnits(fullText);
  const project = options.project ?? "default";

  const entries: MemoryEntry[] = [];
  const errors: string[] = [];

  for (const unit of units) {
    try {
      const entry = propose(store, {
        project,
        title: unit.title,
        content: unit.content,
        type: unit.type,
        tags: unit.tags,
        source: options.source ?? "transcript_import",
        confirmed: options.confirmed ?? false,
      });
      entries.push(entry);
    } catch (err: unknown) {
      errors.push(`Failed to import unit "${unit.title}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    imported: entries.length,
    entries,
    errors,
  };
}

/**
 * Export all entries from store into a portable JSON snapshot.
 */
export function exportSnapshot(store: Store): {
  version: string;
  exported_at: string;
  total: number;
  entries: MemoryEntry[];
} {
  const entries = list(store);
  return {
    version: "1.0.0",
    exported_at: new Date().toISOString(),
    total: entries.length,
    entries,
  };
}

/**
 * Import a memory snapshot into the store with validation and secret defenses.
 */
export function importSnapshot(
  store: Store,
  snapshot: { entries: MemoryEntry[] },
  options: { overwrite?: boolean } = {},
): { imported: number; skipped: number; errors: string[] } {
  if (!snapshot || !Array.isArray(snapshot.entries)) {
    return { imported: 0, skipped: 0, errors: ["Invalid snapshot format: missing entries array"] };
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const entry of snapshot.entries) {
    const validRes = validateEntry(entry);
    if (!validRes.valid) {
      errors.push(`Validation failed for ${entry.id ?? "unknown"}: ${validRes.errors.join(", ")}`);
      continue;
    }

    const secrets = scanSecrets(`${entry.title} ${entry.content} ${(entry.tags ?? []).join(" ")}`);
    if (secrets.length > 0) {
      errors.push(`Secret detected in entry ${entry.id}: ${secrets.join(", ")}`);
      continue;
    }

    const existing = get(store, entry.id);
    if (existing && !options.overwrite) {
      skipped++;
      continue;
    }

    try {
      save(store, entry);
      imported++;
    } catch (err: unknown) {
      errors.push(`Failed to save ${entry.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { imported, skipped, errors };
}

