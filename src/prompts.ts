import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PromptTemplate } from "./types.ts";

export type { PromptTemplate };

export const BUILTIN_PROMPTS: PromptTemplate[] = [
  {
    name: "morning-standup",
    title: "Morning Cognitive Standup & Invariant Briefing",
    description: "Gathers overdue items, active constraints, and recent session discoveries.",
    variables: ["date", "focus"],
    tags: ["standup", "planning", "governance"],
    template: `### Morning Cognitive Standup Briefing
Date: {{date}}
Focus: {{focus}}

#### 1. Active Working Constraints (CURRENT.md)
{{current_constraints}}

#### 2. Overdue & Due-Soon Action Items
{{overdue_items}}

#### 3. Recent Discoveries & Fixes
{{recent_discoveries}}

#### Strategic Question:
What is the highest-leverage task to execute today that satisfies all active invariants?`,
  },
  {
    name: "drift-audit",
    title: "CodeGraph AST Drift Audit",
    description: "Compares CodeGraph AST symbols against confirmed architectural memories.",
    variables: ["project"],
    tags: ["ast", "drift", "audit"],
    template: `### AST Symbol Drift Audit
Project: {{project}}

#### 1. Confirmed Architectural Memories & Referenced Symbols
{{arch_memories}}

#### 2. AST Drift Status
Scan workspace codebase symbols against memory references. Flag any symbols that were renamed, deleted, or signature-changed without corresponding memory updates.`,
  },
  {
    name: "pre-publish-audit",
    title: "Pre-Publish & Delivery Gate Audit",
    description: "Scans diffs for secrets, unverified claims, and broken references.",
    variables: ["target"],
    tags: ["security", "claims", "verification"],
    template: `### Pre-Publish Delivery Gate Audit
Target: {{target}}

1. **Vibeguard Secret Check**: Zero API keys, private tokens, or connection strings in code or documentation.
2. **Claim Ledger Verification**: All claims tagged with [RAW], [FETCH], [SEARCH], or [INFER] must have valid source references.
3. **Wikilink & Reference Integrity**: Verify that all interlinked concepts and memory IDs resolve cleanly.
4. **Test Suite Status**: Confirm all unit and integration tests pass with 0 failures.`,
  },
  {
    name: "sprint-compounding",
    title: "Sprint Knowledge Compounding & Wiki Synthesis",
    description: "Clusters candidate memories and triggers wiki compilation.",
    variables: ["period"],
    tags: ["compounding", "wiki", "synthesis"],
    template: `### Sprint Knowledge Compounding
Period: {{period}}

1. Review candidate memories and cluster related insights.
2. Promote verified candidates to confirmed status.
3. Mark superseded and decaying entries as stale.
4. Compile Obsidian-compatible wiki concept pages and update .memory/HOT.md working memory cache.`,
  },
];

export function getPromptsDir(memoryDir?: string): string | null {
  if (!memoryDir) return null;
  return join(memoryDir, "prompts");
}

export function listPrompts(memoryDir?: string): PromptTemplate[] {
  const promptMap = new Map<string, PromptTemplate>();

  for (const bp of BUILTIN_PROMPTS) {
    promptMap.set(bp.name, bp);
  }

  const dir = getPromptsDir(memoryDir);
  if (dir && existsSync(dir)) {
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const name = file.replace(/\.md$/, "");
      const fullPath = join(dir, file);
      try {
        const raw = readFileSync(fullPath, "utf-8");
        const parsed = parsePromptFile(name, raw);
        promptMap.set(name, parsed);
      } catch {}
    }
  }

  return Array.from(promptMap.values());
}

export function getPrompt(memoryDir: string | undefined, name: string): PromptTemplate | null {
  const safeName = name.replace(/[^a-zA-Z0-9_\-\.]/g, "_");
  const dir = getPromptsDir(memoryDir);
  if (dir) {
    const filePath = join(dir, `${safeName}.md`);
    if (existsSync(filePath)) {
      try {
        const raw = readFileSync(filePath, "utf-8");
        return parsePromptFile(name, raw);
      } catch {}
    }
  }

  return BUILTIN_PROMPTS.find((p) => p.name === name) ?? null;
}

export function savePrompt(memoryDir: string, prompt: PromptTemplate): void {
  const safeName = prompt.name.replace(/[^a-zA-Z0-9_\-\.]/g, "_");
  const dir = join(memoryDir, "prompts");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${safeName}.md`);

  const frontmatter = [
    "---",
    `name: ${prompt.name}`,
    `title: ${prompt.title}`,
    `description: ${prompt.description}`,
    prompt.variables ? `variables: [${prompt.variables.join(", ")}]` : null,
    prompt.tags ? `tags: [${prompt.tags.join(", ")}]` : null,
    "---",
    "",
    prompt.template,
  ]
    .filter(Boolean)
    .join("\n");

  writeFileSync(filePath, frontmatter, "utf-8");
}

function parsePromptFile(name: string, content: string): PromptTemplate {
  if (content.startsWith("---")) {
    const parts = content.split("---");
    if (parts.length >= 3) {
      const yamlBlock = parts[1];
      const template = parts.slice(2).join("---").trim();
      let title = name;
      let description = "";
      const variables: string[] = [];
      const tags: string[] = [];

      for (const line of yamlBlock.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("title:")) title = trimmed.replace("title:", "").trim();
        if (trimmed.startsWith("description:")) description = trimmed.replace("description:", "").trim();
        if (trimmed.startsWith("variables:")) {
          const match = trimmed.match(/\[(.*?)\]/);
          if (match) {
            variables.push(...match[1].split(",").map((v) => v.trim()).filter(Boolean));
          }
        }
        if (trimmed.startsWith("tags:")) {
          const match = trimmed.match(/\[(.*?)\]/);
          if (match) {
            tags.push(...match[1].split(",").map((t) => t.trim()).filter(Boolean));
          }
        }
      }

      return {
        name,
        title,
        description,
        template,
        variables: variables.length > 0 ? variables : undefined,
        tags: tags.length > 0 ? tags : undefined,
      };
    }
  }

  return {
    name,
    title: name,
    description: "",
    template: content.trim(),
  };
}

export function renderPrompt(
  memoryDir: string | undefined,
  name: string,
  args: Record<string, string> = {},
  contextData: Record<string, any> = {},
): string {
  const prompt = getPrompt(memoryDir, name);
  if (!prompt) {
    throw new Error(`Prompt template "${name}" not found`);
  }

  let text = prompt.template;

  // 1. Injected dynamic defaults
  const nowStr = args.date ?? new Date().toISOString().split("T")[0];
  text = text.replace(/\{\{date\}\}/g, nowStr);
  text = text.replace(/\{\{focus\}\}/g, args.focus ?? "General Development");
  text = text.replace(/\{\{project\}\}/g, args.project ?? "core");
  text = text.replace(/\{\{target\}\}/g, args.target ?? "release");
  text = text.replace(/\{\{period\}\}/g, args.period ?? "current sprint");

  // 2. Dynamic context injections
  if (memoryDir) {
    const currentPath = join(memoryDir, "CURRENT.md");
    let currentConstraints = "*(None recorded)*";
    if (existsSync(currentPath)) {
      currentConstraints = readFileSync(currentPath, "utf-8").trim();
    }
    text = text.replace(/\{\{current_constraints\}\}/g, currentConstraints);
    text = text.replace(/\{\{overdue_items\}\}/g, contextData.overdue_items ?? "*(No overdue items)*");
    text = text.replace(/\{\{recent_discoveries\}\}/g, contextData.recent_discoveries ?? "*(None recorded)*");
    text = text.replace(/\{\{arch_memories\}\}/g, contextData.arch_memories ?? "*(See .memory/memories/)*");
  }

  // 3. User supplied arguments
  for (const [key, val] of Object.entries(args)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    text = text.replace(regex, val);
  }

  return text;
}
