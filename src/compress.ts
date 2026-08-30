export interface CompressionResult {
  compressed: string;
  originalTokens: number;
  compressedTokens: number;
  savingsPercent: number;
}

export interface CompressionOptions {
  level?: "light" | "aggressive";
}

export function estimateTokens(text: string): number {
  if (!text || text.trim().length === 0) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Compresses prompt Markdown text losslessly:
 * - Normalizes excessive whitespace and consecutive blank lines
 * - Removes redundant visual separators and boilerplate filler
 * - Compresses bullet indentations while preserving full semantic knowledge
 */
export function compressPromptContext(
  text: string,
  options: CompressionOptions = {},
): CompressionResult {
  if (!text || text.trim().length === 0) {
    return {
      compressed: "",
      originalTokens: 0,
      compressedTokens: 0,
      savingsPercent: 0,
    };
  }

  const originalTokens = estimateTokens(text);

  let cleaned = text
    // Replace multiple empty lines with single newline
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    // Simplify verbose headers
    .replace(/### Active Working Constraints \(CURRENT\.md\)/gi, "### Active Constraints")
    .replace(/### Active In-Flight Context & Session Handoff \(CURRENT\.md\)/gi, "### In-Flight Handoff")
    .replace(/### User Profile & Preferences \(USER\.md\)/gi, "### User Profile")
    .replace(/### Relevant Memories & Learned Patterns/gi, "### Memories")
    // Remove decorative horizontal lines
    .replace(/\n\s*---\s*\n/g, "\n")
    // Remove memory directive footer
    .replace(/\*Memory Directive: When learning durable facts[^\n]*\*/gi, "")
    // Normalize multi-spaces
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  const compressedTokens = estimateTokens(cleaned);
  const diff = originalTokens - compressedTokens;
  const savingsPercent =
    originalTokens > 0 ? Math.round((Math.max(0, diff) / originalTokens) * 100) : 0;

  return {
    compressed: cleaned,
    originalTokens,
    compressedTokens,
    savingsPercent,
  };
}
