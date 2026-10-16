export interface DualMeasureResult {
  standardTokens: number;
  pessimisticTokens: number;
  conservativeTokens: number;
  inflationRatio: number;
}

/**
 * Honest dual-measure token accounting:
 * Compares naive chars/4 standard estimation with a pessimistic model accounting
 * for syntax delimiters, punctuation, camelCase/subword splits, and non-ASCII unicode.
 */
export function dualMeasureTokens(text: string): DualMeasureResult {
  if (!text || text.length === 0) {
    return {
      standardTokens: 0,
      pessimisticTokens: 0,
      conservativeTokens: 0,
      inflationRatio: 1.0,
    };
  }

  // 1. Standard measure: rule of thumb (chars / 4)
  const standardTokens = Math.max(1, Math.ceil(text.length / 4));

  // 2. Pessimistic measure:
  // Base token count from whitespace-delimited words
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  let pessimistic = words.length;

  for (const word of words) {
    // Subword inflation for long tokens
    if (word.length > 7) {
      pessimistic += Math.floor(word.length / 5);
    }
  }

  // Code syntax delimiters, brackets, and operators
  const syntaxMatches = text.match(/[{}\[\]();,:=+\-*\/<>&|!~?#^%$\\`"']/g);
  if (syntaxMatches) {
    pessimistic += syntaxMatches.length * 0.75;
  }

  // Newline and whitespace structure
  const newlines = text.match(/\n/g);
  if (newlines) {
    pessimistic += newlines.length * 0.5;
  }

  // Non-ASCII unicode characters
  let nonAsciiCount = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) nonAsciiCount++;
  }
  pessimistic += nonAsciiCount * 1.5;

  const pessimisticTokens = Math.max(standardTokens, Math.ceil(pessimistic));
  const conservativeTokens = Math.max(standardTokens, pessimisticTokens);
  const inflationRatio = Number((conservativeTokens / standardTokens).toFixed(2));

  return {
    standardTokens,
    pessimisticTokens,
    conservativeTokens,
    inflationRatio,
  };
}

/**
 * Validates the structural and informational completeness of a session digest.
 * Refuses corrupted, cut-off, or truncated digests.
 */
export function validateDigestIntegrity(content: string): { valid: boolean; reason?: string } {
  if (!content || !content.trim()) {
    return { valid: false, reason: "digest content is empty" };
  }

  // Check for explicit truncation or incomplete markers
  if (content.includes("[INCOMPLETE_DIGEST") || content.includes("... [truncated")) {
    return { valid: false, reason: "contains incomplete digest marker" };
  }

  // Check code fence balance
  const fenceMatches = content.match(/^```/gm);
  if (fenceMatches && fenceMatches.length % 2 !== 0) {
    return { valid: false, reason: "unbalanced code block fences indicate truncated digest" };
  }

  // If CURRENT.md format, check mandatory sections
  if (content.includes("# 📍 Active Workspace Context & Invariants (CURRENT.md)")) {
    if (!content.includes("2. High-Level Goal") && !content.includes("High-Level Goal")) {
      return { valid: false, reason: "missing mandatory section: 2. High-Level Goal" };
    }
    if (!content.includes("6. Next Concrete Task") && !content.includes("Next Concrete Task")) {
      return { valid: false, reason: "missing mandatory section: 6. Next Concrete Task" };
    }
  }

  return { valid: true };
}
