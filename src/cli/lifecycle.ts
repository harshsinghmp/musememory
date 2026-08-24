import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { list } from "../store.ts";
import {
  proposeMemory,
  supersedeMemory,
  confirmMemory,
  linkMemory,
  markStaleMemory,
  rejectMemory,
  deleteMemory,
} from "../commands/lifecycle.ts";
import { stalePolicyDays } from "../retrieval.ts";
import { consolidateScenes } from "../consolidate.ts";
import { validateStore } from "../schema.ts";
import { exportSnapshot, importSnapshot } from "../snapshot.ts";
import { getAuditTrail } from "../audit.ts";
import { recordSessionStart, recordSessionEnd, findSession } from "../sessions.ts";
import type { MemoryType } from "../types.ts";
import { requireRoot, printEntry, type ParsedArgs } from "./shared.ts";

function usageError(msg: string): number {
  console.error(`Error: ${msg}`);
  return 2;
}

function fail(msg: string): number {
  console.error(`Error: ${msg}`);
  return 1;
}

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
    entry = proposeMemory(ctx.store, {
      content: text,
      project,
      title: flags["title"],
      tags,
      type,
      confirmed: flags["confirmed"] === "true",
    });
  } catch (err: unknown) {
    return fail(err instanceof Error ? err.message : String(err));
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
  try {
    linkMemory(ctx.store, id, relatedIds);
  } catch (err: unknown) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  console.log(`linked ${id} -> ${relatedIds.join(",")}`);
  return 0;
}

export async function handleConfirmCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const id = positional[0];
  if (!id) return usageError("confirm requires an id");
  let entry;
  try {
    entry = confirmMemory(ctx.store, id);
  } catch (err: unknown) {
    return fail(err instanceof Error ? err.message : String(err));
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
  try {
    supersedeMemory(ctx.store, { oldId, newId });
  } catch (err: unknown) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  console.log(`superseded ${oldId} by ${newId}`);
  return 0;
}

export async function handleMarkStaleCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const id = positional[0];
  if (!id) return usageError("mark-stale requires an id");
  let entry;
  try {
    entry = markStaleMemory(ctx.store, id, flags["reason"]);
  } catch (err: unknown) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  console.log(`marked ${entry.id} stale`);
  return 0;
}

export async function handleRejectCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const id = positional[0];
  if (!id) return usageError("reject requires an id");
  let entry;
  try {
    entry = rejectMemory(ctx.store, id);
  } catch (err: unknown) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  console.log(`rejected ${entry.id}`);
  return 0;
}

export async function handleDeleteCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const id = positional[0];
  if (!id) return usageError("delete requires <id>");
  try {
    deleteMemory(ctx.store, id, flags["reason"], "cli_user");
  } catch (err: unknown) {
    return fail(err instanceof Error ? err.message : String(err));
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
  const recurringDue = entries.filter((e) => {
    if (!e.recurring?.interval) return false;
    if (!e.recurring.next_due) return true;
    const t = Date.parse(e.recurring.next_due);
    return Number.isNaN(t) || t <= now;
  });
  if (recurringDue.length > 0) {
    console.log(`recurring due:`);
    for (const e of recurringDue) {
      console.log(`- ${e.id} [${e.status}] (${e.project}) ${e.title}`);
      console.log(`  recurring: ${e.recurring!.interval} next_due: ${e.recurring!.next_due ?? "due-now"}`);
    }
  }
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
    if (e.status !== "active") return false;
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
