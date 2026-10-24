/**
 * T-320: Scope canonicalization and general qualifier extraction.
 *
 * The contradiction engine needs to know *which context* a claim is made in.
 * "Pooling is enabled in production" and "pooling is disabled on localhost"
 * are not in conflict — they describe two different environments. Detecting
 * that requires reading the qualifier phrase that follows (or precedes) a
 * claim, not just the claim's polarity word.
 *
 * This module owns two things:
 *   1. Canonical scope vocabulary (production, development, testing, ...).
 *   2. A general qualifier extractor that pulls a short scope phrase out of
 *      free text, e.g. "in production", "at tier 2", "for legacy stores",
 *      "on localhost", "during restore".
 */

// Canonical scope aliases. Keys are normalized (lowercase, spaces).
const SCOPE_ALIASES: Record<string, string> = {
  prod: "production",
  production: "production",
  dev: "development",
  development: "development",
  test: "testing",
  testing: "testing",
  qa: "testing",
  staging: "staging",
  stage: "staging",
  analytics: "analytics",
  warehouse: "analytics",
  olap: "analytics",
  macos: "desktop",
  desktop: "desktop",
  mobile: "mobile",
  ios: "mobile",
  android: "mobile",
  frontend: "frontend",
  backend: "backend",
  localhost: "local",
  local: "local",
  ci: "ci",
  cd: "ci",
  container: "container",
  docker: "container",
  browser: "browser",
  server: "server",
  client: "client",
};

/**
 * Normalizes a raw scope string into its canonical form.
 *
 * A compound phrase whose every token maps to the same canonical scope
 * ("macOS desktop" -> "desktop", "mobile iOS" -> "mobile") collapses to that
 * scope. Everything else is returned normalized (lowercase, collapsed
 * whitespace) so that arbitrary qualifiers such as "legacy stores" or
 * "tier 2" still compare reliably.
 */
export function canonicalizeScope(scope?: string): string {
  if (!scope) return "";
  const norm = scope.toLowerCase().trim().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
  if (SCOPE_ALIASES[norm]) return SCOPE_ALIASES[norm];

  const tokens = norm.split(" ").filter(Boolean);
  if (tokens.length > 1) {
    const mapped = tokens.map((token) => SCOPE_ALIASES[token]);
    if (mapped.every((value) => value && value === mapped[0])) return mapped[0];
  }

  return norm;
}

/**
 * Prepositions that introduce a scope qualifier.
 * "before" and "after" are included: "enabled before compaction" and
 * "disabled during restore" are distinct contexts, not a contradiction.
 */
const SCOPE_PREPOSITIONS = [
  "instead of",
  "within",
  "throughout",
  "during",
  "while",
  "when",
  "before",
  "after",
  "under",
  "across",
  "between",
  "in",
  "on",
  "at",
  "for",
  "per",
];

/**
 * Tokens that end a scope phrase. A scope phrase stops at the first of these
 * so that "in a model is present" does not swallow the whole clause.
 */
const SCOPE_BOUNDARY_TOKENS = new Set([
  "and",
  "but",
  "or",
  "so",
  "because",
  "since",
  "unless",
  "which",
  "that",
  "who",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "to",
  "as",
  "if",
  "then",
  "otherwise",
  "however",
  "meanwhile",
  "also",
  "both",
  "either",
  "neither",
]);

/** Maximum number of tokens a scope phrase may contain. */
const SCOPE_MAX_TOKENS = 3;

/**
 * Extracts a scope qualifier that FOLLOWS the given index.
 *
 * Looks for a preposition-led phrase ("in production", "at tier 2") or the
 * modal qualifier "by default". Returns undefined when the text carries no
 * qualifier after that point.
 */
export function extractTrailingScope(text: string, fromIndex: number): string | undefined {
  const rest = text.slice(fromIndex);

  // Modal qualifier: "by default".
  const defaultMatch = rest.match(/^[\s,;:()\-]*(?:by\s+default)\b/i);
  if (defaultMatch) return canonicalizeScope("default");

  // Preposition-led qualifier, optionally preceded by "only".
  const prepMatch = rest.match(
    /^[\s,;:()\-]*(?:only\s+)?(instead\s+of|within|throughout|during|while|when|before|after|under|across|between|in|on|at|for|per)\b/i,
  );
  if (!prepMatch) return undefined;

  const afterPrep = rest.slice(prepMatch[0].length);
  const tokens = afterPrep.split(/[^A-Za-z0-9_\-\/]+/).filter(Boolean);
  if (tokens.length === 0) return undefined;

  const phrase: string[] = [];
  for (const token of tokens) {
    if (phrase.length >= SCOPE_MAX_TOKENS) break;
    const lower = token.toLowerCase();
    if (phrase.length > 0 && SCOPE_BOUNDARY_TOKENS.has(lower)) break;
    phrase.push(token);
  }
  if (phrase.length === 0) return undefined;

  return canonicalizeScope(phrase.join(" "));
}

/**
 * Extracts a scope qualifier that PRECEDES a claim.
 *
 * Handles the "In production, the gate is enabled" construction, where the
 * qualifier opens the clause rather than trailing the polarity word.
 */
export function extractLeadingScope(clause: string): string | undefined {
  const re = /\b(?:only\s+)?(instead\s+of|within|during|while|when|before|after|under|across|between|in|on|at|for|per)\s+([^,;.]{1,40}),/gi;
  let last: string | undefined;
  let match: RegExpExecArray | null;
  while ((match = re.exec(clause)) !== null) {
    const tokens = match[2].split(/[^A-Za-z0-9_\-/]+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const phrase: string[] = [];
    for (const token of tokens) {
      if (phrase.length >= SCOPE_MAX_TOKENS) break;
      if (phrase.length > 0 && SCOPE_BOUNDARY_TOKENS.has(token.toLowerCase())) break;
      phrase.push(token);
    }
    if (phrase.length === 0) continue;
    last = canonicalizeScope(phrase.join(" "));
  }
  return last;
}

/**
 * Scopes that unambiguously denote an environment or context.
 *
 * A free-text qualifier is not necessarily a scope: "the CLI uses bun runtime
 * for fast startup" states a rationale, not a context, while "the gateway
 * binds to port 3000 for development" states an environment. Only the
 * vocabulary below (plus numbered tiers and levels) is treated as a scope for
 * claims whose trailing phrase is a rationale.
 */
const STRONG_SCOPES = new Set([
  "production",
  "development",
  "testing",
  "staging",
  "analytics",
  "desktop",
  "mobile",
  "frontend",
  "backend",
  "local",
  "ci",
  "container",
  "browser",
  "server",
  "client",
  "default",
]);

/**
 * Reports whether a scope names a real environment or context.
 *
 * Numbered qualifiers ("tier 2", "level 3", "v4") are environments too.
 */
export function isStrongScope(scope?: string): boolean {
  if (!scope) return false;
  const norm = canonicalizeScope(scope);
  if (STRONG_SCOPES.has(norm)) return true;
  return /^(tier|level|stage|phase|version|v)\s*\d+$/.test(norm);
}

/**
 * Decides whether two claims made in two scopes may contradict each other.
 *
 * - Neither scoped: same (default) context — comparable.
 * - Both scoped and equal: same context — comparable.
 * - Both scoped and different: distinct contexts — distinct truths, NOT a
 *   contradiction. This is the rule that stops "enabled in production" from
 *   fighting "disabled on localhost".
 * - Exactly one scoped: the scoped claim refines the general one. The general
 *   claim does not state what happens in that scope, so the two are not
 *   opposing statements about the same context — NOT comparable.
 *
 * The asymmetry is deliberate: a false positive flips two good memories to
 * `conflicted`, costs 50 health points and removes both from every future
 * sync broadcast, while a false negative merely leaves a tension unreported.
 */
export function scopesAreCompatible(scopeA?: string, scopeB?: string): boolean {
  const a = scopeA ? canonicalizeScope(scopeA) : "";
  const b = scopeB ? canonicalizeScope(scopeB) : "";
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a === b;
}
