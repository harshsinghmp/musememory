/**
 * Instruction-bearing content classifier.
 *
 * OWASP LLM Top 10 2026 — LLM01 (Prompt Injection) names memory persistence as
 * a first-class injection path: a memory that carries instructions, role
 * assignments or policy overrides is not a fact, it is executable text that a
 * later prompt will replay. Agentic ASI06 (Memory & Context Poisoning) is the
 * same failure one hop away. `propose()` therefore treats such writes as
 * privileged and refuses to persist them silently as confirmed knowledge.
 *
 * The classifier is deliberately conservative. A false positive silently
 * demotes a legitimate memory (it can only land as `candidate` until a human or
 * an explicit `confirmed: true` approves it), which is worse than a miss. So:
 *
 *   - strong signals are tight, phrase-level idioms drawn from real injection
 *     payloads; any single one fires.
 *   - weak signals are individually common in ordinary prose, so two or more
 *     distinct ones must co-occur before they count.
 *   - only prose is scanned for weak signals: fenced code blocks are not
 *     addressed to an agent, and treating them as such would demote every
 *     memory that quotes a snippet. Strong signals are scanned everywhere,
 *     because those idioms have no legitimate place in a code sample either.
 *
 * Signals are returned by name so a demotion is explainable rather than magic.
 */

export interface InstructionClassification {
  containsInstructions: boolean;
  signals: string[];
}

interface SignalPattern {
  name: string;
  pattern: RegExp;
}

/** Sentence start in normalised prose: start of text, a newline, or end of a sentence. */
const SENTENCE_START = "(?:^|\\n|[.!?]\\s+)";

/**
 * One of these is enough. Each pattern targets an established injection idiom:
 * instruction negation, role reassignment, policy-mode switches, or an
 * explicitly agent-addressed imperative.
 */
const STRONG_SIGNALS: readonly SignalPattern[] = [
  {
    // "ignore previous instructions", "disregard the above rules", "forget your system prompt"
    name: "ignore_previous_instructions",
    pattern:
      /\b(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+|any\s+)?(?:of\s+)?(?:the\s+|your\s+|my\s+)?(?:previous|prior|above|earlier|preceding|existing|system)\s+(?:instructions?|prompts?|rules?|directions?|directives?|guidance|guidelines?|constraints?|polic(?:y|ies)|context)\b/i,
  },
  {
    // "you are now DAN", "you are no longer bound by ..."
    name: "you_are_now",
    pattern: /\byou\s+are\s+now\b|\byou(?:'re|\s+are)\s+no\s+longer\b/i,
  },
  {
    // "act as a root shell" (imperative, i.e. addressed to the reader) and
    // role-reassignment flavours that are unambiguous wherever they appear.
    name: "act_as",
    pattern:
      /(?:^|\n|[.!?]\s+)(?:please\s+)?(?:act|behave|respond|reply)\s+as\b|\b(?:act|behave|respond)\s+as\s+(?:if\s+you\s+(?:are|were)|an?\s+(?:unrestricted|unfiltered|unbound|different|new|root|admin|system|developer)\b|my\s+\w+)/i,
  },
  {
    name: "system_prompt",
    pattern: /\bsystem\s+(?:prompt|message|instructions?)\b|\bdeveloper\s+prompt\b|\bhidden\s+(?:prompt|instructions?)\b/i,
  },
  {
    // "developer mode", "jailbreak mode", "god mode", "DAN mode"
    name: "developer_mode",
    pattern: /\b(?:developer|dev|god|jailbreak|dan)\s+mode\b/i,
  },
  {
    // "from now on", "henceforth"
    name: "from_now_on",
    pattern: /\bfrom\s+now\s+on\b|\bhenceforth\b/i,
  },
  {
    // Agent-directed imperative: "you must always ...", "you shall never ..."
    name: "agent_directed_imperative",
    pattern: /\byou\s+must\b|\byou\s+(?:shall|will)\s+(?:always|never|only)\b/i,
  },
  {
    // "Always use pnpm." at a sentence start is an instruction to whoever reads it.
    name: "always_use",
    pattern: new RegExp(
      `${SENTENCE_START}(?:please\\s+)?always\\s+(?:use|prefer|run|call|set|add|include|write|update|check|keep|avoid|read|commit|push|deploy|treat|apply|import|return|validate)\\b`,
      "i",
    ),
  },
  {
    // "Never commit secrets." — same shape, negative polarity.
    name: "never_do",
    pattern: new RegExp(
      `${SENTENCE_START}(?:please\\s+)?never\\s+(?:use|do|run|call|touch|modify|delete|remove|commit|push|read|write|edit|change|add|import|install|set|deploy|merge|trust|skip|disable)\\b`,
      "i",
    ),
  },
];

/**
 * Two or more distinct weak signals are required. Each is common on its own in
 * technical prose, so co-occurrence — not the individual match — is the signal.
 */
const WEAK_SIGNALS: readonly SignalPattern[] = [
  {
    // "Use X", "Do not Y", "Always Z" as the opening of a sentence.
    name: "sentence_start_imperative",
    pattern: new RegExp(
      `${SENTENCE_START}(?:use|prefer|avoid|ensure|remember|check|update|add|remove|run|call|set|keep|always|never|do\\s+not|don't)\\b`,
      "i",
    ),
  },
  {
    // Tool names an agent can invoke, i.e. text that speaks in tool calls.
    name: "tool_mention",
    pattern:
      /\b(?:memory_(?:capture|search|read|context|current|health|adr_record|forget|restore|sync|validate|brief|harvest)|bash|grep|glob|read_file|write_file|edit_file|web_search|web_fetch|delegate_task|todo_write)\b/i,
  },
  {
    name: "url",
    pattern: /\bhttps?:\/\/[^\s<>()[\]"']+/i,
  },
  {
    name: "remember_to",
    pattern: /\bremember\s+to\b/i,
  },
];

const REQUIRED_WEAK_SIGNALS = 2;

/**
 * Strip fenced code blocks and markdown line decoration so that the imperative
 * anchors match the sentence a reader sees, not list syntax.
 */
function toProse(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^[\s>#*+\-•\d.)\]]+/, ""))
    .join("\n");
}

function matchAll(patterns: readonly SignalPattern[], haystack: string, into: string[]): void {
  for (const { name, pattern } of patterns) {
    if (into.includes(name)) continue;
    if (pattern.test(haystack)) into.push(name);
  }
}

/**
 * Classifies free text as instruction-bearing or not.
 *
 * Returns the names of the signals that produced a positive verdict; a negative
 * verdict carries an empty list, so `signals` always explains `containsInstructions`.
 */
export function classifyInstructionContent(text: string): InstructionClassification {
  if (!text || typeof text !== "string") {
    return { containsInstructions: false, signals: [] };
  }

  const prose = toProse(text);

  const strong: string[] = [];
  // Idioms are unambiguous wherever they appear, including inside a snippet.
  matchAll(STRONG_SIGNALS, text, strong);

  const weak: string[] = [];
  matchAll(WEAK_SIGNALS, prose, weak);

  const containsInstructions = strong.length > 0 || weak.length >= REQUIRED_WEAK_SIGNALS;
  if (!containsInstructions) {
    return { containsInstructions: false, signals: [] };
  }
  return { containsInstructions: true, signals: [...strong, ...weak] };
}
