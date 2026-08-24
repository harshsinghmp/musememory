import type { Store } from "./store.ts";
import { list, propose, link, slugifyId } from "./store.ts";
import { tokenize } from "./retrieval.ts";
import type { MemoryEntry } from "./types.ts";

export interface ConsolidateOptions {
  project?: string;
  dryRun?: boolean;
  /** Minimum cluster size to become a scene (default 3). */
  minCluster?: number;
  /** Cosine token-bag similarity threshold for clustering (default 0.5). */
  threshold?: number;
}

export interface SceneSummary {
  title: string;
  members: string[];
  id?: string;
}

export interface ConsolidationReport {
  scenesCreated: SceneSummary[];
  skippedClusters: { reason: string; members: string[] }[];
}

/** Weighted token bag: `weight` per occurrence slot (titles get extra weight). */
export function tokenBag(text: string, weight = 1): Map<string, number> {
  const bag = new Map<string, number>();
  for (const t of tokenize(text)) {
    bag.set(t, (bag.get(t) ?? 0) + weight);
  }
  return bag;
}

export function mergeBag(target: Map<string, number>, add: Map<string, number>): void {
  for (const [t, v] of add) target.set(t, (target.get(t) ?? 0) + v);
}

/** Cosine similarity between weighted token bags; 0 when either is empty. */
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
 * Generic so skill distillation can reuse it with different token sources.
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

/** Most frequent non-stopword title tokens, used as the scene's dominant topic. */
export function dominantTopicTokens(titles: string[]): string[] {
  const stopwords = new Set([
    "the", "a", "an", "and", "or", "to", "of", "in", "for", "with", "on", "is",
    "use", "uses", "when", "always", "never", "via", "after", "before", "not",
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
    .slice(0, 2)
    .map(([t]) => t);
}

function entryTokens(e: MemoryEntry): Map<string, number> {
  // Title tokens weighted 2x so titles dominate the similarity signal.
  const bag = tokenBag(e.title, 2);
  mergeBag(bag, tokenBag(e.content, 1));
  return bag;
}

/**
 * Scene-Based Hierarchical Consolidation:
 * cluster confirmed memories by (project, type) + token-overlap similarity; each
 * sufficiently large cluster becomes a confirmed `Scene:` architecture rollup
 * bidirectionally linked to every member. Idempotent: clusters whose members are
 * already linked to an existing scene are skipped.
 */
export function consolidateScenes(store: Store, options: ConsolidateOptions = {}): ConsolidationReport {
  const minCluster = options.minCluster ?? 3;
  const threshold = options.threshold ?? 0.5;

  const all = list(store);
  const sceneIds = new Set(all.filter((e) => e.title.startsWith("Scene:")).map((e) => e.id));
  const coveredMembers = new Set<string>();
  for (const e of all) {
    for (const rid of e.related_memory_ids ?? []) {
      if (sceneIds.has(rid)) coveredMembers.add(e.id);
    }
  }

  let candidates = all.filter((e) => e.status === "confirmed" && !sceneIds.has(e.id));
  if (options.project) candidates = candidates.filter((e) => e.project === options.project);

  const groups = new Map<string, MemoryEntry[]>();
  for (const e of candidates) {
    const key = `${e.project}|${e.type ?? "unknown"}`;
    const group = groups.get(key);
    if (group) group.push(e);
    else groups.set(key, [e]);
  }

  const report: ConsolidationReport = { scenesCreated: [], skippedClusters: [] };

  for (const [, members] of groups) {
    const clusters = clusterByTokenOverlap(members, entryTokens, threshold);
    for (const cluster of clusters) {
      const ids = cluster.map((m) => m.id);
      if (cluster.length < minCluster) continue;
      if (cluster.some((m) => coveredMembers.has(m.id))) {
        report.skippedClusters.push({ reason: "already covered by an existing scene", members: ids });
        continue;
      }

      const topic = dominantTopicTokens(cluster.map((m) => m.title));
      const title = `Scene: ${topic.length > 0 ? topic.join(" ") : cluster[0].type ?? "patterns"}`;
      const rollup =
        `Consolidated scene of ${cluster.length} related ${cluster[0].type ?? ""} memories in ` +
        `${cluster[0].project} (${ids.join(", ")}). Rollup: ` +
        cluster.map((m) => m.content.replace(/\s+/g, " ").trim()).join(" ");

      if (options.dryRun) {
        report.scenesCreated.push({ title, members: ids });
        continue;
      }

      const scene = propose(store, {
        title,
        content: rollup,
        project: cluster[0].project,
        type: "architecture",
        confirmed: true,
        source: "consolidator",
      });
      link(store, scene.id, ids);
      report.scenesCreated.push({ id: scene.id, title, members: ids });
    }
  }

  return report;
}

/** Slug for a skill/scene topic derived from dominant tokens. */
export function topicSlug(topicTokens: string[], fallback = "scene"): string {
  return slugifyId(topicTokens.join("-") || fallback);
}
