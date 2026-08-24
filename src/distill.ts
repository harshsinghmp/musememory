import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "./store.ts";
import { list, slugifyId } from "./store.ts";
import { scanSecrets } from "./secrets.ts";
import { tokenize } from "./retrieval.ts";
import { clusterByTokenOverlap, tokenBag, mergeBag, dominantTopicTokens } from "./consolidate.ts";
import type { MemoryEntry } from "./types.ts";

export interface DistillOptions {
  /** Minimum cluster size to emit a skill (default 3). */
  minCount?: number;
  dryRun?: boolean;
  /** Override output dir (defaults to <workspaceRoot>/.agents/skills). */
  skillsDir?: string;
}

export interface DistillReport {
  created: { slug: string; path: string; members: string[] }[];
  skippedExisting: { slug: string; members: string[] }[];
  clustersBelowThreshold: number;
}

function fixTokens(e: MemoryEntry): Map<string, number> {
  // Title weighted 2x, tags weighted 2x so shared tags strongly bind a cluster.
  const bag = tokenBag(e.title, 2);
  mergeBag(bag, tokenBag((e.tags ?? []).join(" "), 2));
  return bag;
}

/**
 * Self-Evolving Skill Distillation:
 * cluster confirmed fix-type entries by tag overlap + title token similarity;
 * clusters with >= minCount members become `.agents/skills/<slug>/SKILL.md`
 * with frontmatter and deduplicated steps ordered oldest-first. Existing skill
 * folders are never overwritten. Generated content is secret-scanned.
 */
export function distillSkills(store: Store, workspaceRoot: string, options: DistillOptions = {}): DistillReport {
  const minCount = options.minCount ?? 3;
  const report: DistillReport = { created: [], skippedExisting: [], clustersBelowThreshold: 0 };

  const fixes = list(store)
    .filter((e) => e.status === "confirmed" && e.type === "fix")
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)); // oldest first

  const clusters = clusterByTokenOverlap(fixes, fixTokens, 0.5);
  const skillsDir = options.skillsDir ?? join(workspaceRoot, ".agents", "skills");

  for (const cluster of clusters) {
    if (cluster.length < minCount) {
      report.clustersBelowThreshold++;
      continue;
    }

    const topic = dominantTopicTokens(cluster.map((e) => e.title));
    const slug = slugifyId(topic.join("-") || "skill");
    const dir = join(skillsDir, slug);
    const memberIds = cluster.map((e) => e.id);

    if (existsSync(dir)) {
      report.skippedExisting.push({ slug, members: memberIds });
      continue;
    }

    const md = renderSkillMd(cluster, topic);
    const secrets = scanSecrets(md);
    if (secrets.length > 0) {
      throw new Error(`Secret detected in generated SKILL.md for '${slug}': ${secrets.join(", ")}`);
    }

    if (!options.dryRun) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), md, "utf8");
    }
    report.created.push({ slug, path: join(dir, "SKILL.md"), members: memberIds });
  }

  return report;
}

/** Frontmatter + distilled steps: lines deduped case-insensitively, ordered by entry age. */
function renderSkillMd(cluster: MemoryEntry[], topic: string[]): string {
  const name = (topic.join(" ") || "recurring fix")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const description = `Distilled recurring fix pattern from ${cluster.length} confirmed memories`;
  const seen = new Set<string>();
  const steps: string[] = [];
  for (const e of cluster) {
    for (const raw of e.content.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      steps.push(`- ${line}`);
    }
  }
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# Skill: ${name}\n\n${steps.join("\n")}\n`;
}
