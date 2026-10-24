import type { MemoryEntry, SemanticFactTriple } from "../types.ts";
import { canonicalizeScope, extractTrailingScope } from "./scope.ts";
export { canonicalizeScope } from "./scope.ts";
export type { SemanticFactTriple };

export interface ScopedAlignmentResult {
  aligned: boolean;
  conflicting: boolean;
  reason?: string;
}

export interface ScopedInvalidationResult {
  shouldInvalidate: boolean;
  aligned: boolean;
  conflicting: boolean;
  confidence: number;
  reason?: string;
  matchingTriples?: {
    existingTriple: SemanticFactTriple;
    candidateTriple: SemanticFactTriple;
  };
}

// Canonical relation aliases
const RELATION_ALIASES: Record<string, string> = {
  db: "database",
  database: "database",
  primary_db: "database",
  engine: "database",
  port: "port",
  port_binding: "port",
  binds_port: "port",
  listen_port: "port",
  status: "status",
  state: "status",
  polarity: "status",
  permission: "status",
  theme: "theme",
  ui_theme: "theme",
  mode: "theme",
  protocol: "protocol",
  communication_protocol: "protocol",
  api_style: "protocol",
  runtime: "runtime",
  runtime_engine: "runtime",
};

// Canonical scope aliases live in ./scope.ts (T-320) so that the scope
// vocabulary has exactly one owner shared by the triple machinery and the
// polarity claim extractor.

// Mutually exclusive target pairs (polarities or competing options)
const CONFLICTING_TARGET_PAIRS: [RegExp, RegExp][] = [
  [/\b(enable|enabled|true|allow|allowed|active)\b/i, /\b(disable|disabled|false|deny|denied|inactive|forbidden)\b/i],
  [/\b(postgres|postgresql)\b/i, /\b(mysql|sqlite|mongodb)\b/i],
  [/\b(mysql)\b/i, /\b(sqlite|mongodb)\b/i],
  [/\b(dark)\b/i, /\b(light)\b/i],
  [/\b(bun)\b/i, /\b(node|deno)\b/i],
  [/\b(rest)\b/i, /\b(graphql|grpc)\b/i],
  [/\b(always)\b/i, /\b(never)\b/i],
];

export function normalizeTerm(term?: string): string {
  if (!term) return "";
  return term.toLowerCase().trim().replace(/[-_\s]+/g, " ");
}

export function canonicalizeRelation(rel?: string): string {
  const norm = normalizeTerm(rel);
  return RELATION_ALIASES[norm] || norm;
}

/**
 * Extracts explicit or heuristic fact triples from a memory entry or candidate draft.
 */
export function extractFactTriples(
  entry: MemoryEntry | { title: string; content: string; triples?: SemanticFactTriple[]; tags?: string[]; mem_path?: string },
): SemanticFactTriple[] {
  // 1. Explicit triples on entry
  if (entry.triples && Array.isArray(entry.triples) && entry.triples.length > 0) {
    return entry.triples.map((t) => ({
      entity: normalizeTerm(t.entity),
      relation: canonicalizeRelation(t.relation),
      target: normalizeTerm(t.target),
      scope: t.scope ? canonicalizeScope(t.scope) : undefined,
    }));
  }

  const triples: SemanticFactTriple[] = [];
  const text = `${entry.title} ${entry.content}`;
  const lowerText = text.toLowerCase();

  // Scope detection heuristic from text and tags
  let tagScope: string | undefined;
  if (entry.tags) {
    for (const tag of entry.tags) {
      if (tag.startsWith("scope:")) {
        tagScope = canonicalizeScope(tag.replace("scope:", ""));
        break;
      }
    }
  }
  let fixedScope: string | undefined;
  if (/\b(in\s+production|for\s+production|prod\s+server|production\s+database|production\s+environment)\b/i.test(text)) {
    fixedScope = "production";
  } else if (/\b(in\s+development|for\s+development|dev\s+server|development\s+environment|local\s+dev)\b/i.test(text)) {
    fixedScope = "development";
  } else if (/\b(for\s+analytics|analytics\s+warehouse|analytics\s+database|in\s+olap)\b/i.test(text)) {
    fixedScope = "analytics";
  } else if (/\b(on\s+macos|macos\s+desktop|for\s+desktop)\b/i.test(text)) {
    fixedScope = "desktop";
  } else if (/\b(on\s+mobile|mobile\s+ios|on\s+ios|on\s+android|mobile\s+app)\b/i.test(text)) {
    fixedScope = "mobile";
  } else if (/\b(in\s+staging|staging\s+environment)\b/i.test(text)) {
    fixedScope = "staging";
  } else if (/\b(in\s+testing|for\s+test|test\s+environment)\b/i.test(text)) {
    fixedScope = "testing";
  }

  // T-320: Scope is resolved per claim, not per entry. A fixed vocabulary
  // match anywhere in the text is the weakest signal; a qualifier attached to
  // the claim itself ("at tier 2", "for legacy stores") is the strongest.
  const scopeFor = (claimEndIndex: number): string | undefined =>
    tagScope ?? fixedScope ?? extractTrailingScope(text, claimEndIndex);

  // Database pattern
  const dbMatch = text.match(/\b(primary\s+database|database|warehouse|persistence|db)\b.*?uses?\s+([A-Za-z0-9_]+)/i) ||
                  text.match(/\buses?\s+(postgresql|postgres|mysql|sqlite|mongodb)\b/i);
  if (dbMatch) {
    const target = dbMatch[2] ? dbMatch[2].toLowerCase() : dbMatch[1].toLowerCase();
    triples.push({
      entity: "database",
      relation: "database",
      target: target.startsWith("postgres") ? "postgresql" : target,
      scope: scopeFor((dbMatch.index ?? 0) + dbMatch[0].length),
    });
  }

  // Port pattern
  const portMatch = text.match(/\b(binds?\s+to\s+port|runs?\s+on\s+port|port\s+binding|port)\s+([0-9]{2,5})\b/i);
  if (portMatch) {
    triples.push({
      entity: "gateway",
      relation: "port",
      target: portMatch[2],
      scope: scopeFor((portMatch.index ?? 0) + portMatch[0].length),
    });
  }

  // Theme / Mode pattern
  const themeMatch = text.match(/\b(theme|mode)\b.*?\b(dark|light)\b/i) || text.match(/\bprefers?\s+(dark|light)\s+(mode|theme)?\b/i);
  if (themeMatch) {
    const target = (themeMatch[2] || themeMatch[1]).toLowerCase();
    triples.push({
      entity: "user_theme",
      relation: "theme",
      target,
      scope: scopeFor((themeMatch.index ?? 0) + themeMatch[0].length),
    });
  }

  // Runtime pattern
  const runtimeMatch = text.match(/\b(runtime|engine)\b.*?\b(bun|node|deno)\b/i) || text.match(/\b(bun|node|deno)\s+runtime\b/i);
  if (runtimeMatch) {
    const target = (runtimeMatch[2] || runtimeMatch[1]).toLowerCase();
    triples.push({
      entity: "runtime",
      relation: "runtime",
      target,
      scope: scopeFor((runtimeMatch.index ?? 0) + runtimeMatch[0].length),
    });
  }

  // Service / Feature status polarity pattern
  const statusMatch = text.match(/\b([A-Za-z0-9_-]+)\s+(service|feature|caching|compression|plugin)\s*(?:is\s+)?(enabled|disabled|allowed|denied|forbidden|active|inactive)\b/i);
  if (statusMatch) {
    triples.push({
      entity: normalizeTerm(statusMatch[1]),
      relation: "status",
      target: normalizeTerm(statusMatch[3]),
      scope: scopeFor((statusMatch.index ?? 0) + statusMatch[0].length),
    });
  }

  return triples;
}

/**
 * Checks whether two target values are contradictory.
 */
export function areTargetsContradictory(targetA: string, targetB: string): boolean {
  const normA = normalizeTerm(targetA);
  const normB = normalizeTerm(targetB);
  if (normA === normB) return false;

  // Numerical ports: any unequal integer port for the same entity is contradictory
  if (/^\d+$/.test(normA) && /^\d+$/.test(normB)) {
    return normA !== normB;
  }

  for (const [patA, patB] of CONFLICTING_TARGET_PAIRS) {
    if ((patA.test(normA) && patB.test(normB)) || (patB.test(normA) && patA.test(normB))) {
      return true;
    }
  }

  return false;
}

/**
 * Evaluates semantic alignment between two fact triples.
 * Requires:
 * 1. Entity alignment (same entity)
 * 2. Relation alignment (same predicate)
 * 3. Scope alignment (same scope or compatible un-scoped context)
 * 4. Target contradiction (mutually exclusive targets)
 */
export function evaluateScopedAlignment(
  tripleA: SemanticFactTriple,
  tripleB: SemanticFactTriple,
): ScopedAlignmentResult {
  const entityA = normalizeTerm(tripleA.entity);
  const entityB = normalizeTerm(tripleB.entity);
  if (entityA !== entityB && !entityA.includes(entityB) && !entityB.includes(entityA)) {
    return {
      aligned: false,
      conflicting: false,
      reason: `Entity mismatch: '${tripleA.entity}' does not align with '${tripleB.entity}'`,
    };
  }

  const relA = canonicalizeRelation(tripleA.relation);
  const relB = canonicalizeRelation(tripleB.relation);
  if (relA !== relB) {
    return {
      aligned: false,
      conflicting: false,
      reason: `Relation mismatch: predicate '${tripleA.relation}' does not align with '${tripleB.relation}'`,
    };
  }

  // Scope check: If both define scopes, different scopes are distinct contextual truths, NOT a contradiction.
  const scopeA = tripleA.scope ? canonicalizeScope(tripleA.scope) : undefined;
  const scopeB = tripleB.scope ? canonicalizeScope(tripleB.scope) : undefined;
  if (scopeA && scopeB && scopeA !== scopeB) {
    return {
      aligned: false,
      conflicting: false,
      reason: `Distinct scopes: '${scopeA}' vs '${scopeB}' represent distinct contextual truths, not a contradiction`,
    };
  }

  // Entities and relations align in the same scope: check target contradiction
  if (areTargetsContradictory(tripleA.target, tripleB.target)) {
    return {
      aligned: true,
      conflicting: true,
      reason: `Contradictory target values '${tripleA.target}' vs '${tripleB.target}' for entity '${tripleA.entity}' on relation '${tripleA.relation}'${scopeA ? ` in scope '${scopeA}'` : ""}`,
    };
  }

  return {
    aligned: true,
    conflicting: false,
    reason: `Target values '${tripleA.target}' and '${tripleB.target}' are consistent`,
  };
}

/**
 * Evaluates whether an incoming candidate should invalidate an existing memory.
 * Requires (entity, relation, target) alignment and prevents false positives
 * across different scopes (e.g. dev vs prod, macos vs mobile).
 */
export function evaluateScopedInvalidation(
  existing: MemoryEntry,
  candidate: { title: string; content: string; triples?: SemanticFactTriple[]; tags?: string[]; project?: string },
): ScopedInvalidationResult {
  const existingTriples = extractFactTriples(existing);
  const candidateTriples = extractFactTriples(candidate);

  if (existingTriples.length > 0 && candidateTriples.length > 0) {
    let hadScopeOrEntityMismatch = false;
    let mismatchReason = "";

    for (const eTriple of existingTriples) {
      for (const cTriple of candidateTriples) {
        const alignment = evaluateScopedAlignment(eTriple, cTriple);
        if (alignment.aligned && alignment.conflicting) {
          return {
            shouldInvalidate: true,
            aligned: true,
            conflicting: true,
            confidence: 0.95,
            reason: alignment.reason,
            matchingTriples: {
              existingTriple: eTriple,
              candidateTriple: cTriple,
            },
          };
        } else if (!alignment.aligned) {
          hadScopeOrEntityMismatch = true;
          mismatchReason = alignment.reason || "Entity or scope mismatch";
        }
      }
    }

    // Triples were present, but differed in entity or scope: refuse invalidation
    if (hadScopeOrEntityMismatch) {
      return {
        shouldInvalidate: false,
        aligned: false,
        conflicting: false,
        confidence: 0,
        reason: mismatchReason,
      };
    }
  }

  return {
    shouldInvalidate: false,
    aligned: false,
    conflicting: false,
    confidence: 0,
  };
}
