import { existsSync, fsyncSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { withStoreLock } from "../lock.ts";

/**
 * T-427: procedural memory. A playbook is a reusable trajectory with
 * preconditions, executable steps, verification assertions and a rollback
 * recipe. It is stored as one atomic JSON file per memory directory.
 */

export interface PlaybookStep {
  action: string;
  description?: string;
  command?: string;
}

export interface Playbook {
  id: string;
  title: string;
  goal: string;
  steps: PlaybookStep[];
  preconditions: string[];
  verification: string[];
  rollback: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  successCount: number;
  failureCount: number;
}

export class PlaybookStoreError extends Error {}

export interface PlaybookInput {
  id?: string;
  title: string;
  goal: string;
  steps: PlaybookStep[];
  preconditions?: string[];
  verification?: string[];
  rollback?: string[];
  tags?: string[];
}

function playbookFile(memoryDir: string): string {
  return join(memoryDir, "playbooks.json");
}

function writeAtomic(path: string, body: string): void {
  // W24-25/D5: a fixed `${path}.tmp` name lets two concurrent writers — the
  // MCP server and a CLI invocation sharing one memory dir — clobber each
  // other's staged body before either renames, silently losing one update.
  // A per-write unique suffix removes the shared path; fsync makes the
  // rename durable rather than leaving an unflushed file after a crash.
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(tmp, "w");
  try {
    writeFileSync(fd, body, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {}
    throw err;
  }
}

export function loadPlaybooks(memoryDir: string): Playbook[] {
  const path = playbookFile(memoryDir);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new PlaybookStoreError(`playbooks.json is not valid JSON at ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new PlaybookStoreError(`playbooks.json is not a playbook array at ${path}`);
  }
  return parsed as Playbook[];
}

export function listPlaybooks(memoryDir: string, tag?: string): Playbook[] {
  const all = loadPlaybooks(memoryDir);
  return (tag ? all.filter((playbook) => playbook.tags.includes(tag)) : all).sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function getPlaybook(memoryDir: string, id: string): Playbook | null {
  return loadPlaybooks(memoryDir).find((playbook) => playbook.id === id || playbook.title === id) ?? null;
}

export function savePlaybook(memoryDir: string, input: PlaybookInput): Playbook {
  if (!input.title.trim()) throw new Error("Playbook title is required");
  if (!input.goal.trim()) throw new Error("Playbook goal is required");
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    throw new Error("Playbook needs at least one step");
  }
  input.steps.forEach((step, index) => {
    if (!step || typeof step.action !== "string" || !step.action.trim()) {
      throw new Error(`Playbook step ${index + 1} needs a non-empty action`);
    }
  });
  const now = new Date().toISOString();
  mkdirSync(memoryDir, { recursive: true });
  // D5: load and store must happen under the single-writer lock, or two
  // processes both read the same list and the later rename silently drops
  // the earlier writer's playbook.
  const playbook = withStoreLock(memoryDir, () => {
    const existing = loadPlaybooks(memoryDir);
    const match = input.id ? existing.find((entry) => entry.id === input.id) : undefined;
    if (input.id && !match) throw new Error(`Playbook '${input.id}' not found`);
    const record: Playbook = {
      id: match?.id ?? `pb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: input.title,
      goal: input.goal,
      steps: input.steps,
      // An update that only replaces steps must not erase the safety rails.
      preconditions: input.preconditions ?? match?.preconditions ?? [],
      verification: input.verification ?? match?.verification ?? [],
      rollback: input.rollback ?? match?.rollback ?? [],
      tags: Array.from(new Set(input.tags ?? match?.tags ?? [])),
      createdAt: match?.createdAt ?? now,
      updatedAt: now,
      successCount: match?.successCount ?? 0,
      failureCount: match?.failureCount ?? 0,
    };
    const next = [record, ...existing.filter((entry) => entry.id !== record.id)];
    writeAtomic(playbookFile(memoryDir), JSON.stringify(next, null, 2));
    return record;
  });
  return playbook;
}

export function recordPlaybookOutcome(memoryDir: string, id: string, success: boolean): Playbook | null {
  mkdirSync(memoryDir, { recursive: true });
  // D5: the counter bump is a read-modify-write too. Two concurrent outcome
  // records would otherwise both read the same count and one increment is
  // lost — which corrupts the success/failure ratio the ranking relies on.
  return withStoreLock(memoryDir, () => {
    const playbooks = loadPlaybooks(memoryDir);
    const target = playbooks.find((playbook) => playbook.id === id || playbook.title === id);
    if (!target) return null;
    if (success) target.successCount += 1;
    else target.failureCount += 1;
    target.updatedAt = new Date().toISOString();
    writeAtomic(playbookFile(memoryDir), JSON.stringify(playbooks, null, 2));
    return target;
  });
}

export function formatPlaybook(playbook: Playbook): string {
  const lines = [`# ${playbook.title}`, playbook.goal, ""];
  if (playbook.preconditions.length) lines.push("## Preconditions", ...playbook.preconditions.map((p) => `- ${p}`), "");
  lines.push("## Steps", ...playbook.steps.map((step, index) => `${index + 1}. ${step.action}${step.command ? ` — \`${step.command}\`` : ""}`), "");
  if (playbook.verification.length) lines.push("## Verification", ...playbook.verification.map((v) => `- ${v}`), "");
  if (playbook.rollback.length) lines.push("## Rollback", ...playbook.rollback.map((r) => `- ${r}`), "");
  lines.push(`Outcomes: ${playbook.successCount} success / ${playbook.failureCount} failure`);
  return lines.join("\n");
}
