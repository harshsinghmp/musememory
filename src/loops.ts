import { execFileSync } from "node:child_process";
import type { Store } from "./store.ts";
import { list } from "./store.ts";
import { getCurrent } from "./current.ts";
import { daysSince } from "./retrieval.ts";

export type LoopSource = "git" | "memories" | "constraints";

export interface LoopItem {
  source: LoopSource;
  label: string;
  detail?: string;
  ageDays?: number;
}

export interface LoopsReport {
  git: LoopItem[];
  memories: LoopItem[];
  constraints: LoopItem[];
}

/** Candidates older than this many days are reported as open loops. */
const CANDIDATE_STALE_DAYS = 7;

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/**
 * Ambient Open-Loop Tracker (read-only):
 * surfaces unresolved work from the workspace git state (uncommitted changes,
 * unmerged local branches; tolerated absent in non-git dirs) and memory-side
 * open loops (candidates older than 7 days never confirmed, disputed entries,
 * active constraints in CURRENT.md).
 */
export function collectLoops(store: Store, workspaceRoot: string, memoryDir: string, now = Date.now()): LoopsReport {
  const report: LoopsReport = { git: [], memories: [], constraints: [] };

  // 1. Git workspace state
  if (git(["rev-parse", "--is-inside-work-tree"], workspaceRoot) === "true") {
    const porcelain = git(["status", "--porcelain"], workspaceRoot);
    if (porcelain) {
      const lines = porcelain.split("\n").filter((l) => l.trim().length > 0);
      report.git.push({
        source: "git",
        label: `${lines.length} uncommitted change(s)`,
        detail: lines.slice(0, 5).map((l) => l.trim()).join("; "),
      });
    }
    const branches = git(["branch", "--no-merged"], workspaceRoot);
    if (branches) {
      for (const b of branches.split("\n").map((s) => s.trim()).filter(Boolean)) {
        report.git.push({ source: "git", label: `unmerged branch: ${b}` });
      }
    }
  }

  // 2. Memory-side open loops
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

  return report;
}

/** Render the grouped, prioritized open-loop report as plain lines. */
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
