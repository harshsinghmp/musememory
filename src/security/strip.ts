/**
 * T-110: Injected-block & prompt-context stripping before capture.
 * Prevents recursive context pack poisoning where agent memory-context injections
 * or base64 blobs are ingested back into the store.
 */

const INJECTED_TAG_REGEXES = [
  /<memory-context[\s\S]*?>[\s\S]*?<\/memory-context>/gi,
  /<muse-memory[\s\S]*?>[\s\S]*?<\/muse-memory>/gi,
  /<context-pack[\s\S]*?>[\s\S]*?<\/context-pack>/gi,
  /<system-instructions[\s\S]*?>[\s\S]*?<\/system-instructions>/gi,
  /<!--\s*(?:memory-context|muse-context|context-pack|injected-context)\s*-->[\s\S]*?<!--\s*\/(?:memory-context|muse-context|context-pack|injected-context)\s*-->/gi,
];

const MARKDOWN_CONTEXT_PACK_REGEX =
  /(?:^|\n)# 🧠 Muse Memory Context Pack[\s\S]*?(?=\n\n(?![#>*\-\s])|\n# [^#]|\n---|(?:\n\s*){3,}|$)/gi;

// Base64 data URI payload pattern (>= 50 chars of base64 data)
const BASE64_DATA_URI_REGEX =
  /data:[a-zA-Z0-9/+-]+;base64,[A-Za-z0-9+/=]{50,}/g;

// Standalone large base64 block pattern (e.g. ```base64 ... ``` or 3+ lines of 64+ chars)
const BASE64_CODE_BLOCK_REGEX =
  /```(?:base64|b64)?\s*\n(?:[A-Za-z0-9+/]{40,}=*\n?)+\s*```/g;

export interface StripInjectedResult {
  cleaned: string;
  hasInjectedBlocks: boolean;
}

/**
 * Strips <memory-context>, <muse-memory>, markdown context packs, and base64 payloads
 * from conversation text before capture or harvest.
 */
export function stripInjectedContextBlocks(text: string): string {
  if (!text || typeof text !== "string") return "";

  let cleaned = text;

  // 1. Strip XML/HTML-style context tags
  for (const regex of INJECTED_TAG_REGEXES) {
    regex.lastIndex = 0;
    cleaned = cleaned.replace(regex, "");
  }

  // 2. Strip Markdown Context Pack blocks
  MARKDOWN_CONTEXT_PACK_REGEX.lastIndex = 0;
  cleaned = cleaned.replace(MARKDOWN_CONTEXT_PACK_REGEX, "");

  // 3. Strip base64 data URIs and raw base64 code blocks
  BASE64_DATA_URI_REGEX.lastIndex = 0;
  cleaned = cleaned.replace(BASE64_DATA_URI_REGEX, "[base64-payload-stripped]");
  BASE64_CODE_BLOCK_REGEX.lastIndex = 0;
  cleaned = cleaned.replace(BASE64_CODE_BLOCK_REGEX, "[base64-blob-stripped]");

  // 4. Clean up multiple excessive consecutive blank lines (3+ -> 2)
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  return cleaned;
}

/**
 * Checks whether text contains injected context blocks.
 */
export function containsInjectedContextBlocks(text: string): boolean {
  if (!text || typeof text !== "string") return false;

  for (const regex of INJECTED_TAG_REGEXES) {
    regex.lastIndex = 0;
    if (regex.test(text)) return true;
  }
  MARKDOWN_CONTEXT_PACK_REGEX.lastIndex = 0;
  if (MARKDOWN_CONTEXT_PACK_REGEX.test(text)) return true;

  BASE64_DATA_URI_REGEX.lastIndex = 0;
  if (BASE64_DATA_URI_REGEX.test(text)) return true;

  return false;
}
