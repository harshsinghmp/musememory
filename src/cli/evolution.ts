import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { requireRoot, usageError, type ParsedArgs } from "./shared.ts";
import { addSource, listSources, getSource, findSources } from "../provenance.ts";
import { recordClaim, listClaims, getClaim, findClaims, type ClaimConfidence } from "../claims.ts";
import { freezeExecutionSnapshot, loadExecutionSnapshot, listExecutionSnapshots } from "../snapshot.ts";
import { listPrompts, getPrompt, renderPrompt, savePrompt } from "../prompts.ts";
import { rollupTemporal, type RollupPeriod } from "../compounding/temporal.ts";
import { recordIteration, listIterations, detectIterationStatus, clearIterations, type CriticVerdict } from "../iterations.ts";

export async function handleSourceCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;

  const sub = positional[0] ?? "list";

  if (sub === "add") {
    const url = positional[1];
    if (!url) return usageError("source add requires <url>");
    const title = flags["title"] || positional[2] || url;
    try {
      const source = addSource(ctx.memoryDir, {
        url,
        title,
        source_type: flags["type"] || "documentation",
        excerpt: flags["excerpt"],
        author: flags["author"],
      });
      console.log(`Recorded source ${source.id}: "${source.title}" (${source.url})`);
      return 0;
    } catch (err: unknown) {
      console.error(`Error adding source: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  if (sub === "show" || sub === "get") {
    const id = positional[1];
    if (!id) return usageError("source show requires <id>");
    const source = getSource(ctx.memoryDir, id);
    if (!source) {
      console.error(`Source ${id} not found`);
      return 1;
    }
    console.log(JSON.stringify(source, null, 2));
    return 0;
  }

  // list or find
  const query = flags["query"] || (sub === "find" ? positional[1] : undefined);
  const sources = listSources(ctx.memoryDir, {
    source_type: flags["type"],
    query,
  });

  if (sources.length === 0) {
    console.log("*(No sources found)*");
    return 0;
  }

  console.log(`Found ${sources.length} source(s):`);
  for (const s of sources) {
    console.log(`- [${s.id}] (${s.source_type}) ${s.title} — ${s.url}`);
    if (s.excerpt) console.log(`  "${s.excerpt}"`);
  }
  return 0;
}

export async function handleClaimCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;

  const sub = positional[0] ?? "list";

  if (sub === "record" || sub === "add") {
    const claimText = positional.slice(1).join(" ") || flags["claim"];
    if (!claimText || !claimText.trim()) return usageError("claim record requires <claim text>");

    const sourceIds = flags["sources"] || flags["source_ids"]
      ? (flags["sources"] || flags["source_ids"]).split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    const memoryIds = flags["memories"] || flags["memory_ids"]
      ? (flags["memories"] || flags["memory_ids"]).split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    try {
      const claim = recordClaim(ctx.memoryDir, {
        claim: claimText.trim(),
        confidence_tag: (flags["confidence"] as ClaimConfidence) || "INFER",
        source_ids: sourceIds,
        memory_ids: memoryIds,
        notes: flags["notes"],
        verified: flags["verified"] === "true",
      });
      console.log(`Recorded claim ${claim.id} [${claim.confidence_tag}]: "${claim.claim}"`);
      return 0;
    } catch (err: unknown) {
      console.error(`Error recording claim: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  if (sub === "show" || sub === "get") {
    const id = positional[1];
    if (!id) return usageError("claim show requires <id>");
    const claim = getClaim(ctx.memoryDir, id);
    if (!claim) {
      console.error(`Claim ${id} not found`);
      return 1;
    }
    console.log(JSON.stringify(claim, null, 2));
    return 0;
  }

  // list / find
  const query = flags["query"] || (sub === "find" ? positional[1] : undefined);
  const claims = listClaims(ctx.memoryDir, {
    confidence_tag: flags["confidence"],
    query,
  });

  if (claims.length === 0) {
    console.log("*(No claims found)*");
    return 0;
  }

  console.log(`Found ${claims.length} claim(s):`);
  for (const c of claims) {
    const sources = c.source_ids && c.source_ids.length > 0 ? ` (sources: ${c.source_ids.join(", ")})` : "";
    console.log(`- [${c.id}] [${c.confidence_tag}] ${c.claim}${sources}`);
  }
  return 0;
}

export async function handleFreezeCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;

  const sub = positional[0];
  if (sub === "list") {
    const snapshots = listExecutionSnapshots(ctx.memoryDir);
    console.log(`Found ${snapshots.length} execution snapshot(s):`);
    for (const s of snapshots) {
      console.log(`- [${s.run_id}] (${s.timestamp}) ${s.task.slice(0, 60)}...`);
    }
    return 0;
  }

  if (sub === "show") {
    const runId = positional[1];
    if (!runId) return usageError("freeze show requires <run-id>");
    const snap = loadExecutionSnapshot(ctx.memoryDir, runId);
    if (!snap) {
      console.error(`Snapshot ${runId} not found`);
      return 1;
    }
    console.log(JSON.stringify(snap, null, 2));
    return 0;
  }

  const task = flags["task"] || positional.join(" ");
  if (!task || !task.trim()) {
    return usageError("freeze requires --task <task.md|text>");
  }

  const snap = freezeExecutionSnapshot({
    workspaceRoot: ctx.root,
    memoryDir: ctx.memoryDir,
    task: task.trim(),
    runId: flags["run-id"],
    store: ctx.store,
  });

  console.log(`Frozen execution snapshot [${snap.run_id}] with ${snap.memory_hashes.length} memories and ${snap.file_inventory.length} workspace files.`);
  return 0;
}

export async function handlePromptCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  const memoryDir = ctx?.memoryDir;
  const sub = positional[0] ?? "list";

  if (sub === "list") {
    const prompts = listPrompts(memoryDir);
    console.log(`Available Prompt Templates (${prompts.length}):`);
    for (const p of prompts) {
      console.log(`- **${p.name}**: ${p.title} — ${p.description}`);
    }
    return 0;
  }

  if (sub === "show") {
    const name = positional[1];
    if (!name) return usageError("prompt show requires <name>");
    const prompt = getPrompt(memoryDir, name);
    if (!prompt) {
      console.error(`Prompt template "${name}" not found`);
      return 1;
    }
    console.log(JSON.stringify(prompt, null, 2));
    return 0;
  }

  if (sub === "run") {
    const name = positional[1];
    if (!name) return usageError("prompt run requires <name>");
    const args: Record<string, string> = {};
    if (flags["args"]) {
      for (const pair of flags["args"].split(",")) {
        const [k, v] = pair.split("=");
        if (k && v) args[k.trim()] = v.trim();
      }
    }
    try {
      const rendered = renderPrompt(memoryDir, name, args);
      console.log(rendered);
      return 0;
    } catch (err: unknown) {
      console.error(`Error running prompt: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  return usageError("prompt command requires list|show|run");
}

export async function handleRollupCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;

  const period = (flags["period"] as RollupPeriod) || (positional[0] as RollupPeriod) || "week";
  if (period !== "week" && period !== "month" && period !== "quarter") {
    return usageError("--period must be week, month, or quarter");
  }

  try {
    const res = rollupTemporal(ctx.store, {
      memoryDir: ctx.memoryDir,
      period,
      date: flags["date"],
      project: flags["project"],
    });
    const periodLabel = period === "week" ? "weekly" : period === "month" ? "monthly" : "quarterly";
    console.log(`Compiled ${periodLabel} rollup (${res.periodKey}) to ${res.filePath} (${res.entriesCount} memories).`);
    return 0;
  } catch (err: unknown) {
    console.error(`Error during rollup: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

export async function handleLoopCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;

  const sub = positional[0] ?? "status";

  if (sub === "record" || sub === "add") {
    const index = parseInt(flags["index"] ?? positional[1] ?? "1", 10) || 1;
    const verdict = (flags["verdict"] as CriticVerdict) || "fail";
    const fix = flags["fix"] || positional.slice(2).join(" ") || "No description";
    const tests = flags["tests"] || "Unspecified";

    try {
      const entry = recordIteration(ctx.memoryDir, {
        iteration_index: index,
        critic_verdict: verdict,
        largest_fix_identified: fix,
        test_results: tests,
        diff_hash: flags["diff-hash"] || flags["diff_hash"],
      });
      console.log(`Recorded iteration #${entry.iteration_index} [${entry.critic_verdict}]: ${entry.largest_fix_identified}`);
      return 0;
    } catch (err: unknown) {
      console.error(`Error recording iteration: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  if (sub === "clear") {
    clearIterations(ctx.memoryDir);
    console.log("Cleared iteration ledger.");
    return 0;
  }

  // status
  const status = detectIterationStatus(ctx.memoryDir);
  console.log(`Iteration Loop Status:
- Total iterations: ${status.totalIterations}
- Last verdict: ${status.lastVerdict ?? "none"}
- Consecutive failures: ${status.consecutiveFailures}
- Plateau detected: ${status.isPlateaued ? "YES" : "No"}
- Regression detected: ${status.isRegressed ? "YES" : "No"}
- Recommendation: ${status.recommendation}`);
  return 0;
}
