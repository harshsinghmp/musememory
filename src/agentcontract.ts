import { existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

/**
 * muse-agents ↔ musememory integration contract (SOW-106).
 * An agent markdown file may declare an optional `memory:` frontmatter block:
 *
 *   memory:
 *     scope: project | global
 *     types: [fix, architecture]
 *     tags: [backend]
 *
 * Absent or malformed block = backward-compatible default (no filtering).
 */
export interface AgentMemoryContract {
  scope?: "project" | "global";
  types?: string[];
  tags?: string[];
}

/** Parse the `memory:` contract from agent markdown content. Returns null when absent/unusable. */
export function parseAgentMemoryContract(markdown: string): AgentMemoryContract | null {
  if (!markdown || !markdown.startsWith("---")) return null;
  const end = markdown.indexOf("\n---", 3);
  if (end === -1) return null;
  let doc: unknown;
  try {
    doc = yaml.load(markdown.slice(4, end), { schema: yaml.JSON_SCHEMA });
  } catch {
    return null;
  }
  const mem = (doc as { memory?: unknown })?.memory;
  if (!mem || typeof mem !== "object") return null;
  const m = mem as Record<string, unknown>;
  const contract: AgentMemoryContract = {};
  if (m.scope === "project" || m.scope === "global") contract.scope = m.scope;
  if (Array.isArray(m.types)) contract.types = m.types.filter((t): t is string => typeof t === "string");
  if (Array.isArray(m.tags)) contract.tags = m.tags.filter((t): t is string => typeof t === "string");
  if (!contract.scope && !contract.types?.length && !contract.tags?.length) return null;
  return contract;
}

/**
 * Resolve a --for-agent value to an agent markdown file.
 * Accepts an explicit path, else probes `<root>/.agents/<name>.md`,
 * `<root>/.memory/agents/<name>.md`, then the OpenCode agents dir.
 */
export function resolveAgentFile(nameOrPath: string, workspaceRoot: string): string | null {
  if (!nameOrPath) return null;
  if (existsSync(nameOrPath)) return nameOrPath;
  const candidates = [
    join(workspaceRoot, ".agents", `${nameOrPath}.md`),
    join(workspaceRoot, ".memory", "agents", `${nameOrPath}.md`),
  ];
  const home = process.env.HOME;
  if (home) candidates.push(join(home, ".config", "opencode", "agents", `${nameOrPath}.md`));
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}
