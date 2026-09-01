import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "../store.ts";
import { list } from "../store.ts";
import type { MemoryEntry } from "../types.ts";

export type RollupPeriod = "week" | "month" | "quarter";

export interface RollupResult {
  filePath: string;
  periodKey: string;
  summary: string;
  entriesCount: number;
  hotMdPath?: string;
}

/**
 * Calculates deterministic period key for temporal compounding.
 */
export function getPeriodKey(dateInput: Date | string, period: RollupPeriod): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;

  if (period === "month") {
    return `${year}-${String(month).padStart(2, "0")}`;
  }

  if (period === "quarter") {
    const q = Math.ceil(month / 3);
    return `${year}-Q${q}`;
  }

  // ISO 8601 Week calculation
  const target = new Date(date.valueOf());
  const dayNr = (date.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  const weekNumber = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
  return `${year}-W${String(weekNumber).padStart(2, "0")}`;
}

/**
 * Compiles the instant zero-query HOT working memory cache (.memory/HOT.md).
 */
export function compileHotCache(store: Store, memoryDir: string): string {
  const currentPath = join(memoryDir, "CURRENT.md");
  let constraintsBlock = "*(No active constraints)*";
  if (existsSync(currentPath)) {
    constraintsBlock = readFileSync(currentPath, "utf-8").trim();
  }

  const entries = list(store);
  const confirmed = entries.filter((e) => e.status === "confirmed" || e.status === "active");

  const archEntries = confirmed.filter((e) => e.type === "architecture").slice(0, 5);
  const fixEntries = confirmed.filter((e) => e.type === "fix").slice(0, 5);
  const prefEntries = confirmed.filter((e) => e.type === "preference").slice(0, 5);

  const lines: string[] = [
    "# HOT Working Memory Cache",
    `> **Last Compiled**: ${new Date().toISOString()}`,
    "",
    "## 1. Active Constraints & Invariants (CURRENT.md)",
    constraintsBlock,
    "",
    "## 2. Key Architecture Invariants",
  ];

  if (archEntries.length === 0) {
    lines.push("*(No confirmed architectural memories)*");
  } else {
    for (const e of archEntries) {
      lines.push(`- **${e.title}** (\`${e.id}\`): ${e.content.slice(0, 140)}...`);
    }
  }

  lines.push("", "## 3. High-Priority Fixes & Workarounds");
  if (fixEntries.length === 0) {
    lines.push("*(No confirmed bug fixes)*");
  } else {
    for (const e of fixEntries) {
      lines.push(`- **${e.title}** (\`${e.id}\`): ${e.content.slice(0, 140)}...`);
    }
  }

  if (prefEntries.length > 0) {
    lines.push("", "## 4. Key Developer Preferences");
    for (const e of prefEntries) {
      lines.push(`- **${e.title}**: ${e.content.slice(0, 140)}...`);
    }
  }

  const hotContent = lines.join("\n") + "\n";
  const hotPath = join(memoryDir, "HOT.md");
  mkdirSync(memoryDir, { recursive: true });
  writeFileSync(hotPath, hotContent, "utf-8");

  return hotPath;
}

/**
 * Multi-Scale Temporal Knowledge Compounding:
 * Aggregates atomic session memories into higher-order synthesis wiki pages
 * and refreshes .memory/HOT.md cache.
 */
export function rollupTemporal(
  store: Store,
  options: {
    memoryDir: string;
    period: RollupPeriod;
    date?: Date | string;
    project?: string;
  },
): RollupResult {
  const { memoryDir, period } = options;
  const targetDate = options.date ?? new Date();
  const periodKey = getPeriodKey(targetDate, period);

  let entries = list(store).filter(
    (e) => e.status === "confirmed" || e.status === "active" || e.status === "candidate",
  );
  if (options.project) {
    entries = entries.filter((e) => e.project === options.project);
  }

  const arch = entries.filter((e) => e.type === "architecture");
  const fixes = entries.filter((e) => e.type === "fix");
  const decisions = entries.filter((e) => e.type === "decision");
  const discoveries = entries.filter((e) => e.type === "discovery");

  const periodLabel =
    period === "week"
      ? "Weekly Synthesis"
      : period === "month"
        ? "Monthly Synthesis"
        : "Quarterly Synthesis";

  const lines: string[] = [
    `# ${periodLabel}: ${periodKey}`,
    `> **Compounding Window**: ${periodKey} | **Evaluated Memories**: ${entries.length} | **Generated**: ${new Date().toISOString()}`,
    "",
    "## 🏛️ System Architecture & Invariants",
  ];

  if (arch.length === 0) {
    lines.push("*(No architectural changes in this period)*");
  } else {
    for (const a of arch) {
      lines.push(`- **${a.title}** (\`${a.id}\`) [${a.status}]`);
      lines.push(`  ${a.content}`);
    }
  }

  lines.push("", "## 🛠️ Resolved Fixes & Incident Workarounds");
  if (fixes.length === 0) {
    lines.push("*(No fixes recorded in this period)*");
  } else {
    for (const f of fixes) {
      lines.push(`- **${f.title}** (\`${f.id}\`)`);
      lines.push(`  ${f.content}`);
    }
  }

  lines.push("", "## 💡 Key Decisions & Discoveries");
  const combined = [...decisions, ...discoveries];
  if (combined.length === 0) {
    lines.push("*(No new decisions or discoveries)*");
  } else {
    for (const d of combined) {
      lines.push(`- **${d.title}** (\`${d.id}\`)`);
      lines.push(`  ${d.content}`);
    }
  }

  const summary = `Compiled ${entries.length} memories into ${periodKey} rollup.`;
  lines.push("", "---", `*Generated by Muse Memory Temporal Compounding Engine*`);

  const rollupDir = join(memoryDir, "wiki", "rollups");
  mkdirSync(rollupDir, { recursive: true });
  const filePath = join(rollupDir, `${periodKey}.md`);
  writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");

  const hotMdPath = compileHotCache(store, memoryDir);

  return {
    filePath,
    periodKey,
    summary,
    entriesCount: entries.length,
    hotMdPath,
  };
}
