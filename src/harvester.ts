import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import type { Store } from "./store.ts";
import { importTranscript, type TranscriptImportResult } from "./harvest.ts";
import { recordAuditEvent } from "./audit.ts";
import { requireRoot, type ParsedArgs, usageError } from "./cli/shared.ts";

export interface DiscoverOptions {
  searchRoots?: string[];
  maxFiles?: number;
}

export interface HarvestAllOptions {
  searchRoots?: string[];
  memoryDir?: string;
  confirmed?: boolean;
  project?: string;
  force?: boolean;
  maxFiles?: number;
}

export interface HarvestAllResult {
  harvestedFilesCount: number;
  totalFilesScanned: number;
  memoriesImported: number;
  openLoopsDetected: number;
  processedFiles: { path: string; imported: number; openLoops: number }[];
  errors: string[];
}

export interface TranscriptLedgerEntry {
  mtimeMs: number;
  hash: string;
  importedCount: number;
  openLoopsCount: number;
  harvestedAt: string;
}

/**
 * Returns common host directories where AI coding agents store session transcripts.
 */
export function getStandardAgentTranscriptDirs(home: string = homedir()): string[] {
  return [
    // 1. Antigravity / Gemini CLI Brain logs
    join(home, ".gemini", "antigravity-cli", "brain"),
    // 2. OpenCode / OpenAgent
    join(home, ".config", "opencode", "transcripts"),
    join(home, ".local", "share", "opencode", "transcripts"),
    // 3. Claude Code / LifeOS
    join(home, ".claude", "transcripts"),
    join(home, ".claude", "projects"),
    join(home, ".config", "LIFEOS", "runtime", "transcripts"),
    // 4. Hermes Agent
    join(home, ".hermes", "sessions"),
    join(home, ".hermes", "transcripts"),
    // 5. Goose
    join(home, ".config", "goose", "sessions"),
    // 6. Codex CLI
    join(home, ".codex", "sessions"),
    // 7. Cursor Workspace Storage
    join(home, ".config", "Cursor", "User", "workspaceStorage"),
    // 8. Local repository inbox / logs
    join(process.cwd(), ".memory", "inbox"),
    join(process.cwd(), ".logs"),
  ];
}

/**
 * Recursively searches a directory for *.jsonl transcript files.
 */
function findJsonlFilesInDir(dir: string, maxDepth: number = 4, currentDepth: number = 0, out: string[] = []): string[] {
  if (currentDepth > maxDepth || !existsSync(dir)) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const e of entries) {
    if (
      e.name === "node_modules" ||
      e.name === ".git" ||
      e.name === "dist" ||
      e.name === "processed" ||
      e.name === "chunks" ||
      e.name === ".cache" ||
      e.name === ".tmp" ||
      e.name.startsWith("tmp")
    ) {
      continue;
    }
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      findJsonlFilesInDir(full, maxDepth, currentDepth + 1, out);
    } else if (e.isFile() && e.name.endsWith(".jsonl")) {
      // Exclude chunk files and transcript_full.jsonl to keep scans sub-millisecond fast
      if (!e.name.match(/^\d{8}\.jsonl$/) && e.name !== "transcript_full.jsonl") {
        out.push(full);
      }
    }
  }
  return out;
}

/**
 * Probes the machine and returns all discovered agent transcript paths, sorted by last modified (newest first).
 */
export function discoverAgentTranscripts(options: DiscoverOptions = {}): string[] {
  const dirs = options.searchRoots && options.searchRoots.length > 0
    ? options.searchRoots
    : getStandardAgentTranscriptDirs();

  const found = new Set<string>();
  for (const d of dirs) {
    if (existsSync(d)) {
      try {
        const stat = statSync(d);
        if (stat.isDirectory()) {
          const files = findJsonlFilesInDir(d);
          for (const f of files) found.add(f);
        } else if (stat.isFile() && d.endsWith(".jsonl")) {
          found.add(d);
        }
      } catch {}
    }
  }

  const sorted = Array.from(found).sort((a, b) => {
    try {
      return statSync(b).mtimeMs - statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  });

  if (options.maxFiles && options.maxFiles > 0) {
    return sorted.slice(0, options.maxFiles);
  }
  return sorted;
}

/**
 * Reads the persistent transcript hash ledger from .memory/harvested-transcripts.json.
 */
export function getHarvestedTranscriptLedger(memoryDir: string): Record<string, TranscriptLedgerEntry> {
  const ledgerPath = join(memoryDir, "harvested-transcripts.json");
  if (!existsSync(ledgerPath)) return {};
  try {
    const raw = readFileSync(ledgerPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Saves the persistent transcript hash ledger.
 */
export function saveHarvestedTranscriptLedger(
  memoryDir: string,
  ledger: Record<string, TranscriptLedgerEntry>,
): void {
  const ledgerPath = join(memoryDir, "harvested-transcripts.json");
  const dir = dirname(ledgerPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n", "utf8");
}

/**
 * Universal Harvester: automatically discovers and ingests all AI agent transcripts across the host machine.
 */
export function harvestAllAgentTranscripts(
  store: Store,
  options: HarvestAllOptions = {},
): HarvestAllResult {
  const memoryDir = options.memoryDir || join(process.cwd(), ".memory");
  const ledger = getHarvestedTranscriptLedger(memoryDir);
  const files = discoverAgentTranscripts({
    searchRoots: options.searchRoots,
    maxFiles: options.maxFiles || 50,
  });

  const result: HarvestAllResult = {
    harvestedFilesCount: 0,
    totalFilesScanned: files.length,
    memoriesImported: 0,
    openLoopsDetected: 0,
    processedFiles: [],
    errors: [],
  };

  for (const filePath of files) {
    try {
      const stat = statSync(filePath);
      const prevEntry = ledger[filePath];

      // Skip if already processed and mtime hasn't changed (unless force: true)
      if (!options.force && prevEntry && prevEntry.mtimeMs === stat.mtimeMs) {
        continue;
      }

      let content = "";
      if (stat.size > 2 * 1024 * 1024) {
        const fd = openSync(filePath, "r");
        const bufferSize = 512 * 1024;
        const buffer = Buffer.alloc(bufferSize);
        const position = Math.max(0, stat.size - bufferSize);
        const bytesRead = readSync(fd, buffer, 0, bufferSize, position);
        closeSync(fd);
        content = buffer.toString("utf8", 0, bytesRead);
      } else {
        content = readFileSync(filePath, "utf8");
      }

      const contentHash = createHash("sha256").update(content).digest("hex").slice(0, 16);

      if (!options.force && prevEntry && prevEntry.hash === contentHash) {
        continue;
      }

      // Infer project name from file path or default
      let inferredProject = options.project;
      if (!inferredProject) {
        if (filePath.includes("/Projects/github/") || filePath.includes("/Projects/")) {
          const m = filePath.match(/\/Projects\/(?:github\/)?([^/]+)/);
          if (m) inferredProject = m[1];
        }
      }
      if (!inferredProject) inferredProject = "default";

      const importRes: TranscriptImportResult = importTranscript(store, content, {
        project: inferredProject,
        confirmed: options.confirmed === true,
        source: `auto_harvester:${filePath}`,
      });

      ledger[filePath] = {
        mtimeMs: stat.mtimeMs,
        hash: contentHash,
        importedCount: importRes.imported,
        openLoopsCount: importRes.openLoops.length,
        harvestedAt: new Date().toISOString(),
      };

      if (importRes.imported > 0 || importRes.openLoops.length > 0) {
        result.harvestedFilesCount++;
        result.memoriesImported += importRes.imported;
        result.openLoopsDetected += importRes.openLoops.length;
        result.processedFiles.push({
          path: filePath,
          imported: importRes.imported,
          openLoops: importRes.openLoops.length,
        });

        recordAuditEvent(memoryDir, {
          operation: "transcript_import",
          entry_id: filePath,
          actor: "auto-harvester",
          details: {
            imported: importRes.imported,
            open_loops: importRes.openLoops.length,
            inferred_project: inferredProject,
          },
        });
      }

      if (importRes.errors.length > 0) {
        result.errors.push(...importRes.errors.map((e) => `${filePath}: ${e}`));
      }
    } catch (err: any) {
      result.errors.push(`${filePath}: ${err.message || err}`);
    }
  }

  saveHarvestedTranscriptLedger(memoryDir, ledger);
  return result;
}

/**
 * Main CLI handler for `memory learn` and `memory harvest --all`.
 */
export async function handleLearnCommand({ flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;

  const isConfirmed = flags["confirmed"] === "true" || flags["confirm"] === "true";
  const force = flags["force"] === "true";
  const project = flags["project"];
  const maxFiles = flags["max"] ? parseInt(flags["max"], 10) : 50;

  console.log(`[Auto-Learner] Probing workstation for active AI agent transcripts...`);
  const res = harvestAllAgentTranscripts(ctx.store, {
    memoryDir: ctx.memoryDir,
    confirmed: isConfirmed,
    force,
    project,
    maxFiles,
  });

  console.log(`[Auto-Learner] Scanned ${res.totalFilesScanned} agent transcript files.`);
  if (res.harvestedFilesCount === 0) {
    console.log(`✓ Up to date. 0 new un-harvested turns found (all transcripts indexed).`);
    return 0;
  }

  console.log(`\n🎉 Distilled ${res.memoriesImported} new memories and ${res.openLoopsDetected} open loops from ${res.harvestedFilesCount} transcript(s):`);
  for (const p of res.processedFiles) {
    console.log(`  * ${p.path} -> +${p.imported} memories, +${p.openLoops} loops`);
  }

  if (res.errors.length > 0) {
    console.log(`\n⚠️ Warnings / Redactions during harvest:`);
    for (const err of res.errors.slice(0, 5)) {
      console.log(`  - ${err}`);
    }
  }

  console.log(`\n💡 Open 'memory ui' or run 'memory stats' to view your newly indexed cognitive graph.`);
  return 0;
}
