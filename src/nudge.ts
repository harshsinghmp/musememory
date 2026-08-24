import type { Store } from "./store.ts";
import { list } from "./store.ts";
import type { MemoryEntry } from "./types.ts";
import { daysSince, stalePolicyDays } from "./retrieval.ts";
import { collectLoops } from "./loops.ts";

export type NudgeSeverity = "overdue" | "due-soon" | "stale-policy" | "loop";

export interface NudgeItem {
  severity: NudgeSeverity;
  label: string;
  detail?: string;
}

export interface NudgeReport {
  items: NudgeItem[];
}

/** Entries due within this many days are surfaced as due-soon nudges. */
const DUE_SOON_DAYS = 7;

/**
 * Overdue + due-soon entries (due_at within the next DUE_SOON_DAYS days),
 * sorted by due date ascending. Superseded/rejected entries excluded.
 */
export function dueEntries(entries: MemoryEntry[], now: number = Date.now()): MemoryEntry[] {
  return entries
    .filter((e) => {
      if (e.status === "superseded" || e.status === "rejected" || !e.due_at) return false;
      const t = Date.parse(e.due_at);
      return !Number.isNaN(t) && t <= now + DUE_SOON_DAYS * 86_400_000;
    })
    .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!));
}

/**
 * Proactive Nudge Scanner (SOW-101, read-only, deterministic):
 * - overdue / due-soon entries (due_at)
 * - confirmed/active entries past their per-type staleness policy
 * - memory-side open loops + active CURRENT.md constraints (via the ambient tracker)
 * Git workspace state is intentionally excluded (see `memory loops`).
 */
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

/** Render the ranked nudge list as plain lines. First line reports the total count. */
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
