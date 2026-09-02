import type { Store } from "../store.ts";
import { propose } from "../store.ts";
import type { HarvestedMemory } from "./types.ts";
import { recordNegativeLesson } from "../learning/negative.ts";
import { scanSecrets } from "../secrets.ts";

export interface HarvestOptions {
  project: string;
  actor?: string;
}

/**
 * Continuous Session Memory Harvester:
 * Automatically scans conversational turns and transcripts to extract
 * durable architectural decisions, bug fixes, constraints, and negative lessons
 * with zero user friction.
 */
export function harvestSessionMemories(
  store: Store,
  conversationText: string,
  options: HarvestOptions,
): HarvestedMemory[] {
  if (!conversationText || !conversationText.trim()) return [];

  // Protect against secrets
  const secrets = scanSecrets(conversationText);
  if (secrets.length > 0) {
    // If text contains credentials, abort extraction to prevent leaks
    return [];
  }

  const harvested: HarvestedMemory[] = [];
  const lines = conversationText.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const lower = line.toLowerCase();

    // 1. Anti-Pattern / Negative Lesson Extraction
    if (
      lower.startsWith("avoid:") ||
      lower.startsWith("do not use") ||
      lower.startsWith("anti-pattern:") ||
      lower.includes("failed approach:")
    ) {
      const title = line.slice(0, 100);
      const contextLines = lines.slice(i, i + 4).join("\n");
      const negEntry = recordNegativeLesson(store, {
        project: options.project,
        title,
        failed_approach: line,
        failure_reason: contextLines,
        alternative_recommended: "Refer to project standards in AGENTS.md",
        source: options.actor ?? "session_harvester",
        confirmed: true,
      });

      harvested.push({
        id: negEntry.id,
        type: "negative",
        title: negEntry.title,
        content: negEntry.content,
        source: "harvester",
      });
      continue;
    }

    // 2. Architectural Decision Extraction
    if (
      lower.startsWith("decision:") ||
      lower.startsWith("architecture decision:") ||
      lower.startsWith("decided to") ||
      lower.includes("chose ") && lower.includes(" over ")
    ) {
      const title = line.replace(/^(decision:|architecture decision:)/i, "").trim().slice(0, 100);
      const contextLines = lines.slice(i, i + 3).join("\n");
      const entry = propose(store, {
        title,
        content: contextLines,
        project: options.project,
        type: "decision",
        source: options.actor ?? "session_harvester",
        confirmed: true,
        tags: ["architecture", "decision", "auto-harvested"],
      });

      harvested.push({
        id: entry.id,
        type: "decision",
        title: entry.title,
        content: entry.content,
        source: "harvester",
      });
      continue;
    }

    // 3. Invariant / Constraint Extraction
    if (
      lower.startsWith("invariant:") ||
      lower.startsWith("constraint:") ||
      lower.startsWith("must always") ||
      lower.startsWith("never ")
    ) {
      const title = line.replace(/^(invariant:|constraint:)/i, "").trim().slice(0, 100);
      const entry = propose(store, {
        title,
        content: line,
        project: options.project,
        type: "constraint",
        temporal_mode: "timeless",
        source: options.actor ?? "session_harvester",
        confirmed: true,
        tags: ["constraint", "invariant", "auto-harvested"],
      });

      harvested.push({
        id: entry.id,
        type: "constraint",
        title: entry.title,
        content: entry.content,
        source: "harvester",
      });
      continue;
    }

    // 4. Bug Fix Extraction
    if (
      lower.startsWith("fix:") ||
      lower.startsWith("resolved:") ||
      (lower.includes("fixed") && lower.includes(" by "))
    ) {
      const title = line.replace(/^(fix:|resolved:)/i, "").trim().slice(0, 100);
      const contextLines = lines.slice(i, i + 3).join("\n");
      const entry = propose(store, {
        title,
        content: contextLines,
        project: options.project,
        type: "fix",
        source: options.actor ?? "session_harvester",
        confirmed: true,
        tags: ["bugfix", "fix", "auto-harvested"],
      });

      harvested.push({
        id: entry.id,
        type: "fix",
        title: entry.title,
        content: entry.content,
        source: "harvester",
      });
      continue;
    }
  }

  return harvested;
}
