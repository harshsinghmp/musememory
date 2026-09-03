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

export interface AgentWorkstream {
  agent: string;
  sessionId?: string;
  task: string;
  targetScope?: string;
  status: "IN-PROGRESS" | "BLOCKED" | "COMPLETED" | "WAITING_REVIEW" | "PAUSED";
  lastActive: string;
  lastInstruction?: string;
}

export interface CurrentFileData {
  constraints: string[];
  handoff: SessionHandoff | null;
  workstreams?: AgentWorkstream[];
}

export function currentFilePath(memoryDir: string): string {
  return join(memoryDir, "CURRENT.md");
}

export function parseCurrentFile(memoryDir: string): CurrentFileData {
  const p = currentFilePath(memoryDir);
  if (!existsSync(p)) return { constraints: [], handoff: null, workstreams: [] };

  const raw = readFileSync(p, "utf8");
  const lines = raw.split("\n");

  const constraints: string[] = [];
  const workstreams: AgentWorkstream[] = [];
  let inConstraintsSection = false;
  let inHandoffSection = false;
  let inWorkstreamsSection = false;
  const handoffLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("## Active Working Invariants") ||
      trimmed.startsWith("## Active Working Constraints") ||
      trimmed.startsWith("## Active Constraints") ||
      trimmed.startsWith("## 🔒 Active Working Invariants")
    ) {
      inConstraintsSection = true;
      inHandoffSection = false;
      inWorkstreamsSection = false;
      continue;
    }
    if (
      trimmed.startsWith("## 🤖 Active Concurrent Agent Workstreams") ||
      trimmed.startsWith("## Concurrent Agent Workstreams") ||
      trimmed.startsWith("## Active Workstreams")
    ) {
      inConstraintsSection = false;
      inHandoffSection = false;
      inWorkstreamsSection = true;
      continue;
    }
    if (
      trimmed.startsWith("## Active Work In Progress") ||
      trimmed.startsWith("## In-Flight Session State") ||
      trimmed.startsWith("## Session Handoff") ||
      trimmed.startsWith("## ⚡ Active Work In Progress")
    ) {
      inConstraintsSection = false;
      inHandoffSection = true;
      inWorkstreamsSection = false;
      continue;
    }
    if (trimmed.startsWith("# ") || trimmed.startsWith("> ") || trimmed.startsWith("---")) {
      continue;
    }

    if (inWorkstreamsSection) {
      if (trimmed.startsWith("##")) {
        inWorkstreamsSection = false;
      } else if (trimmed.startsWith("|")) {
        const cells = trimmed.split("|").map((c) => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
        if (cells.length >= 3 && !cells[0].includes("---") && !cells[1].toLowerCase().includes("status")) {
          const agent = cells[0].replace(/[`*]/g, "").trim();
          const statusRaw = cells[1].replace(/[\[\]`*]/g, "").trim().toUpperCase();
          const status = (statusRaw === "COMPLETED" || statusRaw === "BLOCKED" || statusRaw === "WAITING_REVIEW" ? statusRaw : "IN-PROGRESS") as any;
          const task = cells[2].trim();
          const scope = cells[3] ? cells[3].replace(/[`*()]/g, "").trim() : undefined;
          const lastActive = cells[4] ? cells[4].trim() : new Date().toISOString();
          if (agent && task) {
            workstreams.push({
              agent,
              status,
              task,
              targetScope: scope && scope !== "all" ? scope : undefined,
              lastActive,
            });
          }
        }
      }
    } else if (inHandoffSection) {
      if (trimmed.startsWith("##")) {
        inHandoffSection = false;
      } else {
        handoffLines.push(line);
      }
    } else if (inConstraintsSection) {
      if (trimmed.startsWith("##")) {
        inConstraintsSection = false;
      } else if (trimmed.length > 0 && !trimmed.startsWith("#") && !trimmed.startsWith("*(") && !trimmed.startsWith("(*")) {
        const cleaned = trimmed.replace(/^-\s+/, "");
        if (isValidConstraintLine(cleaned)) {
          constraints.push(cleaned);
        }
      }
    } else if (!inConstraintsSection && !inHandoffSection && !inWorkstreamsSection) {
      // Flat legacy format (only active if file has zero H2 sections)
      const hasSections = lines.some((l) => l.trim().startsWith("## "));
      if (!hasSections && trimmed.length > 0 && !trimmed.startsWith("#") && !trimmed.startsWith("*(") && !trimmed.startsWith("(*") && !trimmed.startsWith("|")) {
        if (isValidConstraintLine(trimmed)) {
          constraints.push(trimmed.replace(/^-\s+/, ""));
        }
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

  return { constraints, handoff, workstreams };
}

export function writeCurrentFile(memoryDir: string, data: CurrentFileData): void {
  const p = currentFilePath(memoryDir);
  mkdirSync(memoryDir, { recursive: true });

  const parts: string[] = [
    "# Active Project Constraints & In-Flight Context\n",
    "> **Operational Guidelines**:",
    "> - **For Humans**: Single-pane executive summary of active hard constraints and in-flight agent tasks. Zero verbose logs or transient filler.",
    "> - **For AI Agents**: Mandatory grounding rules (never violate active constraints) and concurrent workstream awareness (check what other agents are touching before editing files).\n",
    "---\n",
  ];

  // 1. Invariants & Constraints Section
  parts.push("## 🔒 Active Working Invariants & Hard Constraints");
  if (data.constraints.length === 0) {
    parts.push("*(No active hard constraints)*\n");
  } else {
    for (const c of data.constraints) {
      parts.push(`- ${c.replace(/^-\s+/, "")}`);
    }
    parts.push("");
  }

  // 2. Multi-Agent Concurrent Workstreams Section
  if (data.workstreams && data.workstreams.length > 0) {
    parts.push("## 🤖 Active Concurrent Agent Workstreams");
    parts.push("| Agent / Session ID | Status | Active Task | Target Scope / Files | Last Active |");
    parts.push("| :--- | :--- | :--- | :--- | :--- |");
    for (const ws of data.workstreams) {
      const statusTag = `[${ws.status || "IN-PROGRESS"}]`;
      const scope = ws.targetScope ? `\`${ws.targetScope}\`` : "*(all)*";
      parts.push(`| \`${ws.agent}\` | ${statusTag} | ${ws.task} | ${scope} | ${ws.lastActive} |`);
    }
    parts.push("");
  }

  // 3. Real-Time Handoff Section
  if (data.handoff) {
    parts.push("## ⚡ Active Work In Progress (Real-Time Session Handoff)");
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

  const workstreams = current.workstreams ? [...current.workstreams] : [];
  if (updated.agent && (updated.task || updated.lastQuery)) {
    const wsIdx = workstreams.findIndex(
      (w) => (updated.sessionId && w.sessionId === updated.sessionId) || w.agent.toLowerCase() === updated.agent!.toLowerCase(),
    );
    const wsEntry: AgentWorkstream = {
      agent: updated.agent,
      sessionId: updated.sessionId,
      task: updated.task || updated.lastQuery || "Active task",
      status: updated.status || "IN-PROGRESS",
      lastActive: now,
      lastInstruction: updated.lastQuery,
    };
    if (wsIdx >= 0) {
      workstreams[wsIdx] = { ...workstreams[wsIdx], ...wsEntry };
    } else {
      workstreams.push(wsEntry);
    }
  }

  writeCurrentFile(memoryDir, {
    constraints: current.constraints,
    handoff: updated,
    workstreams,
  });

  return updated;
}

export function registerAgentWorkstream(
  memoryDir: string,
  workstream: {
    agent: string;
    sessionId?: string;
    task: string;
    targetScope?: string;
    status?: "IN-PROGRESS" | "BLOCKED" | "COMPLETED" | "WAITING_REVIEW";
    lastActive?: string;
    lastInstruction?: string;
  },
): AgentWorkstream[] {
  const current = parseCurrentFile(memoryDir);
  const now = new Date().toISOString();
  const workstreams = current.workstreams ? [...current.workstreams] : [];

  const entry: AgentWorkstream = {
    agent: workstream.agent,
    sessionId: workstream.sessionId,
    task: workstream.task,
    targetScope: workstream.targetScope,
    status: workstream.status || "IN-PROGRESS",
    lastActive: workstream.lastActive || now,
    lastInstruction: workstream.lastInstruction,
  };

  const idx = workstreams.findIndex(
    (w) =>
      (entry.sessionId && w.sessionId === entry.sessionId) ||
      w.agent.toLowerCase() === entry.agent.toLowerCase(),
  );

  if (idx >= 0) {
    workstreams[idx] = { ...workstreams[idx], ...entry, lastActive: now };
  } else {
    workstreams.push(entry);
  }

  // Prune completed workstreams older than 48 hours
  const nowMs = Date.now();
  const pruned = workstreams.filter((w) => {
    if (w.status === "COMPLETED") {
      const activeMs = Date.parse(w.lastActive) || 0;
      return (nowMs - activeMs) < 48 * 3600 * 1000;
    }
    return true;
  });

  current.workstreams = pruned;
  writeCurrentFile(memoryDir, current);
  return pruned;
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
  if (current.workstreams && current.handoff.agent) {
    const ws = current.workstreams.find((w) => w.agent.toLowerCase() === current.handoff!.agent!.toLowerCase());
    if (ws) {
      ws.status = "COMPLETED";
      ws.lastActive = now;
      if (summary) ws.task = `[COMPLETED] ${summary}`;
    }
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

export function isValidConstraintLine(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 5 || trimmed.length > 300) return false;
  if (trimmed.includes("\n")) return false;
  if (/expect\(/i.test(trimmed) || /Ran\s+\d+\s+tests/i.test(trimmed)) return false;
  if (trimmed.startsWith("Showing lines") || trimmed.startsWith("Created At:") || trimmed.startsWith("File Path:")) return false;
  if (trimmed.startsWith("MODEL PLANNER_RESPONSE") || trimmed.startsWith("</SYSTEM_MESSAGE>")) return false;
  if (trimmed.includes("<truncated") || trimmed.includes("User: That worked")) return false;
  if (trimmed.startsWith("total ") || /^\d+:\s+/.test(trimmed) || /^\d+\s*\|\s*/.test(trimmed)) return false;
  if (trimmed.startsWith("The following code has been modified") || trimmed.startsWith("The above content does NOT")) return false;
  return true;
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
  const seenNorms = new Set<string>();
  for (const c of current.constraints) {
    if (!isValidConstraintLine(c)) continue;
    if (pruneContents.some((p) => c.includes(p))) continue;
    if (inactiveConstraintContents.some((ic) => ic.length > 0 && (c.includes(ic) || ic.includes(c)))) continue;
    const norm = c.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seenNorms.has(norm)) continue;
    seenNorms.add(norm);
    keptManual.push(c);
  }

  const resultConstraints: string[] = [...keptManual];

  for (const m of activeConstraintMemories) {
    const rawContent = m.content.trim();
    if (rawContent.length < 5) continue;

    let constraintText = rawContent;
    if (rawContent.includes("\n") || rawContent.length > 300) {
      const firstLine = rawContent.split("\n")[0].trim().replace(/^[-*#0-9.:\s|]+/, "");
      constraintText =
        firstLine.length >= 10 && firstLine.length <= 300
          ? firstLine
          : m.title.replace(/^[-*#0-9.:\s|]+/, "").slice(0, 200).trim();
    }

    const norm = constraintText.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (
      constraintText.length >= 5 &&
      isValidConstraintLine(constraintText) &&
      !resultConstraints.some((c) => c.toLowerCase().replace(/[^a-z0-9]/g, "").includes(norm))
    ) {
      const stamp = `[${m.created_at || new Date().toISOString()}] (${m.project}) ${constraintText}`;
      resultConstraints.push(stamp);
    }
  }

  writeCurrentFile(memoryDir, {
    constraints: resultConstraints,
    handoff: current.handoff,
    workstreams: current.workstreams,
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

  static registerWorkstream(
    memoryDir: string,
    workstream: {
      agent: string;
      sessionId?: string;
      task: string;
      targetScope?: string;
      status?: "IN-PROGRESS" | "BLOCKED" | "COMPLETED" | "WAITING_REVIEW";
      lastActive?: string;
      lastInstruction?: string;
    },
  ): AgentWorkstream[] {
    return registerAgentWorkstream(memoryDir, workstream);
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
