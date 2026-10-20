import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Store } from "../store.ts";
import { list } from "../store.ts";
import type { MemoryEntry } from "../types.ts";
import { scanSecrets } from "../secrets.ts";

export interface DistillRouterOptions {
  workspaceRoot?: string;
  force?: boolean;
  dryRun?: boolean;
}

export interface RoutedItem {
  id: string;
  title: string;
  lane: "system" | "content" | "health";
  summary: string;
  path?: string;
}

export interface DistillRouterResult {
  ok: boolean;
  routed: {
    system: RoutedItem[];
    content: RoutedItem[];
    health: RoutedItem[];
  };
  total_routed: number;
  skipped_surfaced: number;
}

interface DistillState {
  schema_version: number;
  surfaced_ids: Record<string, string>;
  item_hashes: Record<string, string>;
  last_run: string | null;
}

function loadState(statePath: string): DistillState {
  if (existsSync(statePath)) {
    try {
      return JSON.parse(readFileSync(statePath, "utf8"));
    } catch {
      // fallback
    }
  }
  return {
    schema_version: 1,
    surfaced_ids: {},
    item_hashes: {},
    last_run: null,
  };
}

/**
 * Multi-Channel Knowledge Distillation Router:
 * Directs confirmed memories into 3 actionable downstream lanes:
 *   1. system: Bug fixes, runtime rules, operational gotchas
 *   2. content: High-salience architectural patterns & concept drafts
 *   3. health: Conflicted memories, unverified contradictions
 *
 * Implements stateful deduplication via .memory/distill_state.json.
 */
export function runDistillRouter(store: Store, options?: DistillRouterOptions): DistillRouterResult {
  const root = options?.workspaceRoot ?? store.memoryDir ?? process.cwd();
  const memoryDir = store.memoryDir ?? root;
  const statePath = join(memoryDir, "distill_state.json");
  const state = loadState(statePath);

  const entries = list(store);
  const result: DistillRouterResult = {
    ok: true,
    routed: { system: [], content: [], health: [] },
    total_routed: 0,
    skipped_surfaced: 0,
  };

  const todayIso = new Date().toISOString();

  for (const e of entries) {
    const hash = createHash("sha256").update(e.title + e.content).digest("hex").slice(0, 16);

    if (!options?.force && (state.surfaced_ids[e.id] || state.item_hashes[hash])) {
      result.skipped_surfaced++;
      continue;
    }

    // Health Lane: Conflicted entries or active contradictions
    if (e.status === "conflicted") {
      result.routed.health.push({
        id: e.id,
        title: e.title,
        lane: "health",
        summary: `Contradiction detected: ${e.title}`,
      });
      state.surfaced_ids[e.id] = todayIso;
      state.item_hashes[hash] = todayIso;
      continue;
    }

    // System Lane: Bug fixes, operational rules
    if (e.type === "fix" || e.type === "operation" || (e.tags && e.tags.includes("distilled-fix"))) {
      result.routed.system.push({
        id: e.id,
        title: e.title,
        lane: "system",
        summary: e.content.slice(0, 150),
      });
      state.surfaced_ids[e.id] = todayIso;
      state.item_hashes[hash] = todayIso;
      continue;
    }

    // Content Lane: Architecture decisions and concepts
    if (e.type === "architecture" || e.type === "decision" || e.type === "adr" || (e.salience && e.salience >= 0.8)) {
      result.routed.content.push({
        id: e.id,
        title: e.title,
        lane: "content",
        summary: e.content.slice(0, 150),
      });
      state.surfaced_ids[e.id] = todayIso;
      state.item_hashes[hash] = todayIso;
      continue;
    }
  }

  result.total_routed =
    result.routed.system.length + result.routed.content.length + result.routed.health.length;

  if (!options?.dryRun && result.total_routed > 0) {
    state.last_run = todayIso;
    try {
      writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
    } catch {
      // ignore state write failure if memoryDir is read-only
    }

    // Stage draft files for content lane if .agents/drafts exists or can be created
    if (result.routed.content.length > 0) {
      const draftsDir = join(root, ".agents", "drafts");
      try {
        mkdirSync(draftsDir, { recursive: true });
        for (const item of result.routed.content) {
          const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
          const draftPath = join(draftsDir, `draft-${slug}.md`);
          const body = `# ${item.title}\n\n> Sourced from Memory ID: \`${item.id}\`\n\n${item.summary}\n`;
          if (scanSecrets(body).length === 0) {
            writeFileSync(draftPath, body, "utf8");
            item.path = draftPath;
          }
        }
      } catch {
        // ignore draft writing errors in hermetic test envs
      }
    }
  }

  return result;
}
