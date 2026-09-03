import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "../store.ts";
import { list } from "../store.ts";
import { rankAndRetrieveMemories } from "../retrieval/ranking.ts";
import { parseCurrentFile } from "../governor.ts";
import type { MemoryEntry, CodeAnchor } from "../types.ts";
import type { MuseContextInput, FusedContextResult } from "./types.ts";

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function estimateEntryTokens(entry: MemoryEntry): number {
  return estimateTokens(`${entry.title}\n${entry.content}\n${entry.tags?.join(" ")}`);
}

/**
 * Flagship unified context orchestrator.
 * Fuses active constraints, ranked memories, code anchors, and negative lessons
 * into a single token-budgeted response with suggested next actions.
 */
export async function resolveMuseContext(
  store: Store,
  workspaceRoot: string,
  input: MuseContextInput
): Promise<FusedContextResult> {
  const budget = input.token_budget ?? 4000;
  let remainingBudget = budget;
  let usedBudget = 0;

  // 1. Build composite search query
  const queryParts: string[] = [];
  if (input.query) queryParts.push(input.query);
  if (input.symbol) queryParts.push(input.symbol);
  if (input.active_file) queryParts.push(input.active_file);
  if (input.error_message) queryParts.push(input.error_message);
  if (input.task_intent) queryParts.push(input.task_intent);

  const compositeQuery = queryParts.join(" ") || "active constraints and architecture";

  // 2. Active Constraints & CURRENT.md
  const activeConstraints: Array<{ id: string; title: string; content: string }> = [];
  
  // Try loading CURRENT.md constraints & concurrent workstreams
  if (store.memoryDir) {
    try {
      const currentData = parseCurrentFile(store.memoryDir);
      if (currentData.constraints.length > 0) {
        activeConstraints.push({
          id: "current_md_constraints",
          title: "Session Working Constraints",
          content: currentData.constraints.join("\n"),
        });
      }
      if (currentData.workstreams && currentData.workstreams.length > 0) {
        const activeWs = currentData.workstreams.filter((w) => w.status === "IN-PROGRESS" || w.status === "BLOCKED");
        if (activeWs.length > 0) {
          const wsSummary = activeWs
            .map((w) => `- Agent \`${w.agent}\` [${w.status}]: ${w.task}${w.targetScope ? ` (Scope: ${w.targetScope})` : ""}`)
            .join("\n");
          activeConstraints.push({
            id: "concurrent_workstreams",
            title: "Active Concurrent Agent Workstreams",
            content: wsSummary,
          });
        }
      }
    } catch {}
  }

  // Also query store for timeless or active constraints
  const allEntries = list(store);
  const constraintEntries = allEntries.filter(
    (e) =>
      (e.type === "constraint" || e.temporal_mode === "timeless") &&
      e.status !== "archived" &&
      e.status !== "superseded" &&
      e.status !== "rejected"
  );

  for (const ce of constraintEntries) {
    if (activeConstraints.length >= 5) break;
    activeConstraints.push({
      id: ce.id,
      title: ce.title,
      content: ce.content,
    });
  }

  // Deduct constraint tokens
  for (const c of activeConstraints) {
    const cost = estimateTokens(`${c.title}\n${c.content}`);
    if (cost <= remainingBudget) {
      usedBudget += cost;
      remainingBudget -= cost;
    }
  }

  // 3. Find matching code anchors in the store
  const matchedAnchors: CodeAnchor[] = [];
  const entriesWithMatchingAnchors: MemoryEntry[] = [];

  if (input.active_file || input.symbol) {
    for (const e of allEntries) {
      if (!e.anchors || e.anchors.length === 0) continue;
      if (e.status === "archived" || e.status === "superseded") continue;

      for (const anc of e.anchors) {
        let fileMatch = false;
        let symbolMatch = false;

        if (input.active_file && anc.file_path) {
          fileMatch =
            input.active_file.includes(anc.file_path) ||
            anc.file_path.includes(input.active_file);
        }
        if (input.symbol && anc.symbol_name) {
          symbolMatch =
            anc.symbol_name.toLowerCase() === input.symbol.toLowerCase();
        }

        if (fileMatch || symbolMatch) {
          matchedAnchors.push(anc);
          if (!entriesWithMatchingAnchors.some((m) => m.id === e.id)) {
            entriesWithMatchingAnchors.push(e);
          }
        }
      }
    }
  }

  // 4. Retrieve ranked memories via multi-factor ranking engine
  const ranked = await rankAndRetrieveMemories(store, compositeQuery, {
    project: input.project,
    activeFilePath: input.active_file,
    targetSymbol: input.symbol,
    limit: 15,
  });

  // Merge anchored memories to front of candidate pool
  const candidatePool: MemoryEntry[] = [...entriesWithMatchingAnchors];
  for (const r of ranked) {
    if (!candidatePool.some((c) => c.id === r.entry.id)) {
      candidatePool.push(r.entry);
    }
  }

  // 5. Separate negative lessons & anti-patterns
  const negativeLessons: MemoryEntry[] = [];
  const relevantMemories: MemoryEntry[] = [];

  for (const entry of candidatePool) {
    if (
      entry.negative != null ||
      entry.tags?.some((t) => t.includes("anti-pattern") || t.includes("bug") || t.includes("negative"))
    ) {
      negativeLessons.push(entry);
    } else {
      relevantMemories.push(entry);
    }
  }

  // 6. Token-budget knapsack packing
  const packedNegative: MemoryEntry[] = [];
  const packedMemories: MemoryEntry[] = [];

  // Pack negative lessons first (defensive guardrails)
  for (const neg of negativeLessons) {
    const cost = estimateEntryTokens(neg);
    if (cost <= remainingBudget) {
      packedNegative.push(neg);
      usedBudget += cost;
      remainingBudget -= cost;
    }
  }

  // Pack relevant memories
  for (const mem of relevantMemories) {
    const cost = estimateEntryTokens(mem);
    if (cost <= remainingBudget) {
      packedMemories.push(mem);
      usedBudget += cost;
      remainingBudget -= cost;
    }
  }

  // 7. Generate actionable suggested next steps
  const suggestedNextSteps: string[] = [];

  if (packedNegative.length > 0) {
    suggestedNextSteps.push(
      `Avoid known anti-pattern: ${packedNegative[0].title} (${packedNegative[0].content.slice(0, 60)}...)`
    );
  }

  if (matchedAnchors.length > 0) {
    const firstAnc = matchedAnchors[0];
    suggestedNextSteps.push(
      `Inspect anchored code symbol: ${firstAnc.file_path}${firstAnc.symbol_name ? `#${firstAnc.symbol_name}` : ""}`
    );
  }

  if (activeConstraints.length > 0) {
    suggestedNextSteps.push(
      `Respect invariant: ${activeConstraints[0].title}`
    );
  }

  if (input.error_message) {
    suggestedNextSteps.push("Verify error resolution against previous bug fixes in relevant memories");
  }

  if (suggestedNextSteps.length === 0) {
    suggestedNextSteps.push("Proceed with planned task implementation and record decisions via memory_capture");
  }

  return {
    active_constraints: activeConstraints,
    relevant_memories: packedMemories,
    negative_lessons: packedNegative,
    code_anchors: matchedAnchors,
    tokens_used: usedBudget,
    token_budget: budget,
    suggested_next_steps: suggestedNextSteps,
  };
}
