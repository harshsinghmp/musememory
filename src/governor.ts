import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { Store } from "./store.ts";
import { list, get, save, propose, link, nowIso } from "./store.ts";
import type { MemoryEntry, MemoryType, MemoryStatus } from "./types.ts";
import { daysSince, stalePolicyDays } from "./retrieval.ts";

// -----------------------------------------------------------------------------
// CURRENT.md (Active Constraints & In-Flight Real-Time Session State)
// -----------------------------------------------------------------------------

export interface SessionHandoff {
  status: "IN-PROGRESS" | "COMPLETED" | "PAUSED" | "BLOCKED";
  agent?: string;
  sessionId?: string;
  lastUpdated: string;
  updatedAt?: string;
  task?: string;
  lastQuery?: string;
  progress?: string[];
  discoveries?: string[];
}

export interface CurrentFileData {
  constraints: string[];
  handoff: SessionHandoff | null;
}

export function currentFilePath(memoryDir: string): string {
  return join(memoryDir, "CURRENT.md");
}

export function parseCurrentFile(memoryDir: string): CurrentFileData {
  const p = currentFilePath(memoryDir);
  if (!existsSync(p)) return { constraints: [], handoff: null };

  const raw = readFileSync(p, "utf8");
  const lines = raw.split("\n");

  const constraints: string[] = [];
  let inConstraintsSection = false;
  let inHandoffSection = false;
  const handoffLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## Active Working Invariants") || trimmed.startsWith("## Active Constraints")) {
      inConstraintsSection = true;
      inHandoffSection = false;
      continue;
    }
    if (trimmed.startsWith("## Active Work In Progress") || trimmed.startsWith("## In-Flight Session State") || trimmed.startsWith("## Session Handoff")) {
      inConstraintsSection = false;
      inHandoffSection = true;
      continue;
    }
    if (trimmed.startsWith("# ")) {
      continue;
    }

    if (inHandoffSection) {
      handoffLines.push(line);
    } else if (inConstraintsSection) {
      if (trimmed.length > 0 && !trimmed.startsWith("#") && !trimmed.startsWith("*(") && !trimmed.startsWith("(*")) {
        constraints.push(trimmed.replace(/^-\s+/, ""));
      }
    } else if (!inConstraintsSection && !inHandoffSection) {
      // Flat legacy format
      if (trimmed.length > 0 && !trimmed.startsWith("#") && !trimmed.startsWith("*(") && !trimmed.startsWith("(*")) {
        constraints.push(trimmed.replace(/^-\s+/, ""));
      }
    }
  }

  let handoff: SessionHandoff | null = null;
  if (handoffLines.length > 0) {
    const handoffText = handoffLines.join("\n");
    const statusMatch = handoffText.match(/-\s+\*\*Status\*\*:\s*\[?([A-Z_-]+)\]?/i);
    const agentMatch = handoffText.match(/-\s+\*\*Active Agent\*\*:\s*([^\n]+)/i);
    const sessionMatch = handoffText.match(/-\s+\*\*Session ID\*\*:\s*([^\n]+)/i);
    const updatedMatch = handoffText.match(/-\s+\*\*Last Updated\*\*:\s*([^\n]+)/i);
    const taskMatch = handoffText.match(/-\s+\*\*Active Task\*\*:\s*([^\n]+)/i);
    const queryMatch = handoffText.match(/-\s+\*\*Last Query \/ Instruction\*\*:\s*"([^"]+)"/i);

    const progress: string[] = [];
    const discoveries: string[] = [];
    let inProgressList = false;
    let inDiscoveriesList = false;

    for (const hLine of handoffLines) {
      const hTrim = hLine.trim();
      if (hTrim.startsWith("- **Progress & Checkpoints**:")) {
        inProgressList = true;
        inDiscoveriesList = false;
        continue;
      }
      if (hTrim.startsWith("- **Learned Discoveries**:")) {
        inProgressList = false;
        inDiscoveriesList = true;
        continue;
      }
      if (hTrim.startsWith("- **")) {
        inProgressList = false;
        inDiscoveriesList = false;
        continue;
      }

      if (inProgressList && hTrim.startsWith("- ")) {
        progress.push(hTrim.slice(2).trim());
      } else if (inDiscoveriesList && hTrim.startsWith("- ")) {
        discoveries.push(hTrim.slice(2).trim());
      }
    }

    if (statusMatch || taskMatch || queryMatch) {
      const lu = updatedMatch ? updatedMatch[1].trim() : new Date().toISOString();
      handoff = {
        status: (statusMatch ? statusMatch[1].toUpperCase() : "IN-PROGRESS") as any,
        agent: agentMatch ? agentMatch[1].trim() : undefined,
        sessionId: sessionMatch ? sessionMatch[1].trim() : undefined,
        lastUpdated: lu,
        updatedAt: lu,
        task: taskMatch ? taskMatch[1].trim() : undefined,
        lastQuery: queryMatch ? queryMatch[1].trim() : undefined,
        progress: progress.length > 0 ? progress : undefined,
        discoveries: discoveries.length > 0 ? discoveries : undefined,
      };
    }
  }

  return { constraints, handoff };
}

export function writeCurrentFile(memoryDir: string, data: CurrentFileData): void {
  const p = currentFilePath(memoryDir);
  mkdirSync(memoryDir, { recursive: true });

  const parts: string[] = ["# Active Project Constraints & In-Flight Context\n"];

  // 1. Invariants & Constraints Section
  parts.push("## Active Working Invariants & Hard Constraints");
  if (data.constraints.length === 0) {
    parts.push("*(No active hard constraints)*\n");
  } else {
    for (const c of data.constraints) {
      parts.push(`- ${c.replace(/^-\s+/, "")}`);
    }
    parts.push("");
  }

  // 2. Real-Time Handoff Section
  if (data.handoff) {
    parts.push("## Active Work In Progress (Real-Time Session Handoff)");
    parts.push(`- **Status**: [${data.handoff.status}]`);
    if (data.handoff.agent) parts.push(`- **Active Agent**: ${data.handoff.agent}`);
    if (data.handoff.sessionId) parts.push(`- **Session ID**: ${data.handoff.sessionId}`);
    parts.push(`- **Last Updated**: ${data.handoff.lastUpdated}`);
    if (data.handoff.task) parts.push(`- **Active Task**: ${data.handoff.task}`);
    if (data.handoff.lastQuery) parts.push(`- **Last Query / Instruction**: "${data.handoff.lastQuery}"`);
    if (data.handoff.progress && data.handoff.progress.length > 0) {
      parts.push("- **Progress & Checkpoints**:");
      for (const pr of data.handoff.progress) {
        parts.push(`  - ${pr.replace(/^-\s+/, "")}`);
      }
    }
    if (data.handoff.discoveries && data.handoff.discoveries.length > 0) {
      parts.push("- **Learned Discoveries**:");
      for (const disc of data.handoff.discoveries) {
        parts.push(`  - ${disc.replace(/^-\s+/, "")}`);
      }
    }
    parts.push("");
  }

  writeFileSync(p, parts.join("\n"), "utf8");
}

export function updateSessionHandoff(memoryDir: string, update: Partial<SessionHandoff>): SessionHandoff {
  const current = parseCurrentFile(memoryDir);
  const now = new Date().toISOString();
  const existing = current.handoff ?? {
    status: "IN-PROGRESS",
    lastUpdated: now,
    updatedAt: now,
  };

  const progressMerged = update.progress
    ? Array.from(new Set([...(existing.progress ?? []), ...update.progress]))
    : existing.progress;

  const discoveriesMerged = update.discoveries
    ? Array.from(new Set([...(existing.discoveries ?? []), ...update.discoveries]))
    : existing.discoveries;

  const updated: SessionHandoff = {
    ...existing,
    ...update,
    lastUpdated: now,
    updatedAt: now,
    progress: progressMerged,
    discoveries: discoveriesMerged,
  };

  writeCurrentFile(memoryDir, {
    constraints: current.constraints,
    handoff: updated,
  });

  return updated;
}

export function getSessionHandoff(memoryDir: string): SessionHandoff | null {
  return parseCurrentFile(memoryDir).handoff;
}

export function markSessionCompleted(memoryDir: string, summary?: string): void {
  const current = parseCurrentFile(memoryDir);
  if (!current.handoff) return;
  const now = new Date().toISOString();
  current.handoff.status = "COMPLETED";
  current.handoff.lastUpdated = now;
  current.handoff.updatedAt = now;
  if (summary) {
    current.handoff.task = `[COMPLETED] ${summary}`;
  }
  writeCurrentFile(memoryDir, current);
}

export function getCurrent(memoryDir: string): string[] {
  return parseCurrentFile(memoryDir).constraints;
}

export function setCurrent(memoryDir: string, text: string, project = "default"): string[] {
  const trimmed = text.trim();
  if (!trimmed) return getCurrent(memoryDir);
  const current = parseCurrentFile(memoryDir);
  const stamp = `[${new Date().toISOString()}] (${project}) ${trimmed}`;
  if (!current.constraints.some((c) => c.includes(trimmed))) {
    current.constraints.push(stamp);
    writeCurrentFile(memoryDir, current);
  }
  return current.constraints;
}

export function syncConstraints(memoryDir: string, store: Store, pruneContents: string[] = []): string[] {
  const entries = list(store);
  const activeConstraintMemories = entries.filter((e) => e.type === "constraint" && (e.status === "active" || e.status === "confirmed"));
  const allConstraintMemories = entries.filter((e) => e.type === "constraint");
  const inactiveConstraintContents = allConstraintMemories
    .filter((e) => e.status !== "active" && e.status !== "confirmed")
    .map((e) => e.content.split("\n\nStale:")[0].split("\n\nSuperseded:")[0].trim())
    .filter(Boolean);

  const current = parseCurrentFile(memoryDir);

  const keptManual: string[] = [];
  for (const c of current.constraints) {
    if (pruneContents.some((p) => c.includes(p))) continue;
    if (inactiveConstraintContents.some((ic) => ic.length > 0 && (c.includes(ic) || ic.includes(c)))) continue;
    keptManual.push(c);
  }

  const resultConstraints: string[] = [...keptManual];

  for (const m of activeConstraintMemories) {
    const rawContent = m.content.trim();
    if (!resultConstraints.some((c) => c.includes(rawContent))) {
      const stamp = `[${m.created_at || new Date().toISOString()}] (${m.project}) ${rawContent}`;
      resultConstraints.push(stamp);
    }
  }

  writeCurrentFile(memoryDir, {
    constraints: resultConstraints,
    handoff: current.handoff,
  });

  return resultConstraints;
}

// -----------------------------------------------------------------------------
// SESSIONS (Permanent Timeline Nodes)
// -----------------------------------------------------------------------------

export function recordSessionStart(
  store: Store,
  project: string,
  note?: string,
): { entry: MemoryEntry; sessionId: string } {
  const sessionId = `s_${Date.now()}`;
  const entry = propose(store, {
    content: note ? `Session started: ${note}` : `Session started for project ${project}`,
    project,
    title: `Session ${sessionId} start`,
    type: "session",
    tags: ["session", "timeline"],
    confirmed: true,
  });
  entry.session_id = sessionId;
  save(store, entry);
  return { entry, sessionId };
}

export function findSession(store: Store, sessionId: string): MemoryEntry | null {
  const entries = list(store);
  return entries.find((e) => e.session_id === sessionId && e.type === "session") ?? null;
}

export function recordSessionEnd(
  store: Store,
  sessionId: string,
  project: string,
  summary?: string,
): MemoryEntry | null {
  const start = findSession(store, sessionId);
  const entry = propose(store, {
    content: summary ? `Session ended: ${summary}` : `Session ${sessionId} completed`,
    project: start?.project ?? project,
    title: `Session ${sessionId} end`,
    type: "session",
    tags: ["session", "timeline", "completed"],
    confirmed: true,
  });
  entry.session_id = sessionId;
  save(store, entry);
  return entry;
}

export function getSessionMemories(store: Store, sessionId: string): MemoryEntry[] {
  return list(store).filter((e) => e.session_id === sessionId && e.type !== "session");
}

export function linkMemoriesToSession(
  store: Store,
  sessionId: string,
  memoryIds: string[],
): MemoryEntry[] {
  const updated: MemoryEntry[] = [];
  const entries = list(store);
  for (const id of memoryIds) {
    const entry = entries.find((e) => e.id === id);
    if (entry) {
      entry.session_id = sessionId;
      save(store, entry);
      updated.push(entry);
    }
  }
  return updated;
}

// -----------------------------------------------------------------------------
// OPEN LOOPS & AMBIENT OBLIGATIONS
// -----------------------------------------------------------------------------

export interface LoopItem {
  source: "git" | "memories" | "constraints";
  label: string;
  detail?: string;
  ageDays?: number;
}

export interface LoopsReport {
  git: LoopItem[];
  memories: LoopItem[];
  constraints: LoopItem[];
  total: number;
}

const CANDIDATE_STALE_DAYS = 7;

function probeGit(workspaceRoot: string): LoopItem[] {
  const items: LoopItem[] = [];
  try {
    const statusOut = execSync("git status --porcelain -b", {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });

    const lines = statusOut.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return items;

    const uncommitted = lines.slice(1).length;
    if (uncommitted > 0) {
      items.push({
        source: "git",
        label: `${uncommitted} uncommitted change(s)`,
      });
    }

    try {
      const branchesOut = execSync("git branch --no-merged", {
        cwd: workspaceRoot,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      });
      const unmerged = branchesOut
        .split("\n")
        .map((b) => b.replace(/^\*\s*/, "").trim())
        .filter(Boolean);

      for (const b of unmerged) {
        items.push({
          source: "git",
          label: `unmerged branch: ${b}`,
        });
      }
    } catch {}
  } catch {}
  return items;
}

export function collectLoops(
  store: Store,
  workspaceRoot: string,
  memoryDir: string,
  now: number = Date.now(),
): LoopsReport {
  const git = probeGit(workspaceRoot);
  const report: LoopsReport = { git, memories: [], constraints: [], total: 0 };

  // 2. Memory-side loops: stale candidates + disputed entries
  for (const e of list(store)) {
    if (e.status === "candidate") {
      const ageDays = Math.floor(daysSince(e.created_at, now));
      if (ageDays > CANDIDATE_STALE_DAYS) {
        report.memories.push({
          source: "memories",
          label: `stale candidate (never confirmed): ${e.id}`,
          detail: e.title,
          ageDays,
        });
      }
    }
    if (e.status === "disputed") {
      report.memories.push({
        source: "memories",
        label: `disputed entry: ${e.id}`,
        detail: e.title,
        ageDays: Math.floor(daysSince(e.updated_at, now)),
      });
    }
  }
  report.memories.sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0));

  // 3. Active constraints in CURRENT.md
  for (const c of getCurrent(memoryDir)) {
    report.constraints.push({ source: "constraints", label: c });
  }

  report.total = report.git.length + report.memories.length + report.constraints.length;
  return report;
}

export function renderLoops(report: LoopsReport): string[] {
  const lines: string[] = [];
  const sections: [string, LoopItem[]][] = [
    ["Git Workspace", report.git],
    ["Memory Open Loops", report.memories],
    ["Active Constraints (CURRENT.md)", report.constraints],
  ];
  let total = 0;
  for (const [title, items] of sections) {
    lines.push(`=== ${title} ===`);
    if (items.length === 0) {
      lines.push("(none)");
    } else {
      total += items.length;
      for (const item of items) {
        const age = item.ageDays !== undefined ? ` (${item.ageDays}d)` : "";
        lines.push(`- ${item.label}${age}${item.detail ? ` — ${item.detail}` : ""}`);
      }
    }
    lines.push("");
  }
  lines.unshift(`Open loops: ${total}`);
  return lines;
}

// -----------------------------------------------------------------------------
// PROACTIVE NUDGES & ATTENTION SCANNER
// -----------------------------------------------------------------------------

export type NudgeSeverity = "overdue" | "due-soon" | "stale-policy" | "loop";

export interface NudgeItem {
  severity: NudgeSeverity;
  label: string;
  detail?: string;
}

export interface NudgeReport {
  items: NudgeItem[];
}

const DUE_SOON_DAYS = 7;

export function dueEntries(entries: MemoryEntry[], now: number = Date.now()): MemoryEntry[] {
  return entries
    .filter((e) => {
      if (e.status === "superseded" || e.status === "rejected" || !e.due_at) return false;
      const t = Date.parse(e.due_at);
      return !Number.isNaN(t) && t <= now + DUE_SOON_DAYS * 86_400_000;
    })
    .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!));
}

export function collectNudges(
  store: Store,
  workspaceRoot: string,
  memoryDir: string,
  now: number = Date.now(),
): NudgeReport {
  const items: NudgeItem[] = [];

  for (const e of dueEntries(list(store), now)) {
    const days = (Date.parse(e.due_at!) - now) / 86_400_000;
    if (days < 0) {
      items.push({
        severity: "overdue",
        label: `overdue: ${e.id}`,
        detail: `${e.title} (due ${e.due_at!.slice(0, 10)}, ${Math.floor(-days)}d ago)`,
      });
    } else {
      items.push({
        severity: "due-soon",
        label: `due soon: ${e.id}`,
        detail: `${e.title} (due in ${Math.ceil(days)}d)`,
      });
    }
  }

  for (const e of list(store)) {
    if (e.status === "superseded" || e.status === "rejected") continue;
    const policy = stalePolicyDays(e.type);
    if (policy !== null && (e.status === "confirmed" || e.status === "active")) {
      const age = daysSince(e.valid_from ?? e.updated_at, now);
      if (age > policy) {
        items.push({
          severity: "stale-policy",
          label: `stale by policy: ${e.id}`,
          detail: `${e.title} (${e.type ?? "default"} ${policy}d limit, ${Math.floor(age)}d old) — consider: memory supersede or memory mark-stale ${e.id}`,
        });
      }
    }
  }

  const loops = collectLoops(store, workspaceRoot, memoryDir, now);
  for (const l of [...loops.memories, ...loops.constraints]) {
    items.push({ severity: "loop", label: l.label, detail: l.detail });
  }

  const rank: Record<NudgeSeverity, number> = { overdue: 0, "due-soon": 1, "stale-policy": 2, loop: 3 };
  items.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return { items };
}

export function renderNudges(report: NudgeReport): string[] {
  const lines: string[] = [`Nudges: ${report.items.length}`];
  if (report.items.length === 0) {
    lines.push("(all clear)");
    return lines;
  }
  for (const item of report.items) {
    lines.push(`[${item.severity}] ${item.label}${item.detail ? ` — ${item.detail}` : ""}`);
  }
  return lines;
}

// -----------------------------------------------------------------------------
// DEEP WORKSPACE GOVERNOR
// -----------------------------------------------------------------------------

export class WorkspaceGovernor {
  static getActiveState(store: Store, memoryDir: string): CurrentFileData {
    return parseCurrentFile(memoryDir);
  }

  static checkpointSession(memoryDir: string, update: Partial<SessionHandoff>): SessionHandoff {
    return updateSessionHandoff(memoryDir, update);
  }

  static completeSession(memoryDir: string, summary?: string): void {
    markSessionCompleted(memoryDir, summary);
  }

  static evaluateAttention(store: Store, workspaceRoot: string, memoryDir: string, now?: number): NudgeReport {
    return collectNudges(store, workspaceRoot, memoryDir, now);
  }

  static evaluateLoops(store: Store, workspaceRoot: string, memoryDir: string, now?: number): LoopsReport {
    return collectLoops(store, workspaceRoot, memoryDir, now);
  }
}
