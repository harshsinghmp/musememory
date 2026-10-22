import { existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CompactionInvariants,
  CompactionEvaluation,
  HandoffResult,
  HandoffOptions,
  HarvestedMemory,
} from "./types.ts";
import { recordAuditEvent } from "../audit.ts";
import type { Store } from "../store.ts";
import { propose } from "../store.ts";
import { verifyMutationSafety } from "../quality/guards.ts";
import { captureSnapshotRing } from "../snapshot.ts";

export const DEFAULT_CONTEXT_MAX_TOKENS = 200_000;
export const COMPACTION_THRESHOLD_PERCENT = 70;

/**
 * Validates that compaction invariants conform to the never-empty contract.
 * Checkpoints must never be partial or empty.
 */
export function validateCompactionInvariants(invariants: CompactionInvariants): void {
  if (!invariants.highLevelGoal || !invariants.highLevelGoal.trim()) {
    throw new Error(
      "Cannot generate handoff: Compaction checkpoint violation: highLevelGoal must not be empty. Checkpoints must never be partial or empty.",
    );
  }
  if (!invariants.currentArchitecture || !invariants.currentArchitecture.trim()) {
    throw new Error(
      "Cannot generate handoff: Compaction checkpoint violation: currentArchitecture must not be empty. Checkpoints must never be partial or empty.",
    );
  }
  if (!invariants.nextConcreteTask || !invariants.nextConcreteTask.trim()) {
    throw new Error(
      "Cannot generate handoff: Compaction checkpoint violation: nextConcreteTask must not be empty. Checkpoints must never be partial or empty.",
    );
  }
  const completedCount = invariants.completedTasks?.length ?? 0;
  const openCount = invariants.openTasks?.length ?? 0;
  if (completedCount + openCount === 0) {
    throw new Error(
      "Cannot generate handoff: Compaction checkpoint violation: task list must contain at least one completed or open task. Checkpoints must never be partial or empty.",
    );
  }
}

import { isFactDigestRecorded, recordFactDigest } from "./dedup.ts";

/**
 * Extracts durable architectural decisions and active constraints into memory entries
 * before context compression or session handoff.
 */
export function extractInvariantsPreCompress(
  invariants: CompactionInvariants,
  store: Store,
  options?: { project?: string; actor?: string },
): HarvestedMemory[] {
  const project = options?.project ?? "workspace";
  const actor = options?.actor ?? "compaction_pre_compress";
  const memoryDir = store.memoryDir || store.dir;
  const harvested: HarvestedMemory[] = [];

  if (invariants.decisionsMade && invariants.decisionsMade.length > 0) {
    for (const d of invariants.decisionsMade) {
      if (!d.trim()) continue;
      if (isFactDigestRecorded(memoryDir, d)) continue;

      const title = d.slice(0, 100);
      const entry = propose(store, {
        title,
        content: d,
        project,
        type: "decision",
        source: actor,
        confirmed: true,
        tags: ["architecture", "decision", "pre-compress"],
      });
      recordFactDigest(memoryDir, d, entry.id, "decision");

      harvested.push({
        id: entry.id,
        type: "decision",
        title: entry.title,
        content: entry.content,
        source: actor,
      });
    }
  }

  if (invariants.activeConstraints && invariants.activeConstraints.length > 0) {
    for (const c of invariants.activeConstraints) {
      if (!c.trim()) continue;
      if (isFactDigestRecorded(memoryDir, c)) continue;

      const title = c.slice(0, 100);
      const entry = propose(store, {
        title,
        content: c,
        project,
        type: "constraint",
        temporal_mode: "timeless",
        source: actor,
        confirmed: true,
        tags: ["constraint", "invariant", "pre-compress"],
      });
      recordFactDigest(memoryDir, c, entry.id, "constraint");

      harvested.push({
        id: entry.id,
        type: "constraint",
        title: entry.title,
        content: entry.content,
        source: actor,
      });
    }
  }

  return harvested;
}

/**
 * Evaluates current context usage against the 70% threshold invariant.
 */
export function evaluateContextUsage(
  usedTokens: number,
  maxTokens: number = DEFAULT_CONTEXT_MAX_TOKENS,
): CompactionEvaluation {
  const usagePercent = Math.round((usedTokens / maxTokens) * 100);
  const thresholdExceeded = usagePercent >= COMPACTION_THRESHOLD_PERCENT;

  const prompt = thresholdExceeded
    ? `Context at ${usagePercent}%. Compact now or continue?`
    : `Context at ${usagePercent}% used.`;

  return {
    usedTokens,
    maxTokens,
    usagePercent,
    thresholdExceeded,
    prompt,
  };
}

/**
 * Renders the 5 mandatory compaction invariants into canonical CURRENT.md format.
 */
export function renderCurrentMdContent(
  invariants: CompactionInvariants,
  options?: { agent?: string; sessionId?: string; project?: string },
): string {
  const timestamp = new Date().toISOString();
  const agent = options?.agent ?? "Muse";
  const lines: string[] = [
    "# 📍 Active Workspace Context & Invariants (CURRENT.md)",
    "",
    "> Auto-generated by MuseMemory Context Compaction & Session Handoff Engine",
    `> **Last Updated**: ${timestamp} | **Agent**: ${agent}`,
    "",
    "---",
    "",
    "## 🔒 1. Active Working Constraints & Invariants",
  ];

  const constraints = invariants.activeConstraints && invariants.activeConstraints.length > 0
    ? invariants.activeConstraints
    : ["Zero unmasked credentials committed (Vibeguard Protocol).", "Fail fast with explicit errors rather than swallowing failures."];

  for (const c of constraints) {
    lines.push(`- ${c}`);
  }

  lines.push("");
  lines.push("## 🎯 2. High-Level Goal");
  lines.push(invariants.highLevelGoal.trim());
  lines.push("");

  lines.push("## 🏗️ 3. Current Architecture & Data Flow");
  lines.push(invariants.currentArchitecture.trim());
  lines.push("");

  lines.push("## ✅ 4. Implemented & Done");
  if (invariants.completedTasks.length > 0) {
    for (const task of invariants.completedTasks) {
      lines.push(`- [x] ${task}`);
    }
  } else {
    lines.push("- None recorded yet.");
  }
  lines.push("");

  lines.push("## ⏳ 5. Explicitly Not Done Yet");
  if (invariants.openTasks.length > 0) {
    for (const task of invariants.openTasks) {
      lines.push(`- [ ] ${task}`);
    }
  } else {
    lines.push("- All planned tasks completed.");
  }
  lines.push("");

  lines.push("## 🚀 6. Next Concrete Task");
  lines.push(`> **Next Up**: ${invariants.nextConcreteTask.trim()}`);
  lines.push("");

  if (invariants.decisionsMade && invariants.decisionsMade.length > 0) {
    lines.push("## 💡 7. Key Decisions & Discoveries");
    for (const d of invariants.decisionsMade) {
      lines.push(`- ${d}`);
    }
    lines.push("");
  }

  lines.push("## 📜 8. Interruption-Proof Checkpoint & Session Handoff");
  lines.push(`- **Status**: IN-PROGRESS`);
  lines.push(`- **Timestamp**: ${timestamp}`);
  if (options?.sessionId) lines.push(`- **Session ID**: ${options.sessionId}`);
  lines.push(`- **Handoff Directive**: Next session starts by executing: "${invariants.nextConcreteTask.trim()}"`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Generates an ultra-compact resumption prompt injection string for the subsequent session.
 */
export function generateResumptionPrompt(invariants: CompactionInvariants): string {
  const parts: string[] = [
    `[SESSION HANDOFF RESUMPTION]`,
    `Goal: ${invariants.highLevelGoal}`,
    `Next Task: ${invariants.nextConcreteTask}`,
    `Completed: ${invariants.completedTasks.length} items | Pending: ${invariants.openTasks.length} items`,
  ];
  if (invariants.openTasks.length > 0) {
    parts.push(`Open: ${invariants.openTasks.slice(0, 3).join("; ")}`);
  }
  return parts.join("\n");
}

/**
 * Parses active working constraints from an existing CURRENT.md markdown string.
 */
export function parseCurrentConstraints(content: string): string[] {
  if (!content) return [];
  const lines = content.split("\n");
  const constraints: string[] = [];
  let inConstraintsSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ") || trimmed.startsWith("# ")) {
      if (
        trimmed.toLowerCase().includes("active working constraints") ||
        trimmed.toLowerCase().includes("active constraints")
      ) {
        inConstraintsSection = true;
        continue;
      } else if (inConstraintsSection) {
        break;
      }
    }

    if (inConstraintsSection) {
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        const raw = trimmed.replace(/^[-*]\s+(\[[ xX]\]\s+)?/, "").trim();
        if (raw && !raw.toLowerCase().startsWith("none recorded")) {
          constraints.push(raw);
        }
      }
    }
  }

  return constraints;
}

/**
 * Merges proposed constraints with existing constraints, preserving hand-added rules.
 * Applies in-lock mutation safety validation.
 */
export function mergeCurrentConstraints(
  existingText: string,
  proposed: string[],
  options?: { allowDrastic?: boolean },
): string[] {
  const existing = parseCurrentConstraints(existingText);
  const seen = new Set<string>();
  const merged: string[] = [];

  // Add existing constraints first
  for (const c of existing) {
    const key = c.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(c);
    }
  }

  // Count additions from proposed
  let additionsCount = 0;
  for (const p of proposed) {
    const key = p.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(p);
      additionsCount++;
    }
  }

  // Verify mutation safety
  verifyMutationSafety(existing.length, merged.length, additionsCount, options);

  return merged;
}

function commitHandoff(
  memoryDir: string,
  invariants: CompactionInvariants,
  options?: HandoffOptions,
): HandoffResult {
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }

  const currentMdPath = join(memoryDir, "CURRENT.md");
  let effectiveConstraints = invariants.activeConstraints ?? [];

  if (existsSync(currentMdPath)) {
    try {
      captureSnapshotRing("current", memoryDir, 30);
    } catch {
      // ignore snapshot failure in edge environments
    }
    try {
      const existingText = readFileSync(currentMdPath, "utf8");
      effectiveConstraints = mergeCurrentConstraints(
        existingText,
        effectiveConstraints,
        { allowDrastic: (options as any)?.allowDrastic },
      );
    } catch (err) {
      throw err;
    }
  }

  const invariantsWithMerged: CompactionInvariants = {
    ...invariants,
    activeConstraints: effectiveConstraints,
  };

  const markdownContent = renderCurrentMdContent(invariantsWithMerged, options);
  writeFileSync(currentMdPath, markdownContent, "utf8");

  recordAuditEvent(memoryDir, {
    operation: "checkpoint",
    entry_id: "CURRENT.md",
    project: options?.project ?? "workspace",
    actor: options?.agent ?? "compaction_engine",
    details: {
      nextTask: invariants.nextConcreteTask,
      completedCount: invariants.completedTasks.length,
      openCount: invariants.openTasks.length,
    },
  });

  const resumptionPrompt = generateResumptionPrompt(invariants);

  return {
    currentMdPath,
    invariants,
    markdownContent,
    resumptionPrompt,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Commits an interruption-proof checkpoint handoff into CURRENT.md.
 * Triggers onPreCompress fact extraction if provided and validates all 5 core invariants.
 */
export function generateSessionHandoff(
  memoryDir: string,
  invariants: CompactionInvariants,
  options: HandoffOptions & { onPreCompress: (invariants: CompactionInvariants, store?: any) => Promise<any> },
): Promise<HandoffResult>;
export function generateSessionHandoff(
  memoryDir: string,
  invariants: CompactionInvariants,
  options?: HandoffOptions,
): HandoffResult;
export function generateSessionHandoff(
  memoryDir: string,
  invariants: CompactionInvariants,
  options?: HandoffOptions,
): HandoffResult | Promise<HandoffResult> {
  validateCompactionInvariants(invariants);

  if (options?.onPreCompress) {
    const hookResult = options.onPreCompress(invariants, options.store);
    if (hookResult instanceof Promise) {
      return hookResult.then(() => commitHandoff(memoryDir, invariants, options));
    }
  }

  return commitHandoff(memoryDir, invariants, options);
}
