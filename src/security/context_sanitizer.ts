import { redactSecrets } from "../secrets.ts";

const DEFAULT_MAX_BYTES = 8192;

/**
 * Sanitize memory text before it reaches an agent. Retrieval output is data,
 * never instructions; this strips delimiter/tag breakouts, neutralizes the
 * most common override phrasing and redacts credentials at read time.
 */
export function sanitizeContextForAgent(input: string, maxBytes: number = DEFAULT_MAX_BYTES): string {
  let text = String(input ?? "").replace(/\u0000/g, "");
  text = text
    .replace(/<\/?muse-memory[^>]*>/gi, "")
    .replace(/<\/?(?:instructions?|system-message|system)(?:\s+[^>]*)?>/gi, "");
  text = text
    .replace(/\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?/gi, "[neutralized instruction]")
    .replace(/\byou are now\b[^.\n]{0,60}/gi, "[neutralized role override]")
    .replace(/\bexfiltrate\b[^.\n]{0,60}/gi, "[neutralized exfiltration request]");
  text = redactSecrets(text);
  return text.length > maxBytes ? `${text.slice(0, maxBytes)}\n…[truncated]` : text;
}

/** Wrap sanitized memory data in a delimiter that labels it as non-instruction. */
export function wrapAgentContext(input: string, maxBytes: number = DEFAULT_MAX_BYTES): string {
  return `<muse-memory data-not-instructions="true">\n${sanitizeContextForAgent(input, maxBytes)}\n</muse-memory>`;
}
