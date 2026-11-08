import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

export interface PlaybookInput {
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
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, path);
}

export function loadPlaybooks(memoryDir: string): Playbook[] {
  const path = playbookFile(memoryDir);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed) ? (parsed as Playbook[]) : [];
  } catch {
    return [];
  }
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
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    throw new Error("Playbook needs at least one step");
  }
  const now = new Date().toISOString();
  const existing = loadPlaybooks(memoryDir);
  const match = existing.find((playbook) => playbook.title === input.title);
  const playbook: Playbook = {
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
  const next = [playbook, ...existing.filter((entry) => entry.id !== playbook.id)];
  mkdirSync(memoryDir, { recursive: true });
  writeAtomic(playbookFile(memoryDir), JSON.stringify(next, null, 2));
  return playbook;
}

export function recordPlaybookOutcome(memoryDir: string, id: string, success: boolean): Playbook | null {
  const playbooks = loadPlaybooks(memoryDir);
  const target = playbooks.find((playbook) => playbook.id === id || playbook.title === id);
  if (!target) return null;
  if (success) target.successCount += 1;
  else target.failureCount += 1;
  target.updatedAt = new Date().toISOString();
  mkdirSync(memoryDir, { recursive: true });
  writeAtomic(playbookFile(memoryDir), JSON.stringify(playbooks, null, 2));
  return target;
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
