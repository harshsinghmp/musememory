import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { homedir } from "node:os";
import { getGlobalMemoryDir } from "../root.ts";
import { openStore, propose, list, type Store } from "../store.ts";
import { scanSecrets, redactSecrets } from "../secrets.ts";
import type { ParsedArgs } from "./shared.ts";

export interface LifeosNote {
  path: string;
  relPath: string;
  title: string;
  content: string;
  category: string;
}

export interface ParsedLifeosTree {
  principal: string;
  telos: string;
  da: string;
  rules: string;
  projects: string;
  techStack: string;
  notes: LifeosNote[];
  totalFiles: number;
  secretsDetected: number;
}

export interface ImportLifeosOptions {
  fromDir?: string;
  targetDir?: string;
  dryRun?: boolean;
  confirm?: boolean;
  overwriteUserMd?: boolean;
}

export interface ImportLifeosResult {
  sourceDir: string;
  targetDir: string;
  filesFound: number;
  memoriesImported: number;
  userMdUpdated: boolean;
  sanitizedSecretsCount: number;
  errors: string[];
  importedMemoryIds: string[];
}

function safeRead(filePath: string): string {
  try {
    if (existsSync(filePath)) {
      return readFileSync(filePath, "utf8");
    }
  } catch {
    // Ignore unreadable files
  }
  return "";
}

/**
 * Recursively find all markdown files in a directory.
 */
function walkMarkdownFiles(dir: string, baseDir: string = dir): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip cache or hidden folders
      if (entry.name === "CACHE" || entry.name.startsWith(".")) continue;
      results.push(...walkMarkdownFiles(fullPath, baseDir));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Parse LifeOS user tree into structured sections and documents.
 */
export function parseLifeosUserTree(userDir: string): ParsedLifeosTree {
  let secretsDetected = 0;

  // 1. Core Identity & Telos files
  const principalRaw =
    safeRead(join(userDir, "PRINCIPAL", "PRINCIPAL_IDENTITY.md")) ||
    safeRead(join(userDir, "PRINCIPAL_IDENTITY.md")) ||
    safeRead(join(userDir, "ABOUTME.md")) ||
    safeRead(join(userDir, "BASICINFO.md"));

  const telosRaw =
    safeRead(join(userDir, "TELOS", "PRINCIPAL_TELOS.md")) ||
    safeRead(join(userDir, "PRINCIPAL_TELOS.md"));

  const daRaw =
    safeRead(join(userDir, "DIGITAL_ASSISTANT", "DA_IDENTITY.md")) ||
    safeRead(join(userDir, "DA_IDENTITY.md"));

  const rulesRaw =
    safeRead(join(userDir, "CONFIG", "OPERATIONAL_RULES.md")) ||
    safeRead(join(userDir, "OPERATIONAL_RULES.md"));

  const projectsRaw = safeRead(join(userDir, "PROJECTS.md"));
  const techStackRaw = safeRead(join(userDir, "TECHSTACKPREFERENCES.md"));

  // Check secrets on core files
  for (const raw of [principalRaw, telosRaw, daRaw, rulesRaw, projectsRaw, techStackRaw]) {
    const found = scanSecrets(raw);
    if (found.length > 0) secretsDetected += found.length;
  }

  // 2. Discover all markdown files for knowledge ingestion
  const allMdFiles = walkMarkdownFiles(userDir);
  const notes: LifeosNote[] = [];

  const coreRelativePaths = new Set([
    "PRINCIPAL/PRINCIPAL_IDENTITY.md",
    "PRINCIPAL_IDENTITY.md",
    "TELOS/PRINCIPAL_TELOS.md",
    "PRINCIPAL_TELOS.md",
    "DIGITAL_ASSISTANT/DA_IDENTITY.md",
    "DA_IDENTITY.md",
    "CONFIG/OPERATIONAL_RULES.md",
    "OPERATIONAL_RULES.md",
    "PROJECTS.md",
    "TECHSTACKPREFERENCES.md",
    "README.md",
  ]);

  for (const filePath of allMdFiles) {
    const rel = relative(userDir, filePath);
    if (coreRelativePaths.has(rel)) continue;

    const contentRaw = safeRead(filePath);
    if (!contentRaw.trim()) continue;

    const found = scanSecrets(contentRaw);
    if (found.length > 0) secretsDetected += found.length;

    const parts = rel.split("/");
    const category = parts.length > 1 ? parts[0] : "general";
    const nameWithoutExt = basename(filePath, ".md").replace(/[-_]/g, " ");
    const title = `LifeOS: ${nameWithoutExt}`;

    notes.push({
      path: filePath,
      relPath: rel,
      title,
      content: redactSecrets(contentRaw),
      category: category.toLowerCase(),
    });
  }

  return {
    principal: redactSecrets(principalRaw),
    telos: redactSecrets(telosRaw),
    da: redactSecrets(daRaw),
    rules: redactSecrets(rulesRaw),
    projects: redactSecrets(projectsRaw),
    techStack: redactSecrets(techStackRaw),
    notes,
    totalFiles: allMdFiles.length,
    secretsDetected,
  };
}

/**
 * Compile sovereign USER.md from parsed LifeOS data.
 */
export function compileSovereignUserMd(parsed: ParsedLifeosTree): string {
  const sections: string[] = [
    `# Sovereign Principal & Agency User Profile (USER.md)`,
    `> **Sovereign Agent Context**: Migrated from LifeOS into Muse Memory. This document serves as the universal user persona, telos, and agency orchestrator contract across all coding agents.`,
  ];

  if (parsed.principal.trim()) {
    sections.push(`\n## 👤 Principal Identity\n\n${parsed.principal.trim()}`);
  }

  if (parsed.telos.trim()) {
    sections.push(`\n## 🎯 Principal Telos & Vision\n\n${parsed.telos.trim()}`);
  }

  if (parsed.da.trim()) {
    sections.push(`\n## 🏛️ Digital Assistant & Agency Council\n\n${parsed.da.trim()}`);
  }

  if (parsed.rules.trim()) {
    sections.push(`\n## ⚡ Operational Invariants & Rules\n\n${parsed.rules.trim()}`);
  }

  if (parsed.projects.trim()) {
    sections.push(`\n## 📂 Active Projects & Portfolios\n\n${parsed.projects.trim()}`);
  }

  if (parsed.techStack.trim()) {
    sections.push(`\n## 🛠️ Tech Stack & Preferences\n\n${parsed.techStack.trim()}`);
  }

  sections.push(`\n---\n*Auto-generated by \`muse import-lifeos\` on ${new Date().toISOString()}.*`);

  return sections.join("\n");
}

/**
 * Ingest LifeOS USER tree into Muse Memory and synthesize USER.md.
 */
export async function importLifeos(options: ImportLifeosOptions = {}): Promise<ImportLifeosResult> {
  const sourceDir = options.fromDir || process.env.LIFEOS_USER_DIR || join(homedir(), ".config", "LIFEOS", "USER");
  const targetDir = options.targetDir || getGlobalMemoryDir();
  const dryRun = Boolean(options.dryRun);

  const errors: string[] = [];
  const importedMemoryIds: string[] = [];
  let memoriesImported = 0;
  let userMdUpdated = false;

  if (!existsSync(sourceDir)) {
    throw new Error(`Source LifeOS directory does not exist: ${sourceDir}`);
  }

  const parsed = parseLifeosUserTree(sourceDir);

  // 1. Synthesize USER.md
  const compiledUserMd = compileSovereignUserMd(parsed);
  const targetUserMdPath = join(targetDir, "USER.md");

  if (!dryRun) {
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }
    writeFileSync(targetUserMdPath, compiledUserMd, "utf8");
    userMdUpdated = true;
  } else {
    userMdUpdated = true; // Preview indicates it will be updated
  }

  // 2. Ingest notes into SQLite memory store
  let store: Store | undefined;
  if (!dryRun) {
    store = openStore(targetDir);
  }

  // Fetch existing memories to avoid duplicate imports
  const existingTitles = new Set<string>();
  if (store) {
    const existing = list(store).filter((e) => e.tags?.includes("lifeos-import"));
    for (const entry of existing) {
      existingTitles.add(entry.title.toLowerCase());
    }
  }

  for (const note of parsed.notes) {
    if (existingTitles.has(note.title.toLowerCase())) {
      continue;
    }

    const memoryId = `m_${Date.now()}_lifeos_${Math.random().toString(36).slice(2, 7)}`;
    importedMemoryIds.push(memoryId);
    memoriesImported++;

    if (!dryRun && store) {
      try {
        propose(store, {
          id: memoryId,
          content: note.content,
          title: note.title,
          project: "global",
          type: "operation",
          confirmed: true,
          tags: ["lifeos-import", note.category],
          source: `lifeos://${note.relPath}`,
        });
        existingTitles.add(note.title.toLowerCase());
      } catch (err: any) {
        errors.push(`Failed to import ${note.relPath}: ${err.message}`);
      }
    }
  }

  return {
    sourceDir,
    targetDir,
    filesFound: parsed.totalFiles,
    memoriesImported,
    userMdUpdated,
    sanitizedSecretsCount: parsed.secretsDetected,
    errors,
    importedMemoryIds,
  };
}

/**
 * CLI Handler for `memory import-lifeos` / `muse import-lifeos`.
 */
export async function handleImportLifeosCommand(args: ParsedArgs): Promise<number> {
  const fromDir = args.flags.from || process.env.LIFEOS_USER_DIR || join(homedir(), ".config", "LIFEOS", "USER");
  const targetDir = args.flags.target || (args.flags.local ? undefined : getGlobalMemoryDir());
  const dryRun = Boolean(args.flags["dry-run"]);

  console.log(`\n🧠 Sovereign LifeOS Ingestion Engine`);
  console.log(`─────────────────────────────────────────────────────────────`);
  console.log(`Source LifeOS Path : ${fromDir}`);
  console.log(`Target Memory Path : ${targetDir || "./.memory"}`);
  console.log(`Mode               : ${dryRun ? "🔍 Dry Run (preview only)" : "🚀 Live Ingestion"}`);

  if (!existsSync(fromDir)) {
    console.error(`\n❌ Error: Source directory does not exist: ${fromDir}`);
    console.error(`If LifeOS is located elsewhere, specify --from <path>`);
    return 1;
  }

  try {
    const result = await importLifeos({
      fromDir,
      targetDir,
      dryRun,
    });

    console.log(`\n📋 Ingestion Results:`);
    console.log(`  - Files scanned      : ${result.filesFound}`);
    console.log(`  - Notes to memories  : ${result.memoriesImported}`);
    console.log(`  - USER.md updated    : ${result.userMdUpdated ? "✅ Yes" : "❌ No"}`);
    console.log(`  - Secrets sanitized  : ${result.sanitizedSecretsCount} (via Vibeguard)`);

    if (result.errors.length > 0) {
      console.warn(`\n⚠️ Warnings / Errors encountered:`);
      for (const err of result.errors) {
        console.warn(`  - ${err}`);
      }
    }

    if (dryRun) {
      console.log(`\n✨ Dry-run complete. Run without --dry-run to commit changes.`);
    } else {
      console.log(`\n✅ Sovereign LifeOS ingestion complete! Data safely residing in Muse Memory.`);
    }

    return 0;
  } catch (err: any) {
    console.error(`\n❌ Ingestion failed: ${err.message}`);
    return 1;
  }
}
