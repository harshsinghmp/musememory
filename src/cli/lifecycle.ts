import { writeFileSync, readFileSync, existsSync } from "node:fs";
import {
  list,
  propose,
  confirm,
  supersede,
  link,
  markStale,
  reject,
  deleteEntry,
} from "../store.ts";
import { stalePolicyDays } from "../retrieval.ts";
import { consolidateScenes } from "../consolidate.ts";
import { traceGraph, renderTrace } from "../trace.ts";
import { collectLoops, renderLoops } from "../loops.ts";
import { collectNudges, renderNudges, dueEntries } from "../nudge.ts";
import { loadRoutines, runRoutine, crontabLine, type Routine } from "../routines.ts";
import { distillSkills } from "../distill.ts";
import { verifyEntry } from "../verify.ts";
import { validateStore } from "../schema.ts";
import { exportSnapshot, importSnapshot } from "../snapshot.ts";
import { getAuditTrail } from "../audit.ts";
import { recordSessionStart, recordSessionEnd, findSession } from "../sessions.ts";
import type { MemoryType } from "../types.ts";
import { requireRoot, printEntry, usageError, fail, type ParsedArgs } from "./shared.ts";

export async function handleProposeCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const text = positional[0];
  if (!text) return usageError("propose requires text");
  const project = flags["project"];
  if (!project) return usageError("propose requires --project");
  const tags = flags["tags"] ? flags["tags"].split(",").map((t) => t.trim()).filter(Boolean) : undefined;
  const type = flags["type"] as MemoryType | undefined;
  let entry;
  try {
    entry = propose(ctx.store, {
      content: text,
      project,
      title: flags["title"],
      tags,
      type,
      confirmed: flags["confirmed"] === "true",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(msg.replace(/^Probable secret detected:/, "probable secret detected:"));
  }
  console.log(`created ${entry.id}`);
  return 0;
}

export async function handleCaptureCommand(args: ParsedArgs): Promise<number> {
  return handleProposeCommand(args);
}

export async function handleLinkCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const id = positional[0];
  const related = flags["related"];
  if (!id || !related) return usageError("link requires <id> --related <id,...>");
  const relatedIds = related.split(",").map((s) => s.trim()).filter(Boolean);
  const entry = link(ctx.store, id, relatedIds);
  if (!entry) {
    return fail(`could not link ${id} (missing id or related id)`);
  }
  console.log(`linked ${id} -> ${relatedIds.join(",")}`);
  return 0;
}

export async function handleConfirmCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const id = positional[0];
  if (!id) return usageError("confirm requires an id");
  const entry = confirm(ctx.store, id);
  if (!entry) {
    return fail(`could not confirm ${id} (not found or invalid status transition)`);
  }
  console.log(`confirmed ${entry.id} -> confirmed`);
  return 0;
}

export async function handleSupersedeCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const oldId = positional[0];
  const newId = flags["with"];
  if (!oldId || !newId) return usageError("supersede requires <id> --with <newId>");
  const entry = supersede(ctx.store, oldId, newId);
  if (!entry) {
    return fail(`could not supersede ${oldId} with ${newId} (missing entry or target not confirmed)`);
  }
  console.log(`superseded ${oldId} by ${newId}`);
  return 0;
}

export async function handleMarkStaleCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const id = positional[0];
  if (!id) return usageError("mark-stale requires an id");
  const entry = markStale(ctx.store, id, flags["reason"]);
  if (!entry) {
    return fail(`no entry with id ${id}`);
  }
  console.log(`marked ${entry.id} stale`);
  return 0;
}

export async function handleRejectCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const id = positional[0];
  if (!id) return usageError("reject requires an id");
  const entry = reject(ctx.store, id);
  if (!entry) {
    return fail(`no entry with id ${id}`);
  }
  console.log(`rejected ${entry.id}`);
  return 0;
}

export async function handleDeleteCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const id = positional[0];
  if (!id) return usageError("delete requires <id>");
  const ok = deleteEntry(ctx.store, id, flags["reason"], "cli_user");
  if (!ok) {
    return fail(`no entry found with id ${id}`);
  }
  console.log(`deleted entry ${id}`);
  return 0;
}

export async function handleAuditCommand({ flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const limit = flags["limit"] ? parseInt(flags["limit"], 10) : 50;
  const trail = getAuditTrail(ctx.memoryDir, {
    operation: flags["operation"],
    entryId: flags["entry-id"],
    limit,
  });
  if (trail.length === 0) {
    console.log("no audit records found");
    return 0;
  }
  console.log(`[AUDIT] Audit Trail (${trail.length} records):`);
  for (const r of trail) {
    const details = r.details ? ` ${JSON.stringify(r.details)}` : "";
    const reason = r.reason ? ` reason="${r.reason}"` : "";
    console.log(`- [${r.timestamp}] ${r.operation.toUpperCase()} id=${r.entry_id} actor=${r.actor ?? "unknown"}${reason}${details}`);
  }
  return 0;
}

export async function handleExportCommand({ flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const snapshot = exportSnapshot(ctx.store);
  const outPath = flags["out"];
  if (outPath) {
    writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
    console.log(`exported ${snapshot.total} memories to ${outPath}`);
  } else {
    console.log(JSON.stringify(snapshot, null, 2));
  }
  return 0;
}

export async function handleImportCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const file = positional[0];
  if (!file) return usageError("import requires <file.json>");
  if (!existsSync(file)) return fail(`error: file ${file} does not exist`);
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const res = importSnapshot(ctx.store, raw, { overwrite: flags["overwrite"] === "true" });
  if (res.errors.length > 0) {
    console.error(`import encountered errors:`);
    for (const err of res.errors) console.error(`  ${err}`);
  }
  console.log(`imported ${res.imported} memories (${res.skipped} skipped)`);
  return res.errors.length > 0 ? 1 : 0;
}

export async function handleValidateCommand({ flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const isDryRun = flags["dry-run"] === "true";
  const report = validateStore(ctx.store);

  if (isDryRun) {
    console.log(`[dry-run] validation report:`);
  }

  if (report.schemaErrors.length > 0) {
    for (const err of report.schemaErrors) {
      console.error(`schema violation in ${err.id}:`);
      for (const msg of err.errors) console.error(`  ${msg}`);
    }
  }

  if (report.secretErrors.length > 0) {
    for (const sec of report.secretErrors) {
      console.error(`probable secret in ${sec.id}: ${sec.secrets.join(", ")}`);
    }
  }

  if (report.brokenLinks.length > 0) {
    for (const bl of report.brokenLinks) {
      console.error(`broken link in ${bl.id}.${bl.field} -> ${bl.targetId} (target does not exist)`);
    }
  }

  if (report.integrityErrors.length > 0) {
    for (const ie of report.integrityErrors) {
      console.error(`integrity error in ${ie.id}: ${ie.message}`);
    }
  }

  if (report.staleWarnings.length > 0) {
    for (const sw of report.staleWarnings) {
      console.warn(`warning: ${sw.id} (${sw.type ?? "default"}) is stale (${sw.ageDays}d > ${sw.policyDays}d policy)`);
    }
  }

  if (!report.isValid) {
    return fail(`validation failed: ${report.total - report.validCount}/${report.total} entries have errors`);
  }

  console.log(`ok: ${report.total} entries valid`);
  return 0;
}

export async function handleBriefingCommand({ flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const limit = parseInt(flags["limit"] ?? "5", 10) || 5;
  const entries = list(ctx.store);
  const counts: Record<string, number> = {};
  for (const e of entries) counts[e.status] = (counts[e.status] ?? 0) + 1;
  const recent = entries
    .filter((e) => e.status === "active" || e.status === "confirmed")
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .slice(0, limit);
  console.log(`memory briefing (${ctx.memoryDir})`);
  console.log(`counts: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  for (const e of recent) printEntry(e);
  const now = Date.now();
  const staleByPolicy = entries.filter((e) => {
    if (e.status !== "active" && e.status !== "confirmed") return false;
    const policy = stalePolicyDays(e.type);
    if (policy === null) return false;
    const t = Date.parse(e.updated_at);
    return !Number.isNaN(t) && (now - t) / 86_400_000 > policy;
  });
  if (staleByPolicy.length > 0) {
    console.log(`stale by policy:`);
    for (const e of staleByPolicy) printEntry(e, true);
  }
  const due = dueEntries(entries);
  if (due.length > 0) {
    console.log(`due / overdue:`);
    for (const e of due) {
      const days = Math.ceil((Date.parse(e.due_at!) - Date.now()) / 86_400_000);
      const when = days < 0 ? `OVERDUE ${-days}d` : `due in ${days}d`;
      console.log(`- ${e.id} [${e.status}] ${when} — ${e.title}`);
    }
  }
  return 0;
}

export async function handleListCommand({ flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  let entries = list(ctx.store);
  if (flags["status"]) entries = entries.filter((e) => e.status === flags["status"]);
  if (flags["type"]) entries = entries.filter((e) => e.type === flags["type"]);
  if (flags["project"]) entries = entries.filter((e) => e.project === flags["project"]);

  if (entries.length === 0) {
    console.log(`no memories found in ${ctx.memoryDir}`);
    return 0;
  }

  console.log(`memories (${entries.length}) in ${ctx.memoryDir}:`);
  for (const e of entries) {
    printEntry(e);
  }
  return 0;
}

export async function handleStatsCommand({ flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const entries = list(ctx.store);
  const counts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};
  for (const e of entries) {
    counts[e.status] = (counts[e.status] ?? 0) + 1;
    if (e.type) typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
  }
  console.log(`\n====================================================`);
  console.log(`Muse Memory Statistics (${ctx.memoryDir})`);
  console.log(`====================================================`);
  console.log(`Total Memories: ${entries.length}`);
  console.log(`Status Breakdown:`);
  for (const [status, count] of Object.entries(counts)) {
    console.log(`  - ${status}: ${count}`);
  }
  if (Object.keys(typeCounts).length > 0) {
    console.log(`Type Breakdown:`);
    for (const [type, count] of Object.entries(typeCounts)) {
      console.log(`  - ${type}: ${count}`);
    }
  }
  return 0;
}

export async function handleStaleCommand({ flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const daysOverride = flags["days"] ? parseInt(flags["days"], 10) : null;
  const now = Date.now();
  const stale = list(ctx.store).filter((e) => {
    if (e.status !== "active" && e.status !== "confirmed") return false;
    const policy = stalePolicyDays(e.type);
    if (policy === null) return false;
    const days = daysOverride ?? policy;
    const t = Date.parse(e.updated_at);
    return !Number.isNaN(t) && (now - t) / 86_400_000 > days;
  });
  for (const e of stale) printEntry(e);
  console.log(`stale: ${stale.length} active entries not updated in ${daysOverride ?? "policy"} days`);
  return 0;
}

export async function handleConsolidateCommand({ flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const report = consolidateScenes(ctx.store, {
    project: flags["project"],
    dryRun: flags["dry-run"] === "true",
  });
  if (report.scenesCreated.length === 0 && report.skippedClusters.length === 0) {
    console.log("No scene-worthy clusters found.");
    return 0;
  }
  for (const s of report.scenesCreated) {
    const id = s.id ? ` (${s.id})` : "";
    console.log(`[scene]${id} ${s.title} <- ${s.members.join(", ")}`);
  }
  for (const sk of report.skippedClusters) {
    console.log(`[skip] ${sk.reason}: ${sk.members.join(", ")}`);
  }
  return 0;
}

export async function handleTraceCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const id = positional[0];
  if (!id) return usageError("trace requires <id>");
  const depth = parseInt(flags["depth"] ?? "5", 10) || 5;
  const node = traceGraph(ctx.store, id, depth);
  if (!node) return fail(`error: no entry with id ${id}`);
  for (const line of renderTrace(node)) console.log(line);
  return 0;
}

export async function handleLoopsCommand({ flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const report = collectLoops(ctx.store, ctx.root, ctx.memoryDir);
  for (const line of renderLoops(report)) console.log(line);
  return 0;
}

export async function handleNudgeCommand({ flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const report = collectNudges(ctx.store, ctx.root, ctx.memoryDir);
  for (const line of renderNudges(report)) console.log(line);
  // Exit code reflects nudge count (capped at 125 to stay a valid POSIX status).
  return Math.min(report.items.length, 125);
}

export async function handleRoutineCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const sub = positional[0] ?? "";
  if (sub === "run") {
    const name = positional[1];
    if (!name) return usageError("usage: memory routine run <name>");
    try {
      return await runRoutine(ctx.memoryDir, name);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }
  if (sub === "install") {
    let routines: Record<string, Routine>;
    try {
      routines = loadRoutines(ctx.memoryDir).routines;
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
    const names = positional[1] ? [positional[1]] : Object.keys(routines);
    if (names.length === 0) {
      console.log("No routines defined. Create .memory/routines.yaml:");
      console.log('  routines:\n    morning:\n      schedule: "0 8 * * *"\n      run: ["brief", "nudge"]');
      return 0;
    }
    console.log("# Add these lines to your crontab (crontab -e):");
    for (const n of names) {
      const r = routines[n];
      if (!r) return fail(`unknown routine: ${n}`);
      console.log(crontabLine(n, r));
    }
    return 0;
  }
  return usageError("usage: memory routine run <name> | memory routine install [name]");
}

export async function handleDistillCommand({ flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const minCount = flags["min-count"] ? parseInt(flags["min-count"], 10) : undefined;
  try {
    const report = distillSkills(ctx.store, ctx.root, {
      minCount,
      dryRun: flags["dry-run"] === "true",
    });
    for (const c of report.created) {
      console.log(`[skill] ${c.slug} (${c.path}) <- ${c.members.join(", ")}`);
    }
    for (const s of report.skippedExisting) {
      console.log(`[skip] skill '${s.slug}' already exists: ${s.members.join(", ")}`);
    }
    if (report.clustersBelowThreshold > 0) {
      console.log(`[info] ${report.clustersBelowThreshold} cluster(s) below --min-count`);
    }
    if (report.created.length === 0 && report.skippedExisting.length === 0) {
      console.log("No recurring fix patterns found.");
    }
    return 0;
  } catch (err: unknown) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export async function handleVerifyCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const id = positional[0];
  if (!id) return usageError("verify requires <id>");
  const timeout = flags["timeout"] ? parseInt(flags["timeout"], 10) : undefined;
  const result = await verifyEntry(ctx.store, ctx.root, ctx.memoryDir, id, { timeout });
  if (result.stdout?.trim()) console.log(result.stdout.trim());
  if (result.stderr?.trim()) console.error(result.stderr.trim());
  console.log(`${result.ok ? "[pass]" : "[fail]"} ${result.message}`);
  return result.ok ? 0 : 1;
}

export async function handleSessionCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const sub = positional[0];
  if (sub === "start") {
    const project = flags["project"];
    if (!project) return usageError("session start requires --project");
    const { entry, sessionId } = recordSessionStart(ctx.store, project, flags["note"]);
    console.log(`session ${sessionId} started (${entry.id})`);
    return 0;
  }
  if (sub === "end") {
    const id = positional[1];
    if (!id) return usageError("session end requires <id>");
    const start = findSession(ctx.store, id);
    if (!start) return fail(`error: no session start with id ${id}`);
    const entry = recordSessionEnd(ctx.store, id, start.project);
    console.log(`session ${id} ended (${entry?.id})`);
    return 0;
  }
  return usageError("session requires start|end");
}
