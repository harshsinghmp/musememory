import { createHash } from "node:crypto";
import type { Store } from "../store.ts";
import { get, list, save } from "../store.ts";
import type { MemoryEntry, MemoryQuality, MemoryType, TemporalMode, EvidenceItem } from "../types.ts";

/**
 * Normalizes text for robust content comparison:
 * lowercase, removes markdown syntax, collapses all whitespace into single spaces.
 */
export function normalizeText(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[#*`~_\[\]()]+/g, " ") // Strip common markdown formatting
    .replace(/[^\w\s]/g, " ")        // Strip punctuation
    .replace(/\s+/g, " ")            // Collapse whitespace
    .trim();
}

/**
 * Computes a deterministic SHA-256 fingerprint from title and content.
 */
export function computeFingerprint(title: string, content: string): string {
  const normalized = `${normalizeText(title)}|${normalizeText(content)}`;
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Computes word-level Jaccard similarity between two texts (0.0 to 1.0).
 */
export function computeJaccardSimilarity(textA: string, textB: string): number {
  const wordsA = new Set(normalizeText(textA).split(" ").filter((w) => w.length > 2));
  const wordsB = new Set(normalizeText(textB).split(" ").filter((w) => w.length > 2));

  if (wordsA.size === 0 && wordsB.size === 0) return 1.0;
  if (wordsA.size === 0 || wordsB.size === 0) return 0.0;

  let intersectionSize = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) {
      intersectionSize++;
    }
  }

  const unionSize = wordsA.size + wordsB.size - intersectionSize;
  return unionSize > 0 ? intersectionSize / unionSize : 0;
}

export interface DuplicateMatch {
  exact?: MemoryEntry;
  similar: { entry: MemoryEntry; similarity: number }[];
}

/**
 * Scans the store for exact fingerprint duplicates and near-duplicate memories.
 */
export function findDuplicates(
  store: Store,
  candidate: { title: string; content: string; project?: string; threshold?: number },
): DuplicateMatch {
  const targetFingerprint = computeFingerprint(candidate.title, candidate.content);
  const targetText = `${candidate.title} ${candidate.content}`;
  const threshold = candidate.threshold ?? 0.75;

  const entries = list(store, candidate.project ? { project: candidate.project } : undefined);
  let exactMatch: MemoryEntry | undefined;
  const similar: { entry: MemoryEntry; similarity: number }[] = [];

  for (const e of entries) {
    // Check exact fingerprint match
    const entryFingerprint = e.fingerprint || computeFingerprint(e.title, e.content);
    if (entryFingerprint === targetFingerprint) {
      exactMatch = e;
      continue;
    }

    // Check near-duplicate word similarity
    const entryText = `${e.title} ${e.content}`;
    const sim = computeJaccardSimilarity(targetText, entryText);
    if (sim >= threshold) {
      similar.push({ entry: e, similarity: sim });
    }
  }

  similar.sort((a, b) => b.similarity - a.similarity);
  return { exact: exactMatch, similar };
}

/**
 * Consolidates a duplicate observation into an existing canonical memory entry,
 * appending evidence and reinforcing confidence.
 */
export function consolidateIntoCanonical(
  store: Store,
  canonicalId: string,
  options: {
    content?: string;
    source?: string;
    evidence?: EvidenceItem;
    reinforcementBonus?: number;
  } = {},
): MemoryEntry {
  const canonical = get(store, canonicalId);
  if (!canonical) {
    throw new Error(`Canonical memory with ID ${canonicalId} not found`);
  }

  const updated: MemoryEntry = { ...canonical };

  // Append evidence if provided
  if (options.evidence) {
    updated.evidence = updated.evidence ? [...updated.evidence] : [];
    const exists = updated.evidence.some((ev) => ev.id === options.evidence!.id);
    if (!exists) {
      updated.evidence.push(options.evidence);
    }
  }

  // Duplicate occurrences reinforce the established canonical truth
  const bonus = options.reinforcementBonus ?? 1;
  updated.reinforcement = (updated.reinforcement ?? 0) + bonus;
  updated.updated_at = new Date().toISOString();

  // Recompute quality tier
  updated.quality = determineQuality(updated);

  save(store, updated);
  return updated;
}

/**
 * Infers the temporal mode (current vs historical vs timeless).
 */
export function inferTemporalMode(title: string, content: string, type?: MemoryType): TemporalMode {
  const combined = `${title} ${content}`.toLowerCase();

  // Timeless: constraints, principles, immutable invariants
  if (
    type === "constraint" ||
    /\b(never|always|invariant|universal|mandatory|strictly)\b/.test(combined)
  ) {
    return "timeless";
  }

  // Historical: past migrations, previous architectures, obsolete state
  if (
    /\b(historically|used to|prior to|before migrating|previously used|legacy system|deprecated in favor)\b/.test(
      combined,
    )
  ) {
    return "historical";
  }

  return "current";
}

/**
 * Computes the categorical quality tier for a memory entry.
 */
export function determineQuality(entry: MemoryEntry): MemoryQuality {
  if (entry.status === "conflicted") return "CONFLICTED";
  if (entry.status === "stale" || entry.status === "rejected") return "STALE";

  if (
    entry.verification?.level === "independently-verified" ||
    entry.verification?.level === "authoritative"
  ) {
    return "VERIFIED";
  }

  if (entry.status === "confirmed" && (entry.reinforcement ?? 0) >= 2) {
    return "HIGH";
  }

  if (entry.status === "confirmed" || (entry.salience ?? 0) >= 0.7) {
    return "MEDIUM";
  }

  return "LOW";
}
