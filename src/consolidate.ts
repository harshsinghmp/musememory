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

import {
  tokenBag,
  mergeBag,
  cosineSimilarity,
  clusterByTokenOverlap,
  dominantTopicTokens,
  entryTokens,
} from "./compounding/cluster.ts";

export {
  tokenBag,
  mergeBag,
  cosineSimilarity,
  clusterByTokenOverlap,
  dominantTopicTokens,
  entryTokens,
};

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
