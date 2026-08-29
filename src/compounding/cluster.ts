import { tokenize } from "../retrieval.ts";
import type { MemoryEntry } from "../types.ts";

/**
 * Weighted token bag: `weight` per occurrence slot (titles get extra weight).
 */
export function tokenBag(text: string, weight = 1): Map<string, number> {
  const bag = new Map<string, number>();
  for (const t of tokenize(text)) {
    bag.set(t, (bag.get(t) ?? 0) + weight);
  }
  return bag;
}

/**
 * Merge source token bag into target token bag.
 */
export function mergeBag(target: Map<string, number>, add: Map<string, number>): void {
  for (const [t, v] of add) {
    target.set(t, (target.get(t) ?? 0) + v);
  }
}

/**
 * Cosine similarity between weighted token bags; 0 when either is empty.
 */
export function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const v of a.values()) na += v * v;
  for (const [t, v] of b) {
    nb += v * v;
    const av = a.get(t);
    if (av) dot += av * v;
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Greedy single-pass clustering: assign each item to the most-similar existing
 * cluster (merged-bag centroid) above threshold, else open a new cluster.
 */
export function clusterByTokenOverlap<T>(
  items: T[],
  tokensFor: (item: T) => Map<string, number>,
  threshold = 0.5,
): T[][] {
  const clusters: { bag: Map<string, number>; items: T[] }[] = [];
  for (const item of items) {
    const bag = tokensFor(item);
    let best: { bag: Map<string, number>; items: T[] } | null = null;
    let bestScore = 0;
    for (const c of clusters) {
      const score = cosineSimilarity(bag, c.bag);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best && bestScore >= threshold) {
      best.items.push(item);
      mergeBag(best.bag, bag);
    } else {
      clusters.push({ bag: new Map(bag), items: [item] });
    }
  }
  return clusters.map((c) => c.items);
}

/**
 * Most frequent non-stopword title tokens, used as dominant topic descriptors.
 */
export function dominantTopicTokens(titles: string[], topK = 2): string[] {
  const stopwords = new Set([
    "the", "a", "an", "and", "or", "to", "of", "in", "for", "with", "on", "is",
    "use", "uses", "when", "always", "never", "via", "after", "before", "not",
    "this", "about",
  ]);
  const freq = new Map<string, number>();
  for (const title of titles) {
    for (const t of tokenize(title)) {
      if (stopwords.has(t)) continue;
      freq.set(t, (freq.get(t) ?? 0) + 1);
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([t]) => t);
}

/**
 * Create a weighted token bag for a MemoryEntry (title weighted 2x).
 */
export function entryTokens(e: MemoryEntry): Map<string, number> {
  const bag = tokenBag(e.title, 2);
  mergeBag(bag, tokenBag(e.content, 1));
  return bag;
}
