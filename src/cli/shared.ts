import { join } from "node:path";
import { findOrCreateProjectRoot } from "../root.ts";
import { openStore, type Store } from "../store.ts";
import type { MemoryEntry } from "../types.ts";

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string>;
}

export function parseFlags(args: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const [key, val] = a.slice(2).split("=");
      if (val !== undefined) {
        flags[key] = val;
      } else if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        flags[key] = args[++i];
      } else {
        flags[key] = "true";
      }
    } else if (a.startsWith("-")) {
      const key = a.slice(1);
      if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        flags[key] = args[++i];
      } else {
        flags[key] = "true";
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

export function requireRoot(flags: Record<string, string> = {}): { root: string; memoryDir: string; store: Store } | null {
  const isGlobal = flags["global"] === "true";
  const { root, memoryDir } = findOrCreateProjectRoot(process.cwd(), { global: isGlobal });
  return { root, memoryDir, store: openStore(memoryDir) };
}

export function printEntry(e: MemoryEntry, badge = false): void {
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
