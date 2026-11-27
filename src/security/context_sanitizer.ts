import { redactSecrets } from "../secrets.ts";

const DEFAULT_MAX_BYTES = 8192;

/**
 * Ceiling for whole documents (an MCP prompt, a markdown resource) rather than
 * a retrieved excerpt. `DEFAULT_MAX_BYTES` is tuned for snippets, and silently
 * truncating a document the client asked to read is a data-integrity bug, not
 * a safety win — so those call sites pass this larger bound.
 */
export const DOCUMENT_MAX_BYTES = 256 * 1024;

/**
 * The wrapper's own delimiter tokens.
 *
 * Content carrying one of these can close the fence early and continue as if it
 * were the operator talking, or reopen it with a friendlier label. Stripping
 * every occurrence before the content is embedded is what makes the wrapper a
 * boundary: the only `<muse-memory>` in the output is the one we wrote.
 */
const FENCE_TOKEN = /<\/?muse-memory[^>]*>/gi;

/** Remove every `<muse-memory …>` / `</muse-memory>` token from `input`. */
export function stripFenceTokens(input: string): string {
  return String(input ?? "").replace(/\u0000/g, "").replace(FENCE_TOKEN, "");
}

/**
 * Sanitize memory text before it reaches an agent. Retrieval output is data,
 * never instructions; this strips delimiter/tag breakouts, neutralizes the
 * most common override phrasing and redacts credentials at read time.
 */
export function sanitizeContextForAgent(input: string, maxBytes: number = DEFAULT_MAX_BYTES): string {
  let text = stripFenceTokens(input);
  text = text
    .replace(/<\/?(?:instructions?|system-message|system)(?:\s+[^>]*)?>/gi, "");
  text = text
    .replace(/\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?/gi, "[neutralized instruction]")
    .replace(/\byou are now\b[^.\n]{0,60}/gi, "[neutralized role override]")
    .replace(/\bexfiltrate\b[^.\n]{0,60}/gi, "[neutralized exfiltration request]");
  text = redactSecrets(text);
  return text.length > maxBytes ? `${text.slice(0, maxBytes)}\n…[truncated]` : text;
}

/**
 * Wrap sanitized memory data in a delimiter that labels it as non-instruction.
 *
 * The fence tokens are stripped first (again, explicitly — `sanitizeContextForAgent`
 * already does it) so the guarantee does not depend on the sanitizer's rule set
 * staying as wide as it is today: whatever `input` holds, the returned string
 * carries exactly one opening and one closing token.
 */
export function wrapAgentContext(input: string, maxBytes: number = DEFAULT_MAX_BYTES): string {
  const body = sanitizeContextForAgent(stripFenceTokens(input), maxBytes);
  return `<muse-memory data-not-instructions="true">\n${body}\n</muse-memory>`;
}
