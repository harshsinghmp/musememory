/**
 * T-113: Trivial-prompt gate for the context orchestrator.
 * Detects conversational greetings, pleasantries, acknowledgments, or minimal
 * non-semantic prompts and short-circuits recall to conserve tokens and latency.
 */

import type { MuseContextInput } from "./types.ts";

export const TRIVIAL_PROMPT_GREETINGS = new Set([
  "hi",
  "hi there",
  "hello",
  "hello there",
  "hey",
  "hey there",
  "howdy",
  "greetings",
  "good morning",
  "good afternoon",
  "good evening",
  "good day",
  "yo",
  "sup",
  "what's up",
  "whats up",
  "thanks",
  "thank you",
  "thx",
  "ty",
  "ok",
  "okay",
  "k",
  "cool",
  "sure",
  "bye",
  "goodbye",
  "cya",
  "see ya",
  "cheers",
  "got it",
  "done",
  "acknowledged",
]);

export interface TrivialPromptDecision {
  isTrivial: boolean;
  reason?: string;
}

/**
 * Checks whether raw query text is a trivial greeting or conversational acknowledgment.
 */
export function isTrivialQuery(query?: string): boolean {
  if (!query || typeof query !== "string") return true;
  const trimmed = query.trim();
  if (!trimmed) return true;

  // Normalized: lowercase without trailing punctuation
  const normalized = trimmed
    .toLowerCase()
    .replace(/[!?.,;:]+$/g, "")
    .trim();

  if (TRIVIAL_PROMPT_GREETINGS.has(normalized)) {
    return true;
  }

  // Pure non-alphanumeric or single character
  const alphaChars = normalized.replace(/[^a-z0-9]/g, "");
  if (alphaChars.length < 3 && !/[0-9]/.test(alphaChars)) {
    return true;
  }

  return false;
}

/**
 * Evaluates whether context orchestrator input qualifies as a trivial prompt.
 * If code symbols, files, errors, or non-general intents are specified,
 * the input is NEVER considered trivial.
 */
export function evaluateTrivialPromptGate(input: MuseContextInput): TrivialPromptDecision {
  // If technical context is provided, never gate
  if (input.active_file && input.active_file.trim()) {
    return { isTrivial: false };
  }
  if (input.symbol && input.symbol.trim()) {
    return { isTrivial: false };
  }
  if (input.error_message && input.error_message.trim()) {
    return { isTrivial: false };
  }
  if (input.task_intent && input.task_intent !== "general") {
    return { isTrivial: false };
  }

  // Check query
  if (isTrivialQuery(input.query)) {
    const raw = (input.query ?? "").trim();
    return {
      isTrivial: true,
      reason: `trivial_prompt_gated: conversational greeting or acknowledgement "${raw}" detected without technical anchors; recall bypassed to conserve tokens`,
    };
  }

  return { isTrivial: false };
}
