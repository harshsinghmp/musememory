import { existsSync, readFileSync } from "node:fs";
import type { Store } from "./store.ts";
import { propose, save } from "./store.ts";
import type { MemoryEntry, MemoryType } from "./types.ts";

export {
  exportSnapshot,
  importSnapshot,
} from "./snapshot.ts";

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
  const lines = text.replace(/\r\n/g, "\n").split("\n");
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

    const speakerStripped = trimmed.replace(
      /^(?:user|assistant|human|system|agent|client|developer)\s*[:\-\u2013]\s*/i,
      "",
    );

    const typeMatch = speakerStripped.match(
      /^(?:#{1,6}\s+|[-*]\s+)?\*{0,2}(fix|failure|decision|architecture|constraint|operation|preference|discovery|outcome|root cause|learned|rule)\*{0,2}\s*[:\-\u2013]\s*(.*)$/i,
    );

    if (typeMatch) {
      flush();
      const rawTag = typeMatch[1].toLowerCase();
      currentType = normalizeHarvestType(rawTag);
      currentTitle = typeMatch[2].replace(/^\*{1,2}|\*{1,2}$/g, "").trim();
      if (currentTitle) {
        currentBuffer.push(currentTitle);
      }
    } else if (trimmed.match(/^(?:user|assistant|human|system|agent|client|developer)\s*[:\-\u2013]/i)) {
      flush();
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

import { parseJsonlTranscript } from "./transcript.ts";
export {
  parseJsonlTranscript,
  searchTranscriptWithBookends,
  type TranscriptMatch,
  type TranscriptSearchResult,
  type TranscriptSearchOptions,
} from "./transcript.ts";

export interface TranscriptImportOptions {
  project?: string;
  confirmed?: boolean;
  source?: string;
  sessionId?: string;
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
      if (options.sessionId) {
        entry.session_id = options.sessionId;
        save(store, entry);
      }
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

