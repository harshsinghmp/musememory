import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { Store } from "./store.ts";
import { propose, save, list } from "./store.ts";
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

    // 1. Explicit marker match (e.g. "### Fix: ...", "Decision: ...", "Hard rule: ...")
    const typeMatch = speakerStripped.match(
      /^(?:#{1,6}\s+|[-*]\s+)?\*{0,2}(fix|failure|decision|architecture|constraint|operation|preference|discovery|outcome|root cause|learned|rule|solution|resolution|workaround|hard rule|policy)\*{0,2}\s*[:\-\u2013]\s*(.*)$/i,
    );

    // 2. Natural language cognitive insight patterns
    let naturalType: MemoryType | null = null;
    let naturalContent = "";

    if (!typeMatch) {
      if (/\b(?:resolved|fixed|patched|worked around)\s+(?:the\s+)?([^.\n]+)/i.test(speakerStripped)) {
        naturalType = "fix";
        naturalContent = speakerStripped;
      } else if (/\b(?:decided|chose|selected|agreed)\s+to\s+([^.\n]+)/i.test(speakerStripped)) {
        naturalType = "decision";
        naturalContent = speakerStripped;
      } else if (/\b(?:must\s+always|must\s+never|never\s+commit|you\s+must\s+never|do\s+not\s+allow)\s+([^.\n]+)/i.test(speakerStripped)) {
        naturalType = "constraint";
        naturalContent = speakerStripped;
      } else if (/\b(?:user\s+prefers|prefers\s+using|prefers\s+to)\s+([^.\n]+)/i.test(speakerStripped)) {
        naturalType = "preference";
        naturalContent = speakerStripped;
      }
    }

    if (typeMatch) {
      flush();
      const rawTag = typeMatch[1].toLowerCase();
      currentType = normalizeHarvestType(rawTag);
      currentTitle = typeMatch[2].replace(/^\*{1,2}|\*{1,2}$/g, "").trim();
      if (currentTitle) {
        currentBuffer.push(currentTitle);
      }
    } else if (naturalType && naturalContent) {
      flush();
      currentType = naturalType;
      currentTitle = naturalContent.slice(0, 80);
      currentBuffer.push(naturalContent);
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
    case "solution":
    case "resolution":
    case "workaround":
      return "fix";
    case "failure":
      return "failure";
    case "decision":
    case "outcome":
    case "rule":
    case "policy":
      return "decision";
    case "architecture":
      return "architecture";
    case "constraint":
    case "hard rule":
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

export interface TranscriptImportOptions {
  project?: string;
  confirmed?: boolean;
  source?: string;
  sessionId?: string;
  /** Extract commitment patterns into open-loop candidates (default true). */
  openLoops?: boolean;
}

export interface TranscriptImportResult {
  imported: number;
  entries: MemoryEntry[];
  errors: string[];
  /** Open-loop candidate entries proposed from detected commitments (SOW-103). */
  openLoops: MemoryEntry[];
}

/** Deterministic commitment patterns; matched against speaker-stripped lines. */
const COMMITMENT_PATTERNS: RegExp[] = [
  /\btodo\b\s*[:\-]\s*(.{4,})/i,
  /\b(?:i'll|i will|i am going to)\s+(.{4,})/i,
  /\bneed to\s+(.{4,})/i,
  /\bfollow up (?:on|with)\s+(.{4,})/i,
  /\bremind me to\s+(.{4,})/i,
];

/**
 * Open-Loop Extraction (SOW-103): detects commitment phrasing ("I'll fix X",
 * "TODO: Y", "need to Z") in transcript text. Deterministic — no LLM calls.
 */
export function extractCommitments(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawLine of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim().replace(
      /^(?:user|assistant|human|system|agent|client|developer)\s*[:\-\u2013]\s*/i,
      "",
    );
    for (const pattern of COMMITMENT_PATTERNS) {
      const m = line.match(pattern);
      if (m) {
        const content = m[0].trim();
        const key = content.toLowerCase().replace(/\s+/g, " ");
        if (!seen.has(key)) {
          seen.add(key);
          out.push(content);
        }
        break; // one commitment per line
      }
    }
  }
  return out;
}

/** Stable id for an open-loop commitment: same text always yields the same id. */
export function openLoopId(text: string): string {
  const h = createHash("sha256").update(text.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex");
  return `m_0_ol${h.slice(0, 12)}`;
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

  // SOW-103: commitment extraction -> open-loop candidates, idempotent via content-hash ids.
  const openLoops: MemoryEntry[] = [];
  if (options.openLoops !== false) {
    const existing = new Set(list(store).map((e) => e.id));
    for (const commitment of extractCommitments(fullText)) {
      const id = openLoopId(commitment);
      if (existing.has(id)) continue; // already ingested from a previous run
      try {
        const entry = propose(store, {
          id,
          project,
          title: commitment.slice(0, 80),
          content: commitment,
          type: "operation",
          tags: ["open-loop", "harvested"],
          source: options.source ?? "transcript_import",
        });
        if (options.sessionId) {
          entry.session_id = options.sessionId;
          save(store, entry);
        }
        existing.add(id);
        openLoops.push(entry);
      } catch (err: unknown) {
        errors.push(`Failed to record open loop "${commitment}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return {
    imported: entries.length,
    entries,
    errors,
    openLoops,
  };
}

