/**
 * Retention Gate & Informational Density Scorer (T-104)
 *
 * Enforces a strict admission gate (scoreRetain >= 0.30) on all proposed memories.
 * Rejects conversational fillers, trivial acknowledgements, repetitive noise,
 * and low-density junk before persistence to prevent memory store bloat.
 */

export interface RetentionScoreOptions {
  title?: string;
  tags?: string[];
  salience?: number;
  type?: string;
  confirmed?: boolean;
}

export interface RetentionScoreResult {
  score: number;
  passed: boolean;
  reason: string;
  breakdown: {
    baseScore: number;
    lengthScore: number;
    diversityScore: number;
    structureScore: number;
    keywordBonus: number;
    titleBonus: number;
    salienceAdjustment: number;
  };
}

const TRIVIAL_FILLERS = new Set([
  "ok",
  "okay",
  "thanks",
  "thank you",
  "thx",
  "ty",
  "noted",
  "got it",
  "done",
  "sounds good",
  "cool",
  "great",
  "hello",
  "hi",
  "hey",
  "test",
  "testing",
  "asdf",
  "bye",
  "goodbye",
  "yes",
  "no",
  "sure",
  "all good",
  "understood",
  "acknowledged",
  "will do",
  "k",
  "kk",
]);

const TECHNICAL_KEYWORDS = [
  "error",
  "bug",
  "fix",
  "patch",
  "config",
  "schema",
  "database",
  "sqlite",
  "query",
  "token",
  "endpoint",
  "invariant",
  "architecture",
  "failure",
  "reproduce",
  "migration",
  "pattern",
  "rule",
  "security",
  "test",
  "timeout",
  "version",
  "api",
  "handler",
  "cache",
  "index",
  "lock",
  "outbox",
  "model",
  "service",
  "workflow",
  "contract",
  "secret",
  "credential",
  "decision",
  "redis",
  "table",
];

/**
 * Calculates informational retention score for candidate memory content.
 * Returns a score between 0.0 and 1.0. Entries scoring < 0.30 fail the admission gate.
 */
export function calculateRetentionScore(
  content: string,
  options: RetentionScoreOptions = {},
): RetentionScoreResult {
  const trimmed = (content ?? "").trim();
  const lower = trimmed.toLowerCase();
  const title = (options.title ?? "").trim();
  const lowerTitle = title.toLowerCase();

  // 1. Trivial filler immediate rejection
  const strippedPunctuation = lower.replace(/^[!.,?\s]+|[!.,?\s]+$/g, "");
  if (TRIVIAL_FILLERS.has(strippedPunctuation)) {
    return {
      score: 0.05,
      passed: false,
      reason: `Conversational filler '${strippedPunctuation}' lacks durable informational value`,
      breakdown: {
        baseScore: 0,
        lengthScore: 0.05,
        diversityScore: 0,
        structureScore: 0,
        keywordBonus: 0,
        titleBonus: 0,
        salienceAdjustment: 0,
      },
    };
  }

  // Conversational phrases check (e.g., "thanks for the update", "sounds good to me")
  if (
    /^(?:thanks|thank you|sounds good|all good|looks good|got it|noted|good job|well done)\b(?:\s+(?:very much|a lot|for the update|for your help|for that|for|to me|buddy|team|mate|everyone|me|all)[^.]*)?$/i.test(
      strippedPunctuation,
    )
  ) {
    return {
      score: 0.08,
      passed: false,
      reason: `Conversational greeting/filler '${trimmed}' lacks durable informational value`,
      breakdown: {
        baseScore: 0,
        lengthScore: 0.08,
        diversityScore: 0,
        structureScore: 0,
        keywordBonus: 0,
        titleBonus: 0,
        salienceAdjustment: 0,
      },
    };
  }

  // 2. Ultra-short content without any title or confirmation context
  if (trimmed.length < 3 && !title && !options.confirmed) {
    return {
      score: 0.1,
      passed: false,
      reason: `Content length (${trimmed.length} chars) with no title is below minimum admission threshold`,
      breakdown: {
        baseScore: 0.1,
        lengthScore: 0,
        diversityScore: 0,
        structureScore: 0,
        keywordBonus: 0,
        titleBonus: 0,
        salienceAdjustment: 0,
      },
    };
  }

  // 3. Lexical diversity check (unique tokens / total tokens)
  const fullText = (title && title !== trimmed ? `${title} ${trimmed}` : trimmed).toLowerCase();
  const tokens = fullText.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const uniqueTokens = new Set(tokens);
  const diversityRatio = tokens.length > 0 ? uniqueTokens.size / tokens.length : 1;

  // If text is repetitive noise (e.g. repeated single word "foo foo foo foo")
  if (
    tokens.length >= 6 &&
    (uniqueTokens.size <= 1 ||
      (tokens.length >= 8 && uniqueTokens.size <= 2) ||
      (tokens.length >= 10 && diversityRatio < 0.2))
  ) {
    return {
      score: 0.15,
      passed: false,
      reason: `Low lexical diversity ratio (${diversityRatio.toFixed(2)}, unique words: ${uniqueTokens.size}) indicates repetitive junk content`,
      breakdown: {
        baseScore: 0.1,
        lengthScore: 0.05,
        diversityScore: 0,
        structureScore: 0,
        keywordBonus: 0,
        titleBonus: 0,
        salienceAdjustment: 0,
      },
    };
  }

  // 4. Base informational score
  const baseScore = 0.3;

  // 5. Length score (scaled from 0.0 to 0.25 based on combined title + content length)
  const totalLength = title && title !== trimmed ? trimmed.length + title.length : trimmed.length;
  const lengthScore = Math.min(0.25, Number(((Math.min(totalLength, 250) / 250) * 0.25).toFixed(2)));

  // 6. Diversity score
  const diversityScore = Number((Math.min(0.1, diversityRatio * 0.1)).toFixed(2));

  // 7. Structural score (markdown headings, code blocks, lists)
  let structureScore = 0;
  if (/```[\s\S]*?```/.test(trimmed)) structureScore += 0.15;
  if (/`[^`]+`/.test(trimmed)) structureScore += 0.05;
  if (/^\s*[-*#\d.]\s+/m.test(trimmed)) structureScore += 0.1;
  structureScore = Math.min(0.25, structureScore);

  // 8. Technical keyword bonus
  let keywordMatches = 0;
  for (const kw of TECHNICAL_KEYWORDS) {
    if (fullText.includes(kw)) keywordMatches++;
  }
  const keywordBonus = Math.min(0.2, keywordMatches * 0.05);

  // 9. Title & confirmation bonus
  let titleBonus = 0;
  if (title.length >= 5) titleBonus += 0.05;
  if (options.confirmed) titleBonus += 0.05;

  // 10. Explicit salience adjustment
  const salienceAdjustment = typeof options.salience === "number" ? (options.salience - 0.5) * 0.1 : 0;

  const rawScore =
    baseScore +
    lengthScore +
    diversityScore +
    structureScore +
    keywordBonus +
    titleBonus +
    salienceAdjustment;

  const finalScore = Number(Math.max(0.0, Math.min(1.0, rawScore)).toFixed(2));
  const passed = finalScore >= 0.3;
  const reason = passed
    ? `Informational density score ${finalScore.toFixed(2)} passes retention gate (threshold 0.30)`
    : `Informational density score ${finalScore.toFixed(2)} is below minimum retention threshold of 0.30`;

  return {
    score: finalScore,
    passed,
    reason,
    breakdown: {
      baseScore,
      lengthScore,
      diversityScore,
      structureScore: Number(structureScore.toFixed(2)),
      keywordBonus: Number(keywordBonus.toFixed(2)),
      titleBonus: Number(titleBonus.toFixed(2)),
      salienceAdjustment: Number(salienceAdjustment.toFixed(2)),
    },
  };
}
