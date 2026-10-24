/**
 * T-320: Subject-bound, scope-aware polarity claims.
 *
 * The contradiction engine used to compare two memories by testing seven bare
 * regex pairs against the concatenated title+content of each side. Every
 * polarity word was therefore a free-floating token: "pooling is enabled in
 * production" collided with "pooling is disabled on localhost" purely because
 * one text happened to contain an "enable"-ish token and the other a
 * "disable"-ish one. A single false positive poisoned *both* memories —
 * flagging them `conflicted` costs 25 health points each, removes them from
 * every future sync broadcast, and leaves them still being injected into
 * agent prompts.
 *
 * This module replaces that with *claims*. A claim states what a subject is,
 * under which relation, with which target value, in which scope. Two memories
 * contradict only when their claims oppose each other on the same subject in
 * a compatible context.
 */

import { areTargetsContradictory } from "./invalidation.ts";
import {
  canonicalizeScope,
  extractLeadingScope,
  extractTrailingScope,
  isStrongScope,
  scopesAreCompatible,
} from "./scope.ts";

export interface PolarityClaim {
  /** Normalized subject the claim is about ("wiki recompile gate"). */
  entity: string;
  /** Canonical relation the claim constrains ("status", "database", ...). */
  relation: string;
  /** Normalized target value ("enabled", "postgresql", "3000"). */
  target: string;
  /** Canonical scope qualifier ("production", "tier 2"), when the claim has one. */
  scope?: string;
  /** Verbatim source fragment, used to build audit reasons. */
  evidence: string;
}

// ---------------------------------------------------------------------------
// Token vocabularies
// ---------------------------------------------------------------------------

const DETERMINER_TOKENS = new Set([
  "the", "a", "an", "this", "that", "these", "those", "our", "its", "their",
  "my", "your", "some", "any", "each", "every", "all", "both", "one", "other",
  "no", "most", "such",
]);

const AUXILIARY_TOKENS = new Set([
  "is", "are", "was", "were", "be", "been", "being", "am", "remains", "remain",
  "remained", "stays", "stay", "stayed", "get", "gets", "got", "getting",
  "should", "must", "needs", "need", "to", "has", "have", "had", "will",
  "would", "can", "could", "may", "might", "do", "does", "did", "not", "also",
  "then", "than", "so", "if", "when", "while", "because", "since", "unless",
  "which", "that", "where", "how", "what", "why", "and", "or", "but", "there",
  "it", "its", "we", "you", "they",
]);

const TRAILING_PREPOSITION_TOKENS = new Set([
  "for", "in", "on", "at", "of", "with", "to", "from", "by", "during", "when",
  "while", "under", "within", "across", "per", "about", "into", "onto", "via",
  "using", "after", "before", "since", "until", "against", "between", "among",
  "like", "as", "than", "and", "or", "but", "so", "because", "over", "under",
]);

const LEADING_TRIM_TOKENS = new Set([
  ...DETERMINER_TOKENS,
  "for", "about", "regarding", "concerning", "with", "using", "via", "when",
  "while", "because", "since", "if",
]);

/** Verbs that commonly sit between a subject and its object. */
const TRAILING_VERB_TOKENS = new Set([
  "bind", "binds", "binding", "run", "runs", "running", "listen", "listens",
  "listening", "serve", "serves", "serving", "use", "uses", "using", "connect",
  "connects", "connecting", "expose", "exposes", "exposing", "prefers",
  "prefer", "prefers", "target", "targets", "targeting", "serve", "serves",
  "provide", "provides", "providing", "keep", "keeps", "keeping", "always",
  "never",
]);

/** Sentence-level clause boundaries used to scope subject extraction. */
const CLAUSE_BOUNDARIES = [".", ";", "\n", "!", "?", "|"];

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text.split(/[^A-Za-z0-9_\-/]+/).filter(Boolean);
}

function lastClauseBoundary(text: string): number {
  let index = -1;
  for (const boundary of CLAUSE_BOUNDARIES) {
    const found = text.lastIndexOf(boundary);
    if (found > index) index = found;
  }
  return index;
}

function trimTrailing(tokens: string[], vocab: Set<string>): string[] {
  const out = [...tokens];
  while (out.length && vocab.has(out[out.length - 1].toLowerCase())) out.pop();
  return out;
}

/** Technology names never belong to the subject of a claim about them. */
const TECHNOLOGY_TOKENS = new Set([
  "postgres", "postgresql", "mysql", "sqlite", "mongodb", "bun", "node",
  "deno", "rest", "graphql", "grpc", "dark", "light",
]);

/**
 * Extracts the subject phrase that immediately precedes a claim.
 *
 * Reads backwards from the claim, stopping at the enclosing sentence, then
 * drops auxiliaries, prepositions and verbs so that only the noun phrase
 * remains. Returns "" when nothing bindable is found — an unanchored claim
 * cannot be compared safely and is therefore discarded by the caller.
 */
function subjectBefore(text: string, claimIndex: number, maxTokens = 4): string {
  const before = text.slice(0, claimIndex);
  const clause = before.slice(lastClauseBoundary(before) + 1);
  let tokens = tokenize(clause);
  tokens = trimTrailing(tokens, AUXILIARY_TOKENS);
  tokens = trimTrailing(tokens, TRAILING_VERB_TOKENS);
  tokens = trimTrailing(tokens, TRAILING_PREPOSITION_TOKENS);
  tokens = tokens.slice(-maxTokens);
  tokens = tokens.filter((token) => !TECHNOLOGY_TOKENS.has(token.toLowerCase()));
  while (tokens.length && LEADING_TRIM_TOKENS.has(tokens[0].toLowerCase())) tokens.shift();
  tokens = trimTrailing(tokens, TRAILING_PREPOSITION_TOKENS);
  return tokens.join(" ").toLowerCase();
}

/**
 * Extracts the object phrase that follows a verb-shaped claim
 * ("enables the wiki recompile gate").
 */
function objectAfter(text: string, fromIndex: number): { phrase: string; endIndex: number } | null {
  const rest = text.slice(fromIndex);
  const tokens: string[] = [];
  let consumed = fromIndex;
  const re = /[\s:,\-]*([A-Za-z0-9_\-/]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(rest)) !== null) {
    const word = match[1];
    const lower = word.toLowerCase();
    if (tokens.length >= 4) break;
    if (tokens.length > 0 && (TRAILING_PREPOSITION_TOKENS.has(lower) || AUXILIARY_TOKENS.has(lower))) break;
    if (tokens.length === 0 && DETERMINER_TOKENS.has(lower)) {
      consumed = fromIndex + match.index + match[0].length;
      continue;
    }
    tokens.push(word);
    consumed = fromIndex + match.index + match[0].length;
  }
  if (tokens.length === 0) return null;
  return { phrase: tokens.join(" ").toLowerCase(), endIndex: consumed };
}

/**
 * Detects migration phrasing ("migrated from MySQL to PostgreSQL") where a
 * mentioned technology is the source rather than the current state. Such
 * mentions must not become claims.
 */
function isMigrationContext(before: string): boolean {
  const tail = before.slice(-48).toLowerCase();
  return /\b(from|migrat\w*|switch\w*|move[ds]?|chang\w*|replac\w*|instead\s+of|convert\w*|port\w*)\b[^.]{0,30}$/.test(tail);
}

/**
 * Resolves the scope for a claim.
 *
 * For status claims the trailing qualifier always qualifies the claim — "the
 * gate is enabled for observations" and "the gate is enabled for the memory
 * store" are claims about different things, so their qualifiers must not be
 * treated as interchangeable.
 *
 * For technology claims the trailing phrase is usually a rationale ("uses
 * bun runtime for fast startup"), so it only counts as a scope when it names
 * a real environment.
 */
function resolveScope(
  text: string,
  claimEnd: number,
  claimStart: number,
  options?: { strongOnly?: boolean },
): string | undefined {
  const strongOnly = options?.strongOnly === true;
  const trailing = extractTrailingScope(text, claimEnd);
  if (trailing && (!strongOnly || isStrongScope(trailing))) return trailing;

  const before = text.slice(0, claimStart);
  const clause = before.slice(lastClauseBoundary(before) + 1);
  const leading = extractLeadingScope(clause);
  if (leading && (!strongOnly || isStrongScope(leading))) return leading;

  return undefined;
}

// ---------------------------------------------------------------------------
// Claim families
// ---------------------------------------------------------------------------

const STATUS_ADJECTIVES = [
  "enabled", "disabled", "active", "inactive", "allowed", "denied", "forbidden",
];

const VERB_STATUS: Record<string, string> = {
  enable: "enabled",
  enables: "enabled",
  disable: "disabled",
  disables: "disabled",
  allow: "allowed",
  allows: "allowed",
  deny: "denied",
  denies: "denied",
};

const DB_TARGETS: Record<string, string> = {
  postgres: "postgresql",
  postgresql: "postgresql",
  mysql: "mysql",
  sqlite: "sqlite",
  mongodb: "mongodb",
};

const DB_ANCHOR_BEFORE =
  /\b(?:uses?|using|use\s+of|primary\s+database|database|db|engine|store|persistence|persisted\s+(?:in|to)|backed\s+by|runs?\s+on)\b[^A-Za-z0-9]{0,30}$/i;
const DB_ANCHOR_AFTER = /^\s*(?:is|as)\s+(?:the\s+)?(?:primary\s+)?(?:database|store|engine|db)\b/i;

function statusClaims(text: string): PolarityClaim[] {
  const claims: PolarityClaim[] = [];

  // Adjectival status: "<subject> is enabled".
  const adjectiveRe = new RegExp(`\\b(${STATUS_ADJECTIVES.join("|")})\\b`, "gi");
  let match: RegExpExecArray | null;
  while ((match = adjectiveRe.exec(text)) !== null) {
    const term = match[1].toLowerCase();
    const entity = subjectBefore(text, match.index);
    if (!entity) continue;
    const scope = resolveScope(text, match.index + match[0].length, match.index);
    claims.push({
      entity,
      relation: "status",
      target: term,
      scope,
      evidence: match[0],
    });
  }

  // Boolean status: "<subject> is true" / "= false".
  const booleanRe = /\b(is|are|was|were|=|:)\s+(true|false)\b/gi;
  while ((match = booleanRe.exec(text)) !== null) {
    const term = match[2].toLowerCase();
    const entity = subjectBefore(text, match.index);
    if (!entity) continue;
    const scope = resolveScope(text, match.index + match[0].length, match.index);
    claims.push({
      entity,
      relation: "status",
      target: term,
      scope,
      evidence: match[0],
    });
  }

  // Verbal status: "<subject> enables <object>".
  const verbRe = /\b(enables?|disables?|allows?|denies?)\b/gi;
  while ((match = verbRe.exec(text)) !== null) {
    const verb = match[1].toLowerCase();
    const target = VERB_STATUS[verb];
    if (!target) continue;
    const object = objectAfter(text, match.index + match[0].length);
    if (!object) continue;
    const scope = resolveScope(text, object.endIndex, match.index);
    claims.push({
      entity: object.phrase,
      relation: "status",
      target,
      scope,
      evidence: `${match[0]} ${object.phrase}`,
    });
  }

  return claims;
}

function databaseClaims(text: string): PolarityClaim[] {
  const claims: PolarityClaim[] = [];
  const re = /\b(postgres(?:ql)?|mysql|sqlite|mongodb)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const token = match[1].toLowerCase();
    const before = text.slice(0, match.index);
    const after = text.slice(match.index + match[0].length);
    if (isMigrationContext(before)) continue;
    const anchored = DB_ANCHOR_BEFORE.test(before) || DB_ANCHOR_AFTER.test(after);
    if (!anchored) continue;
    const scope = resolveScope(text, match.index + match[0].length, match.index, { strongOnly: true });
    claims.push({
      entity: subjectBefore(text, match.index, 3) || "database",
      relation: "database",
      target: DB_TARGETS[token] ?? token,
      scope,
      evidence: match[0],
    });
  }
  return claims;
}

function portClaims(text: string): PolarityClaim[] {
  const claims: PolarityClaim[] = [];
  const re = /\bport\s+(\d{2,5})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const entity = subjectBefore(text, match.index, 3);
    if (!entity) continue;
    const scope = resolveScope(text, match.index + match[0].length, match.index, { strongOnly: true });
    claims.push({
      entity,
      relation: "port",
      target: match[1],
      scope,
      evidence: match[0],
    });
  }
  return claims;
}

/**
 * A protocol word only becomes a claim when its clause talks about an API
 * surface. "The rest of the file is large" is not a protocol statement.
 */
const PROTOCOL_ANCHOR = /\b(api|protocol|service|endpoint|interface|route|client|server)\b/i;

function protocolClaims(text: string): PolarityClaim[] {
  const claims: PolarityClaim[] = [];
  const re = /\b(rest\s+api|graphql|grpc|rest)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const token = match[1].toLowerCase();
    if (isMigrationContext(text.slice(0, match.index))) continue;

    // The anchor must come from the clause, not from the matched word itself.
    const before = text.slice(0, match.index);
    const clause = text.slice(lastClauseBoundary(before) + 1);
    const clauseWithoutMatch = `${clause}${text.slice(match.index + match[0].length).split(/[.;\n]/)[0]}`;
    if (!PROTOCOL_ANCHOR.test(clauseWithoutMatch)) continue;

    const entity = subjectBefore(text, match.index, 3);
    if (!entity) continue;
    const target = token.startsWith("rest") ? "rest" : token;
    const scope = resolveScope(text, match.index + match[0].length, match.index, { strongOnly: true });
    claims.push({
      entity,
      relation: "protocol",
      target,
      scope,
      evidence: match[0],
    });
  }
  return claims;
}

function runtimeClaims(text: string): PolarityClaim[] {
  const claims: PolarityClaim[] = [];
  const re = /\b(bun|node|deno)\s+runtime\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (isMigrationContext(text.slice(0, match.index))) continue;
    const entity = subjectBefore(text, match.index, 3);
    if (!entity) continue;
    const scope = resolveScope(text, match.index + match[0].length, match.index, { strongOnly: true });
    claims.push({
      entity,
      relation: "runtime",
      target: match[1].toLowerCase(),
      scope,
      evidence: match[0],
    });
  }
  return claims;
}

function themeClaims(text: string): PolarityClaim[] {
  const claims: PolarityClaim[] = [];
  const re = /\b(dark|light)\s+(?:mode|theme)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const entity = subjectBefore(text, match.index, 3);
    if (!entity) continue;
    const scope = resolveScope(text, match.index + match[0].length, match.index, { strongOnly: true });
    claims.push({
      entity,
      relation: "theme",
      target: match[1].toLowerCase(),
      scope,
      evidence: match[0],
    });
  }
  return claims;
}

function policyClaims(text: string): PolarityClaim[] {
  const claims: PolarityClaim[] = [];
  const re = /\b(always|never)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const object = objectAfter(text, match.index + match[0].length);
    if (!object) continue;
    claims.push({
      entity: object.phrase,
      relation: "policy",
      target: match[1].toLowerCase(),
      scope: undefined,
      evidence: `${match[0]} ${object.phrase}`,
    });
  }
  return claims;
}

/**
 * Removes duplicate claims produced by the same statement appearing more than
 * once, and drops an unscoped duplicate when a scoped variant of the same
 * claim exists (the scoped one is strictly more informative).
 */
function dedupeClaims(claims: PolarityClaim[]): PolarityClaim[] {
  const scopedKeys = new Set<string>();
  for (const claim of claims) {
    if (claim.scope) scopedKeys.add(`${claim.entity}|${claim.relation}|${claim.target}`);
  }

  const seen = new Set<string>();
  const unique: PolarityClaim[] = [];
  for (const claim of claims) {
    const key = `${claim.entity}|${claim.relation}|${claim.target}|${claim.scope ?? ""}`;
    if (seen.has(key)) continue;
    if (!claim.scope && scopedKeys.has(`${claim.entity}|${claim.relation}|${claim.target}`)) continue;
    seen.add(key);
    unique.push(claim);
  }
  return unique;
}

/**
 * Extracts every polarity claim a piece of text makes.
 *
 * Claims with no bindable subject are dropped: an unanchored polarity word
 * cannot be compared safely against another memory.
 */
export function extractPolarityClaims(text: string): PolarityClaim[] {
  if (!text) return [];
  const claims = [
    ...statusClaims(text),
    ...databaseClaims(text),
    ...portClaims(text),
    ...protocolClaims(text),
    ...runtimeClaims(text),
    ...themeClaims(text),
    ...policyClaims(text),
  ];
  return dedupeClaims(claims);
}

/**
 * Stable, human-readable labels for each conflict type.
 *
 * The label is the first thing in a conflict reason so that existing
 * consumers (audit readers, conflict resolvers, test assertions) keep a
 * stable string to match on, while the detail that follows names the exact
 * subject, values and scope that collided.
 */
const RELATION_LABELS: Record<string, string> = {
  status: "Opposing configuration polarity",
  database: "Conflicting primary database choice",
  port: "Conflicting port binding",
  protocol: "Conflicting communication protocol",
  runtime: "Conflicting runtime engine",
  theme: "Conflicting theme selection",
  policy: "Contradictory universal policy",
};

/**
 * Compares two polarity claims.
 *
 * A contradiction requires all three of:
 *   - the same relation,
 *   - the same subject,
 *   - a compatible scope,
 *   - mutually exclusive target values.
 */
export function comparePolarityClaims(
  a: PolarityClaim,
  b: PolarityClaim,
): { conflicting: boolean; reason?: string } {
  if (a.relation !== b.relation) return { conflicting: false };

  if (!a.entity || !b.entity) return { conflicting: false };

  const entityMatches =
    a.entity === b.entity || a.entity.includes(b.entity) || b.entity.includes(a.entity);
  if (!entityMatches) {
    return {
      conflicting: false,
      reason: `Subject mismatch: '${a.entity}' vs '${b.entity}' are different subjects`,
    };
  }

  if (!scopesAreCompatible(a.scope, b.scope)) {
    return {
      conflicting: false,
      reason: `Distinct scopes: '${a.scope ?? "unscoped"}' vs '${b.scope ?? "unscoped"}' represent distinct contextual truths, not a contradiction`,
    };
  }

  if (areTargetsContradictory(a.target, b.target)) {
    const label = RELATION_LABELS[a.relation] ?? "Contradictory claims";
    return {
      conflicting: true,
      reason: `${label}: contradictory ${a.relation} values '${a.target}' vs '${b.target}' for subject '${a.entity}'${a.scope ? ` in scope '${a.scope}'` : ""}`,
    };
  }

  return { conflicting: false };
}

export { canonicalizeScope };
