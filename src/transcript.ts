import { existsSync, readFileSync } from "node:fs";

export interface TranscriptMatch {
  index: number;
  matchedTurn: string;
  before: string[];
  after: string[];
}

export interface TranscriptSearchResult {
  totalTurns: number;
  bookendStart: string;
  bookendEnd: string;
  matches: TranscriptMatch[];
  formattedSummary: string;
}

export interface TranscriptSearchOptions {
  windowSize?: number;
  maxMatches?: number;
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
      const prevLen = blocks.length;
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
      if (typeof obj.path === "string") {
        blocks.push(obj.path);
      }
      if (obj.tool_calls && Array.isArray(obj.tool_calls)) {
        for (const tc of obj.tool_calls) {
          if (tc.arguments && typeof tc.arguments === "string") blocks.push(tc.arguments);
        }
      }
      if (blocks.length === prevLen) {
        const textParts = Object.values(obj)
          .filter((v): v is string => typeof v === "string")
          .join(" ");
        blocks.push(textParts.length > 0 ? textParts : line);
      }
    } catch {
      // Plain text fallback
      blocks.push(line);
    }
  }

  return blocks;
}

/**
 * Full-text search over conversation transcripts (.jsonl or text) with conversation
 * bookends (start/end) and surrounding dialogue context window.
 */
export function searchTranscriptWithBookends(
  transcriptPathOrContent: string,
  query: string,
  options: TranscriptSearchOptions = {},
): TranscriptSearchResult {
  let content = transcriptPathOrContent;
  if (existsSync(transcriptPathOrContent)) {
    content = readFileSync(transcriptPathOrContent, "utf8");
  }

  const turns = parseJsonlTranscript(content);
  if (turns.length === 0) {
    return {
      totalTurns: 0,
      bookendStart: "",
      bookendEnd: "",
      matches: [],
      formattedSummary: "No turns found in transcript.",
    };
  }

  const windowSize = options.windowSize ?? 2;
  const maxMatches = options.maxMatches ?? 5;
  const bookendStart = turns[0] ?? "";
  const bookendEnd = turns[turns.length - 1] ?? "";

  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches: TranscriptMatch[] = [];

  for (let i = 0; i < turns.length; i++) {
    if (matches.length >= maxMatches) break;
    const turnLower = turns[i].toLowerCase();
    const isMatch = queryTerms.length > 0 && queryTerms.every((term) => turnLower.includes(term));
    if (isMatch) {
      const before = turns.slice(Math.max(0, i - windowSize), i);
      const after = turns.slice(i + 1, Math.min(turns.length, i + 1 + windowSize));
      matches.push({
        index: i,
        matchedTurn: turns[i],
        before,
        after,
      });
    }
  }

  const lines: string[] = [];
  lines.push(`### Conversation Overview (${turns.length} total turns)`);
  lines.push(`**[Start Bookend]**: ${bookendStart.slice(0, 200).replace(/\n+/g, " ")}`);
  lines.push(`**[End Bookend]**: ${bookendEnd.slice(0, 200).replace(/\n+/g, " ")}`);
  lines.push("");

  if (matches.length === 0) {
    lines.push(`*No matches found for query "${query}".*`);
  } else {
    lines.push(`### Matches for "${query}" (${matches.length} found):`);
    matches.forEach((m, idx) => {
      lines.push(`\n#### Match ${idx + 1} (Turn ${m.index + 1})`);
      if (m.before.length > 0) {
        lines.push(`*Context Before:*`);
        m.before.forEach((b) => lines.push(`> ${b.slice(0, 150).replace(/\n+/g, " ")}`));
      }
      lines.push(`**Matched Turn:**\n${m.matchedTurn}`);
      if (m.after.length > 0) {
        lines.push(`*Context After:*`);
        m.after.forEach((a) => lines.push(`> ${a.slice(0, 150).replace(/\n+/g, " ")}`));
      }
    });
  }

  return {
    totalTurns: turns.length,
    bookendStart,
    bookendEnd,
    matches,
    formattedSummary: lines.join("\n").trim(),
  };
}
