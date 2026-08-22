import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import type { DetectedProvider } from "./types.ts";

export interface ProviderDefinition {
  id: string;
  name: string;
  category: "local-file" | "graph-rag" | "agent-harness" | "cloud-service";
  scope: "local" | "global" | "hybrid";
  paths: string[];
  description: string;
}

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  {
    id: "agentmemory",
    name: "AgentMemory",
    category: "local-file",
    scope: "global",
    paths: [
      "~/.agentmemory/standalone.json",
      "~/.agentmemory/engine-state.json",
      "~/.local/share/agentmemory/state_store.db",
      "~/.agentmemory"
    ],
    description: "Rust iii-engine state store and standalone JSON memories"
  },
  {
    id: "beads",
    name: "Beads",
    category: "local-file",
    scope: "local",
    paths: [
      ".beads/beads.json",
      ".beads"
    ],
    description: "Git-backed JSON issue and task memory beads"
  },
  {
    id: "mem0",
    name: "Mem0",
    category: "graph-rag",
    scope: "global",
    paths: [
      "~/.mem0/mem0.db",
      "~/.mem0/mem0.json",
      ".mem0/mem0.json",
      "~/.mem0"
    ],
    description: "User/Agent/Session scoped vector and graph store"
  },
  {
    id: "supermemory",
    name: "Supermemory",
    category: "graph-rag",
    scope: "hybrid",
    paths: [
      "~/.supermemory",
      "~/.opencode-supermemory.log",
      ".supermemory"
    ],
    description: "Temporal vector-graph engine logs and exports"
  },
  {
    id: "letta",
    name: "Letta Code / MemGPT",
    category: "agent-harness",
    scope: "global",
    paths: [
      "~/.letta",
      "~/.memgpt",
      ".letta"
    ],
    description: "Core memory (human/persona) blocks and archival store"
  },
  {
    id: "everos",
    name: "EverOS",
    category: "local-file",
    scope: "hybrid",
    paths: [
      ".everos/memories",
      ".everos",
      "~/.everos"
    ],
    description: "Markdown-native memory operating system files"
  },
  {
    id: "byterover",
    name: "ByteRover",
    category: "local-file",
    scope: "local",
    paths: [
      ".byterover/tree",
      ".byterover",
      "~/.byterover"
    ],
    description: "Hierarchical Markdown context tree by Domain/Topic"
  },
  {
    id: "kungfu",
    name: "Kungfu",
    category: "local-file",
    scope: "local",
    paths: [
      ".kungfu/checkpoints",
      ".kungfu",
      "~/.kungfu"
    ],
    description: "Agent work continuity checkpoints and verification logs"
  },
  {
    id: "memori",
    name: "Memori",
    category: "graph-rag",
    scope: "global",
    paths: [
      "~/.memori/memori.db",
      ".memori/memori.db",
      "~/.memori"
    ],
    description: "SQLite/Postgres episodic graph state"
  },
  {
    id: "cognee",
    name: "Cognee",
    category: "graph-rag",
    scope: "global",
    paths: [
      "~/.cognee",
      ".cognee/cognee.db",
      ".cognee"
    ],
    description: "Knowledge Graph RAG platform with LanceDB/Kuzu"
  },
  {
    id: "ace",
    name: "ACE (Kayba)",
    category: "agent-harness",
    scope: "local",
    paths: [
      ".ace/playbooks",
      ".ace",
      "~/.ace"
    ],
    description: "Agentic Context Engine autonomous strategy playbooks"
  },
  {
    id: "second-brain",
    name: "Second Brain Cloudflare / Obsidian",
    category: "cloud-service",
    scope: "global",
    paths: [
      "~/.second-brain",
      ".second-brain"
    ],
    description: "Cloudflare D1 + Vectorize second brain notes"
  },
  {
    id: "minimi",
    name: "Project Minimi",
    category: "local-file",
    scope: "global",
    paths: [
      "~/Library/Application Support/Minimi",
      "~/.minimi"
    ],
    description: "Ambient macOS context and open loops tracker"
  },
  {
    id: "pensieve",
    name: "Pensieve",
    category: "graph-rag",
    scope: "global",
    paths: [
      "~/.pensieve/vault",
      "~/.pensieve"
    ],
    description: "Enterprise connected knowledge graph vault"
  },
  {
    id: "actx",
    name: "Actx0",
    category: "cloud-service",
    scope: "hybrid",
    paths: [
      "~/.actx/cache.json",
      "~/.actx",
      ".actx"
    ],
    description: "Session history context cache and prompts"
  },
  {
    id: "hermes",
    name: "Hermes Agent",
    category: "local-file",
    scope: "global",
    paths: [
      "~/.hermes/memories",
      "~/.hermes/state.db",
      "~/.hermes/kanban.db",
      "~/.hermes"
    ],
    description: "Nous Research Hermes persistent memories and state database"
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    category: "local-file",
    scope: "global",
    paths: [
      "~/.openclaw/state",
      "~/.openclaw/workspace",
      "~/.openclaw"
    ],
    description: "OpenClaw personal assistant state snapshots and memory workspace"
  },
  {
    id: "crush",
    name: "Crush",
    category: "local-file",
    scope: "global",
    paths: [
      "~/.crush/crush.db",
      "~/.crush"
    ],
    description: "Charmbracelet Crush SQLite session and memory store"
  },
  {
    id: "pi",
    name: "Pi / OH-MY-PI",
    category: "local-file",
    scope: "global",
    paths: [
      "~/.pi",
      "~/.pi-mono"
    ],
    description: "Pi terminal agent skills, context, and session logs"
  },
  {
    id: "aider",
    name: "Aider",
    category: "local-file",
    scope: "hybrid",
    paths: [
      "~/.aider.chat.history.md",
      ".aider.chat.history.md",
      "~/.aider"
    ],
    description: "Aider markdown session history and chat transcripts"
  },
  {
    id: "continue",
    name: "Continue CLI",
    category: "local-file",
    scope: "global",
    paths: [
      "~/.continue/sessions",
      "~/.continue"
    ],
    description: "Continue IDE and CLI multi-model session logs"
  },
  {
    id: "cline",
    name: "Cline / Roo Code",
    category: "local-file",
    scope: "global",
    paths: [
      "~/.cline/tasks",
      "~/.roo/tasks",
      "~/.cline",
      "~/.roo"
    ],
    description: "Cline and Roo Code persistent task checkpoints and memory context"
  }
];

function expandPath(p: string, baseDir: string): string {
  if (p.startsWith("~/") || p === "~") {
    return join(homedir(), p.slice(1));
  }
  if (p.startsWith("/")) {
    return p;
  }
  return resolve(baseDir, p);
}

/**
 * Probes the local directory and global user environment for known agent memory providers.
 */
export function detectProviders(baseDir: string = process.cwd()): DetectedProvider[] {
  return PROVIDER_DEFINITIONS.map((def) => {
    const resolved = def.paths
      .map((p) => expandPath(p, baseDir))
      .filter((p) => {
        try {
          return existsSync(p);
        } catch {
          return false;
        }
      });

    const filtered: string[] = [];
    for (const p of resolved) {
      if (!filtered.some((existing) => existing === p || existing.startsWith(p + "/") || p.startsWith(existing + "/"))) {
        filtered.push(p);
      }
    }

    return {
      id: def.id,
      name: def.name,
      category: def.category,
      scope: def.scope,
      paths: def.paths,
      resolvedPaths: filtered,
      description: def.description,
      detected: filtered.length > 0
    };
  });
}
