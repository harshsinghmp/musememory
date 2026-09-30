import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { findProjectRoot } from "../root.ts";
import { openStore, type Store } from "../store.ts";
import { parseCurrentFile } from "../governor.ts";
import { rankAndRetrieveMemories } from "../retrieval/ranking.ts";
import { recordObservation, listObservations } from "../learning/observation.ts";
import { distillObservationsToCandidates } from "../learning/distill.ts";
import { recordAuditEvent } from "../audit.ts";

/**
 * Claude Code Hook Pack (GAP-2)
 *
 * Wires Muse Memory into Claude Code's lifecycle hooks so memory is hands-free:
 *  - SessionStart: injects a budgeted context block (constraints + top memories)
 *    into the session before the agent's first turn.
 *  - PostToolUse:  captures every tool result as an ephemeral observation
 *    (Vibeguard-scanned) for later distillation.
 *  - Stop:         distills the session's observations into candidate memories
 *    and writes an audit record, so nothing learned is lost.
 *
 * Hook commands: `memory hooks session-start` / `post-tool-use` / `stop`.
 * Every handler is fail-open: a memory failure must never break a coding
 * session, so errors go to stderr and the process still exits 0.
 */

export type MuseHookEvent = "SessionStart" | "PostToolUse" | "Stop";

export interface HookPackReport {
  event: MuseHookEvent;
  wired: boolean;
  command: string;
  message: string;
}

const HOOK_COMMANDS: Record<MuseHookEvent, string> = {
  SessionStart: "memory hooks session-start",
  PostToolUse: "memory hooks post-tool-use",
  Stop: "memory hooks stop",
};

const HOOK_EVENTS: MuseHookEvent[] = ["SessionStart", "PostToolUse", "Stop"];

/** Timeout so a hung memory command can never stall the agent loop. */
const HOOK_TIMEOUT_SECONDS = 10;

/** Builds the Claude Code hook entry for one event. */
export function buildHookEntry(event: MuseHookEvent): Record<string, any> {
  return {
    type: "command",
    command: HOOK_COMMANDS[event],
    timeout: HOOK_TIMEOUT_SECONDS,
  };
}

/**
 * Installs the Muse hook pack into Claude Code's settings.json, merging with
 * any existing hooks and replacing only Muse-owned entries (idempotent).
 */
export function installHookPack(
  home: string = homedir(),
  options: { dryRun?: boolean; settingsPath?: string } = {},
): { settingsPath: string; installed: HookPackReport[]; alreadyPresent: boolean } {
  const settingsPath = options.settingsPath ?? join(home, ".claude", "settings.json");
  const installed: HookPackReport[] = [];
  let alreadyPresent = false;

  if (!options.dryRun && !existsSync(dirname(settingsPath))) {
    throw new Error(
      `Claude Code settings directory not found at ${dirname(settingsPath)}. Install Claude Code first, or pass settingsPath explicitly.`,
    );
  }

  const settings = existsSync(settingsPath) ? safeReadJson(settingsPath) : {};
  if (!settings.hooks || typeof settings.hooks !== "object") settings.hooks = {};
  const hooks = settings.hooks;

  for (const event of HOOK_EVENTS) {
    const entry = buildHookEntry(event);
    const existing = Array.isArray(hooks[event]) ? hooks[event] : [];

    const museEntryIdx = existing.findIndex(
      (h: any) => typeof h?.command === "string" && h.command.includes("memory hooks"),
    );
    if (museEntryIdx >= 0) {
      alreadyPresent = true;
      existing[museEntryIdx] = { ...existing[museEntryIdx], ...entry };
    } else {
      existing.push(entry);
    }

    hooks[event] = existing;
    installed.push({
      event,
      wired: true,
      command: entry.command,
      message:
        museEntryIdx >= 0
          ? `Updated existing Muse ${event} hook`
          : `Wired ${event} hook: ${entry.command}`,
    });
  }

  if (!options.dryRun) safeWriteJson(settingsPath, settings);

  return { settingsPath, installed, alreadyPresent };
}

/**
 * Removes Muse-owned hook entries from Claude Code's settings.json.
 * Only entries whose command includes "memory hooks" are touched.
 */
export function uninstallHookPack(
  home: string = homedir(),
  options: { dryRun?: boolean; settingsPath?: string } = {},
): { settingsPath: string; removed: MuseHookEvent[] } {
  const settingsPath = options.settingsPath ?? join(home, ".claude", "settings.json");
  const removed: MuseHookEvent[] = [];

  if (!existsSync(settingsPath)) return { settingsPath, removed };

  const settings = safeReadJson(settingsPath);
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== "object") return { settingsPath, removed };

  for (const event of HOOK_EVENTS) {
    const existing = Array.isArray(hooks[event]) ? hooks[event] : [];
    const filtered = existing.filter(
      (h: any) => !(typeof h?.command === "string" && h.command.includes("memory hooks")),
    );
    if (filtered.length !== existing.length) {
      removed.push(event);
      if (filtered.length === 0) delete hooks[event];
      else hooks[event] = filtered;
    }
  }

  if (Object.keys(hooks).length === 0) delete settings.hooks;
  if (!options.dryRun && removed.length > 0) safeWriteJson(settingsPath, settings);

  return { settingsPath, removed };
}

// ─── Hook payload engines (invoked by the CLI `memory hooks *` commands) ────

interface HookStdinPayload {
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_response?: string;
}

function readStdinJson(): HookStdinPayload {
  try {
    const raw = readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Resolves the muse root from the hook's cwd; null when this isn't a muse workspace. */
function resolveHookContext(cwd?: string): { root: string; memoryDir: string; store: Store; project: string } | null {
  const startDir = cwd || process.cwd();
  const found = findProjectRoot(startDir);
  if (!found.root || !found.memoryDirName) return null;
  const root = found.root;
  const memoryDir = join(root, found.memoryDirName);
  return {
    root,
    memoryDir,
    store: openStore(memoryDir),
    project: basename(root) || "default",
  };
}

/** Fail-open: log to stderr, never throw. The CLI wrapper exits 0 regardless. */
function failOpen(scope: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[muse hooks] ${scope} (non-blocking): ${msg}`);
}

/** SessionStart: emit a compact context block on stdout; Claude Code feeds it into the session. */
export async function runSessionStartHook(): Promise<void> {
  try {
    const payload = readStdinJson();
    const ctx = resolveHookContext(payload.cwd);
    if (!ctx) return; // not a muse workspace — stay silent

    const current = parseCurrentFile(ctx.memoryDir);
    const ranked = await rankAndRetrieveMemories(
      ctx.store,
      "session orientation: constraints architecture decisions",
      { limit: 5, tokenBudget: 1200 },
    );

    const lines: string[] = ["<muse-memory>"];
    if (current.constraints.length > 0) {
      lines.push("## Active constraints");
      for (const c of current.constraints.slice(0, 5)) lines.push(`- ${c}`);
    }
    if (ranked.length > 0) {
      lines.push("", "## Relevant memories");
      for (const r of ranked) {
        lines.push(`- [${r.entry.type}] ${r.entry.title}: ${r.entry.content.slice(0, 160)}`);
      }
    }
    lines.push("</muse-memory>", "");
    process.stdout.write(lines.join("\n"));
  } catch (err) {
    failOpen("session-start", err);
  }
}

/** PostToolUse: capture the tool result as an ephemeral, Vibeguard-scanned observation. */
export function runPostToolUseHook(): void {
  try {
    const payload = readStdinJson();
    if (!payload.tool_name || !payload.tool_response) return;
    const ctx = resolveHookContext(payload.cwd);
    if (!ctx) return;

    recordObservation(ctx.store, {
      source: "tool",
      project: ctx.project,
      raw: String(payload.tool_response).slice(0, 4000),
      summary: `${payload.tool_name} result`,
      metadata: { tool: payload.tool_name, session_id: payload.session_id },
    });
  } catch (err) {
    failOpen("post-tool-use", err);
  }
}

/** Stop: distill the session's unprocessed observations into candidate memories. */
export function runStopHook(): void {
  try {
    const payload = readStdinJson();
    const ctx = resolveHookContext(payload.cwd);
    if (!ctx) return;

    const unprocessed = listObservations(ctx.store, { processed: false, project: ctx.project });
    if (unprocessed.length === 0) return;

    const result = distillObservationsToCandidates(ctx.store, ctx.project);

    recordAuditEvent(ctx.memoryDir, {
      operation: "observation",
      entry_id: payload.session_id || "session",
      actor: "hook:stop",
      reason: `Distilled ${result.proposedCandidates.length} candidate(s) and ${result.negativeLessons.length} negative lesson(s) from ${unprocessed.length} observation(s)`,
    });
  } catch (err) {
    failOpen("stop", err);
  }
}

// ─── Shared JSON helpers ─────────────────────────────────────────────────────

function safeReadJson(path: string): Record<string, any> {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function safeWriteJson(path: string, data: Record<string, any>): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}
