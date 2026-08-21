import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { findOrCreateProjectRoot, getGlobalMemoryDir } from "./root.ts";
import { openStore, list, propose, confirm, supersede, markStale, reject, link, deleteEntry } from "./store.ts";
import { validateStore } from "./schema.ts";
import { search } from "./search.ts";
import { stalePolicyDays } from "./rank.ts";
import { getCurrent, setCurrent } from "./current.ts";
import { recordSessionStart, recordSessionEnd, findSession } from "./sessions.ts";
import { scanSecrets } from "./secrets.ts";
import { getGraphStatus } from "./graph.ts";
import { extractHarvestUnits, exportSnapshot, importSnapshot, importTranscript } from "./harvest.ts";
import { getAuditTrail } from "./audit.ts";
import { DEFAULT_CONTEXT_LIMIT, type MemoryEntry, type MemoryType } from "./types.ts";

export { scanSecrets };

const USAGE = `Muse Memory (musememory) — Autonomous persistent memory system for AI agents

Usage: memory <command> [args] [flags] (alias: musememory)

Global Flags:
  --global, -g                                  operate on global system memory store (~/.memory/)

Commands:
  init [path] [--legacy] [--global]             initialize .memory/ folder (or ~/.memory/)
  connect [agent] [--all] [--dry-run]           auto-wire MCP with zero-permission auto-approval (claude-code, cursor, antigravity, windsurf, codex, gemini-cli, all)
  ui [--port N]                                 launch zero-dependency visual graph dashboard
  context [query] [--limit N] [--token-budget N] [--project P] [--type T] [--status S] [--verified]   top-K active-ranked context
  search <query> [--limit N] [--token-budget N] [--include-superseded] [--type T] [--status S] [--verified]   ranked results with score/source/stale
  propose <text> --project P [--title T] [--tags a,b] [--type T] [--confirmed]  create candidate entry (confirmed with --confirmed)
  capture <text> --project P [--title T] [--tags a,b] [--type T] [--confirmed]  propose with inline secret scan
  harvest <text|file> --project P [--confirmed] distill outcomes/fixes into memory units
  import-transcript <file.jsonl> [--project P] [--confirmed] ingest JSONL transcript into memories (alias: import-jsonl)
  recall <query> [--limit N] [--token-budget N] [--project P] [--type T] [--status S] [--verified]  rich recall of ranked entries
  confirm <id>                                  candidate/disputed/stale -> confirmed
  supersede <id> --with <newId>                 mark old superseded, link new's supersedes
  mark-stale <id> [--reason <text>]             mark entry stale (appends reason)
  reject <id>                                   mark entry rejected
  delete <id> [--reason <text>]                 delete entry permanently and record audit log
  audit [--operation OP] [--entry-id ID] [--limit N] query append-only audit trail
  link <id> --related <id,...>                  two-way link related entries
  export [--out <file.json>]                    export memory snapshot for agency sharing
  import <file.json> [--overwrite]              import memory snapshot into local store
  validate [--dry-run]                          deep validation of schema, secrets, and links
  briefing [--limit N]                          recent active entries + status counts + recurring
  stale [--days N]                              active entries not updated in N days (default 90)
  session start --project P [--note T]          record session start entry
  session end <id>                              record session end entry
  current get                                   read .memory/CURRENT.md
  current set <text> --project P                append constraint line to .memory/CURRENT.md
  graph status                                  display graph provider status
  mcp                                           run stdio MCP server
  --help                                        show this help

Exit codes: 0 success, 1 validation/failure, 2 usage error.`;

function fail(msg: string, code = 1): number {
  console.error(msg);
  return code;
}

function usageError(msg: string): number {
  console.error(`error: ${msg}`);
  console.error("run `memory --help` for usage");
  return 2;
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-g") {
      flags["global"] = "true";
    } else if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function requireRoot(flags: Record<string, string> = {}): { root: string; memoryDir: string; store: ReturnType<typeof openStore> } | null {
  const isGlobal = flags["global"] === "true";
  const { root, memoryDir } = findOrCreateProjectRoot(process.cwd(), { global: isGlobal });
  return { root, memoryDir, store: openStore(memoryDir) };
}

function printEntry(e: MemoryEntry, badge = false): void {
  const status = e.status === "active" ? "" : ` [${e.status}]`;
  const extra = badge ? " [stale-by-policy]" : "";
  const salience = e.salience !== undefined ? ` (salience=${e.salience.toFixed(2)})` : "";
  console.log(`- ${e.id}${status}${extra}${salience} (${e.project}) ${e.title}`);
  console.log(`  ${e.content}`);
  if (e.tags?.length) console.log(`  tags: ${e.tags.join(", ")}`);
  if (e.type) console.log(`  type: ${e.type}`);
  if (e.verification?.level) console.log(`  verification: ${e.verification.level}`);
  if (e.related_memory_ids?.length) console.log(`  related: ${e.related_memory_ids.join(", ")}`);
  if (e.session_id) console.log(`  session: ${e.session_id}`);
  if (e.graph?.provider) console.log(`  graph: provider=${e.graph.provider}${e.graph.symbol_names ? ` symbols=[${e.graph.symbol_names.join(",")}]` : ""}`);
}

export async function main(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    console.log(USAGE);
    return 0;
  }

  const cmd = argv[0];
  const rest = argv.slice(1);
  const { positional, flags } = parseFlags(rest);

  switch (cmd) {
    case "init": {
      const isGlobal = flags["global"] === "true";
      const targetDir = positional[0] ? join(process.cwd(), positional[0]) : process.cwd();
      const memoryDirName = flags["legacy"] === "true" ? ".musememory" : ".memory";
      const memoryDir = isGlobal
        ? getGlobalMemoryDir()
        : join(targetDir, memoryDirName);
      mkdirSync(join(memoryDir, "memories"), { recursive: true });
      const currentPath = join(memoryDir, "CURRENT.md");
      if (!existsSync(currentPath)) {
        writeFileSync(currentPath, "# Active Project Constraints\n", "utf8");
      }
      console.log(`Initialized memory store in ${memoryDir}`);
      return 0;
    }

    case "connect": {
      const agent = positional[0] ?? (flags["all"] === "true" ? "all" : "all");
      const { connectAgent } = await import("./connect.ts");
      const dryRun = flags["dry-run"] === "true";
      const force = flags["force"] === "true";
      try {
        const reports = connectAgent(agent, undefined, { dryRun, force });
        console.log(`🔌 Wired memory MCP with zero-permission auto-approval:`);
        for (const r of reports) {
          console.log(`  ✓ ${r.agent}: ${r.message}`);
        }
        return 0;
      } catch (err: any) {
        return fail(`connect error: ${err.message}`);
      }
    }

    case "ui":
    case "dashboard": {
      const ctx = requireRoot(flags);
      if (!ctx) return 1;
      const port = flags["port"] ? parseInt(flags["port"], 10) : 3000;
      const { startUiServer } = await import("./ui.ts");
      const srv = await startUiServer({
        port,
        memoryDir: ctx.memoryDir,
        store: ctx.store,
      });
      console.log(`🧠 Muse Memory Visual Dashboard running at: http://localhost:${srv.port}`);
      console.log(`Press Ctrl+C to stop.`);
      await new Promise<void>(() => {});
      return 0;
    }

    case "context": {
      const ctx = requireRoot(flags);
      if (!ctx) return 1;
      const limit = parseInt(flags["limit"] ?? String(DEFAULT_CONTEXT_LIMIT), 10) || DEFAULT_CONTEXT_LIMIT;
      const tokenBudget = flags["token-budget"] ? parseInt(flags["token-budget"], 10) : undefined;
      const query = positional[0] ?? "";
      const res = search(ctx.store, ctx.memoryDir, query, {
        limit,
        tokenBudget,
        project: flags["project"],
        includeSuperseded: false,
        type: flags["type"],
        status: flags["status"],
        verified: flags["verified"] === "true",
      });
      for (const r of res.results) printEntry(r.entry);
      return 0;
    }

    case "search": {
      const ctx = requireRoot(flags);
      if (!ctx) return 1;
      if (positional.length === 0) return usageError("search requires a query");
      const limit = parseInt(flags["limit"] ?? "10", 10) || 10;
      const tokenBudget = flags["token-budget"] ? parseInt(flags["token-budget"], 10) : undefined;
      const res = search(ctx.store, ctx.memoryDir, positional[0], {
        limit,
        tokenBudget,
        includeSuperseded: flags["include-superseded"] === "true",
        type: flags["type"],
        status: flags["status"],
        verified: flags["verified"] === "true",
      });
      for (const r of res.results) {
        const badge = r.entry.status !== "active" ? ` [${r.entry.status}]` : "";
        console.log(`- ${r.entry.id}${badge} score=${r.score.toFixed(3)} (${r.entry.project}) ${r.entry.title}`);
        console.log(`  ${r.entry.content}`);
      }
      console.log(`source=${res.source} stale=${res.stale} count=${res.results.length}${res.totalTokensUsed ? ` tokens=${res.totalTokensUsed}` : ""}`);
      return 0;
    }

    case "propose": {
      const ctx = requireRoot(flags);
      if (!ctx) return 1;
      const text = positional[0];
      if (!text) return usageError("propose requires text");
      const project = flags["project"];
      if (!project) return usageError("propose requires --project");
      const secrets = scanSecrets(`${flags["title"] ?? ""} ${text}`);
      if (secrets.length > 0) return fail(`error: probable secret detected in propose text: ${secrets.join(", ")}`);
      const tags = flags["tags"] ? flags["tags"].split(",").map((t) => t.trim()).filter(Boolean) : undefined;
      const type = flags["type"] as MemoryType | undefined;
      const entry = propose(ctx.store, {
        content: text,
        project,
        title: flags["title"],
        tags,
        type,
        confirmed: flags["confirmed"] === "true",
      });
      console.log(`created ${entry.id}`);
      return 0;
    }

    case "capture": {
      const ctx = requireRoot(flags);
      if (!ctx) return 1;
      const text = positional[0];
      if (!text) return usageError("capture requires text");
      const project = flags["project"];
      if (!project) return usageError("capture requires --project");
      const secrets = scanSecrets(`${flags["title"] ?? ""} ${text}`);
      if (secrets.length > 0) return fail(`error: probable secret detected in capture text: ${secrets.join(", ")}`);
      const tags = flags["tags"] ? flags["tags"].split(",").map((t) => t.trim()).filter(Boolean) : undefined;
      const type = flags["type"] as MemoryType | undefined;
      const entry = propose(ctx.store, {
        content: text,
        project,
        title: flags["title"],
        tags,
        type,
        confirmed: flags["confirmed"] === "true",
      });
      console.log(`created ${entry.id}`);
      return 0;
    }

    case "harvest": {
      const ctx = requireRoot(flags);
      if (!ctx) return 1;
      const target = positional[0];
      if (!target) return usageError("harvest requires <text|file> --project P");
      const project = flags["project"];
      if (!project) return usageError("harvest requires --project");
      const rawText = existsSync(target) ? readFileSync(target, "utf8") : target;
      const units = extractHarvestUnits(rawText);
      if (units.length === 0) {
        console.log("no distinct harvest units identified");
        return 0;
      }
      const isConfirmed = flags["confirmed"] === "true";
      const createdIds: string[] = [];
      for (const u of units) {
        const entry = propose(ctx.store, {
          content: u.content,
          project,
          title: u.title,
          tags: u.tags,
          type: u.type,
          confirmed: isConfirmed,
        });
        entry.salience = u.salience;
        createdIds.push(entry.id);
      }
      console.log(`harvested ${createdIds.length} memory units: ${createdIds.join(", ")}`);
      return 0;
    }

    case "import-transcript":
    case "import-jsonl": {
      const ctx = requireRoot(flags);
      if (!ctx) return 1;
      const filePath = positional[0];
      if (!filePath) return usageError("import-transcript requires <file.jsonl|text>");
      const project = flags["project"] ?? "default";
      const isConfirmed = flags["confirmed"] === "true";
      const res = importTranscript(ctx.store, filePath, { project, confirmed: isConfirmed });
      console.log(`imported ${res.imported} memory units from transcript: ${res.entries.map((e) => e.id).join(", ")}`);
      if (res.errors.length > 0) {
        for (const err of res.errors) console.error(`  warning: ${err}`);
      }
      return 0;
    }

    case "recall": {
      const ctx = requireRoot(flags);
      if (!ctx) return 1;
      const query = positional[0] ?? "";
      const limit = parseInt(flags["limit"] ?? String(DEFAULT_CONTEXT_LIMIT), 10) || DEFAULT_CONTEXT_LIMIT;
      const tokenBudget = flags["token-budget"] ? parseInt(flags["token-budget"], 10) : undefined;
      const res = search(ctx.store, ctx.memoryDir, query, {
        limit,
        tokenBudget,
        project: flags["project"],
        includeSuperseded: false,
        type: flags["type"],
        status: flags["status"],
        verified: flags["verified"] === "true",
      });
      for (const r of res.results) printEntry(r.entry);
      return 0;
    }

    case "link": {
      const ctx = requireRoot(flags);
      if (!ctx) return 1;
      const id = positional[0];
      const related = flags["related"];
      if (!id || !related) return usageError("link requires <id> --related <id,...>");
      const relatedIds = related.split(",").map((s) => s.trim()).filter(Boolean);
      const entry = link(ctx.store, id, relatedIds);
      if (!entry) return fail(`error: could not link ${id} (missing id or related id)`);
      console.log(`linked ${id} -> ${relatedIds.join(",")}`);
      return 0;
    }

    case "confirm": {
      const ctx = requireRoot(flags);
      if (!ctx) return 1;
      const id = positional[0];
      if (!id) return usageError("confirm requires an id");
      const entry = confirm(ctx.store, id);
      if (!entry) return fail(`error: no entry with id ${id}`);
      console.log(`confirmed ${entry.id} -> confirmed`);
      return 0;
    }

    case "supersede": {
      const ctx = requireRoot(flags);
      if (!ctx) return 1;
      const oldId = positional[0];
      const newId = flags["with"];
      if (!oldId || !newId) return usageError("supersede requires <id> --with <newId>");
      const old = supersede(ctx.store, oldId, newId);
      if (!old) return fail(`error: could not supersede ${oldId} with ${newId} (missing entry or target not confirmed)`);
      console.log(`superseded ${oldId} by ${newId}`);
      return 0;
    }

    case "mark-stale": {
      const ctx = requireRoot(flags);
      if (!ctx) return 1;
      const id = positional[0];
      if (!id) return usageError("mark-stale requires an id");
      const entry = markStale(ctx.store, id, flags["reason"]);
      if (!entry) return fail(`error: no entry with id ${id}`);
      console.log(`marked ${entry.id} stale`);
      return 0;
    }

    case "reject": {
      const ctx = requireRoot(flags);
      if (!ctx) return 1;
      const id = positional[0];
      if (!id) return usageError("reject requires an id");
      const entry = reject(ctx.store, id);
      if (!entry) return fail(`error: no entry with id ${id}`);
      console.log(`rejected ${entry.id}`);
      return 0;
    }

    case "delete": {
      const ctx = requireRoot(flags);
      if (!ctx) return 1;
      const id = positional[0];
      if (!id) return usageError("delete requires <id>");
      const ok = deleteEntry(ctx.store, id, flags["reason"], "cli_user");
      if (!ok) return fail(`error: no entry with id ${id}`);
      console.log(`deleted entry ${id}`);
      return 0;
    }

    case "audit": {
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
      console.log(`📋 Audit Trail (${trail.length} records):`);
      for (const r of trail) {
        const details = r.details ? ` ${JSON.stringify(r.details)}` : "";
        const reason = r.reason ? ` reason="${r.reason}"` : "";
        console.log(`- [${r.timestamp}] ${r.operation.toUpperCase()} id=${r.entry_id} actor=${r.actor ?? "unknown"}${reason}${details}`);
      }
      return 0;
    }

    case "export": {
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

    case "import": {
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

    case "validate": {
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

    case "briefing": {
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

    case "stale": {
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

    case "session": {
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

    case "current": {
      const ctx = requireRoot(flags);
      if (!ctx) return 1;
      const sub = positional[0];
      if (sub === "get") {
        const lines = getCurrent(ctx.memoryDir);
        for (const l of lines) console.log(l);
        return 0;
      }
      if (sub === "set") {
        const text = positional[1];
        const project = flags["project"];
        if (!text || !project) return usageError("current set requires <text> --project P");
        const lines = setCurrent(ctx.memoryDir, text, project);
        console.log(`CURRENT.md now has ${lines.length} lines`);
        return 0;
      }
      return usageError("current requires get|set");
    }

    case "graph": {
      const ctx = requireRoot(flags);
      if (!ctx) return 1;
      const sub = positional[0];
      if (sub === "status") {
        const status = getGraphStatus(ctx.root);
        console.log(`graph provider: ${status.provider}`);
        console.log(`available: ${status.available}`);
        console.log(`root: ${status.root}`);
        if (status.graphRevision) console.log(`revision: ${status.graphRevision}`);
        if (status.symbolCount !== undefined) console.log(`symbols: ${status.symbolCount}`);
        return 0;
      }
      return usageError("graph requires status");
    }

    case "mcp": {
      const { runMcpServer } = await import("./mcp.ts");
      await runMcpServer();
      return 0;
    }

    default:
      return usageError(`unknown command "${cmd}"`);
  }
}
