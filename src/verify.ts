import { execFile } from "node:child_process";
import type { Store } from "./store.ts";
import { get, confirm, save } from "./store.ts";
import { recordAuditEvent } from "./audit.ts";
import type { MemoryEntry } from "./types.ts";

export interface VerifyResult {
  ok: boolean;
  ran: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  message: string;
}

export interface VerifyOptions {
  /** Seconds before the command is killed (default 60). */
  timeout?: number;
  now?: number;
}

function runCommand(command: string, cwd: string, timeoutSec: number): Promise<VerifyResult> {
  return new Promise((resolve) => {
    execFile(
      "/bin/sh",
      ["-c", command],
      { cwd, timeout: timeoutSec * 1000, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (!err) {
          resolve({ ok: true, ran: true, exitCode: 0, stdout: String(stdout), stderr: String(stderr), message: "command exited 0" });
          return;
        }
        const e = err as NodeJS.ErrnoException & { code?: number | string; killed?: boolean };
        if (e.killed) {
          resolve({ ok: false, ran: true, timedOut: true, stdout: String(stdout), stderr: String(stderr), message: `timed out after ${timeoutSec}s` });
          return;
        }
        resolve({
          ok: false,
          ran: true,
          exitCode: typeof e.code === "number" ? e.code : -1,
          stdout: String(stdout),
          stderr: String(stderr),
          message: `command exited ${typeof e.code === "number" ? e.code : "nonzero"}`,
        });
      },
    );
  });
}

/**
 * Autonomous Verification Oracle:
 * executes a fix entry's test_command in the workspace root. Exit 0 promotes a
 * candidate to confirmed and stamps verification as independently-verified.
 * Non-zero leaves the entry untouched; both outcomes are audit-logged.
 * Never executes without an explicit verify invocation.
 */
export async function verifyEntry(
  store: Store,
  workspaceRoot: string,
  memoryDir: string | undefined,
  id: string,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const entry = get(store, id);
  if (!entry) {
    return { ok: false, ran: false, message: `no entry with id ${id}` };
  }
  if (entry.type !== "fix") {
    return { ok: false, ran: false, message: `entry ${id} is type '${entry.type ?? "unknown"}' — only 'fix' entries can be verified` };
  }
  if (entry.status !== "candidate" && entry.status !== "confirmed") {
    return { ok: false, ran: false, message: `entry ${id} has status '${entry.status}' — only candidate or confirmed entries can be verified` };
  }
  if (!entry.test_command || !entry.test_command.trim()) {
    return { ok: false, ran: false, message: `entry ${id} carries no test_command` };
  }

  const result = await runCommand(entry.test_command.trim(), workspaceRoot, options.timeout ?? 60);
  const nowIso = new Date(options.now ?? Date.now()).toISOString();

  if (result.ok) {
    let updated: MemoryEntry | null = entry;
    if (entry.status === "candidate") {
      updated = confirm(store, id);
    } else {
      updated = { ...entry };
    }
    if (updated) {
      updated.verification = {
        level: "independently-verified",
        method: "verification oracle",
        verified_at: nowIso,
        test_command: entry.test_command,
        test_result: "passed",
      };
      save(store, updated);
    }
    if (memoryDir) {
      recordAuditEvent(memoryDir, {
        operation: "verify",
        entry_id: id,
        project: entry.project,
        actor: "oracle",
        details: { exit_code: 0, promoted: entry.status === "candidate", command: entry.test_command },
      });
    }
    return { ...result, message: `verified: ${result.message}${entry.status === "candidate" ? "; promoted to confirmed" : ""}` };
  }

  // Failure: leave status untouched, log the attempt
  if (memoryDir) {
    recordAuditEvent(memoryDir, {
      operation: "verify",
      entry_id: id,
      project: entry.project,
      actor: "oracle",
      reason: result.timedOut ? "timeout" : "nonzero exit",
      details: {
        exit_code: result.exitCode,
        command: entry.test_command,
        output: `${result.stdout}\n${result.stderr}`.trim().slice(0, 2000),
      },
    });
  }
  return result;
}

export interface StrictCheckResult {
  name: string;
  passed: boolean;
  message: string;
  errors?: string[];
}

export interface StrictVerifyReport {
  ok: boolean;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  checks: StrictCheckResult[];
}

/**
 * Strict Integrity & Health Gate:
 * Evaluates Vibeguard secret zero-leakage, referential link integrity,
 * wikilink resolution, orphaned candidates, and claim-to-source completeness.
 */
export function verifyStrictIntegrity(
  store: Store,
  memoryDir: string,
  workspaceRoot?: string,
  options: { maxCandidateDays?: number } = {},
): StrictVerifyReport {
  const { existsSync, readFileSync, readdirSync } = require("node:fs");
  const { join } = require("node:path");
  const { scanSecrets } = require("./secrets.ts");
  const { list } = require("./store.ts");
  const { loadSources } = require("./provenance.ts");
  const { loadClaims } = require("./claims.ts");

  const checks: StrictCheckResult[] = [];
  const entries: MemoryEntry[] = list(store);
  const entryMap = new Map<string, MemoryEntry>(entries.map((e) => [e.id, e]));

  // 1. Secret Scanning Gate
  const secretErrors: string[] = [];
  for (const e of entries) {
    const text = `${e.title}\n${e.content}\n${(e.tags ?? []).join(" ")}`;
    const found = scanSecrets(text);
    if (found.length > 0) {
      secretErrors.push(`Secret detected in memory ${e.id}: ${found.join(", ")}`);
    }
  }
  const currentPath = join(memoryDir, "CURRENT.md");
  if (existsSync(currentPath)) {
    const found = scanSecrets(readFileSync(currentPath, "utf-8"));
    if (found.length > 0) secretErrors.push(`Secret detected in CURRENT.md: ${found.join(", ")}`);
  }
  const userPath = join(memoryDir, "USER.md");
  if (existsSync(userPath)) {
    const found = scanSecrets(readFileSync(userPath, "utf-8"));
    if (found.length > 0) secretErrors.push(`Secret detected in USER.md: ${found.join(", ")}`);
  }

  checks.push({
    name: "zero_secret_leakage",
    passed: secretErrors.length === 0,
    message: secretErrors.length === 0 ? "Zero secret credentials detected" : `Found ${secretErrors.length} leaked secret(s)`,
    errors: secretErrors.length > 0 ? secretErrors : undefined,
  });

  // 2. Referential Link Integrity Gate
  const refErrors: string[] = [];
  for (const e of entries) {
    if (e.supersedes) {
      const targets = Array.isArray(e.supersedes) ? e.supersedes : [e.supersedes];
      for (const t of targets) {
        if (t && !entryMap.has(t)) {
          refErrors.push(`Entry ${e.id} references non-existent supersedes ID: ${t}`);
        }
      }
    }
    if (e.superseded_by) {
      const targets = Array.isArray(e.superseded_by) ? e.superseded_by : [e.superseded_by];
      for (const t of targets) {
        if (t && !entryMap.has(t)) {
          refErrors.push(`Entry ${e.id} references non-existent superseded_by ID: ${t}`);
        }
      }
    }
    if (e.related_memory_ids) {
      for (const r of e.related_memory_ids) {
        if (!entryMap.has(r)) {
          refErrors.push(`Entry ${e.id} references non-existent related memory ID: ${r}`);
        }
      }
    }
  }

  checks.push({
    name: "referential_integrity",
    passed: refErrors.length === 0,
    message: refErrors.length === 0 ? "All graph links resolve cleanly" : `Found ${refErrors.length} broken reference(s)`,
    errors: refErrors.length > 0 ? refErrors : undefined,
  });

  // 3. Claim-to-Source Mapping Gate
  const claimErrors: string[] = [];
  const sources = loadSources(memoryDir);
  const sourceIds = new Set(sources.map((s: any) => s.id));
  const claims = loadClaims(memoryDir);

  for (const c of claims) {
    if (c.source_ids) {
      for (const sid of c.source_ids) {
        if (!sourceIds.has(sid)) {
          claimErrors.push(`Claim ${c.id} references missing source ID: ${sid}`);
        }
      }
    }
    if (c.memory_ids) {
      for (const mid of c.memory_ids) {
        if (!entryMap.has(mid)) {
          claimErrors.push(`Claim ${c.id} references missing memory ID: ${mid}`);
        }
      }
    }
  }

  checks.push({
    name: "claim_sources",
    passed: claimErrors.length === 0,
    message: claimErrors.length === 0 ? "All claims mapped to valid sources" : `Found ${claimErrors.length} unmapped claim reference(s)`,
    errors: claimErrors.length > 0 ? claimErrors : undefined,
  });

  // 4. Wikilink Resolution Gate
  const wikiErrors: string[] = [];
  const wikiDir = join(memoryDir, "wiki");
  if (existsSync(wikiDir)) {
    const knownSlugs = new Set<string>();
    function collectSlugs(dir: string) {
      const items = readdirSync(dir, { withFileTypes: true });
      for (const it of items) {
        const full = join(dir, it.name);
        if (it.isDirectory()) {
          collectSlugs(full);
        } else if (it.name.endsWith(".md")) {
          knownSlugs.add(it.name.replace(/\.md$/, "").toLowerCase());
          const { relative } = require("node:path");
          knownSlugs.add(relative(wikiDir, full).replace(/\.md$/, "").toLowerCase());
        }
      }
    }
    collectSlugs(wikiDir);
    for (const id of entryMap.keys()) {
      knownSlugs.add(id.toLowerCase());
    }

    function scanWikilinks(dir: string) {
      const items = readdirSync(dir, { withFileTypes: true });
      for (const it of items) {
        const full = join(dir, it.name);
        if (it.isDirectory()) {
          scanWikilinks(full);
        } else if (it.name.endsWith(".md")) {
          const content = readFileSync(full, "utf-8");
          const matches = content.matchAll(/\[\[([a-zA-Z0-9_\-\./ ]+?)(?:\|[^\r\n\]]+)?\]\]/g);
          for (const m of matches) {
            const rawTarget = m[1].trim().toLowerCase();
            if (!rawTarget || rawTarget.startsWith("type:") || rawTarget.startsWith("tag:") || rawTarget.length <= 1) {
              continue;
            }
            if (!knownSlugs.has(rawTarget)) {
              wikiErrors.push(`Wikilink [[${m[1]}]] in ${it.name} does not resolve to any wiki page.`);
            }
          }
        }
      }
    }
    scanWikilinks(wikiDir);
  }

  checks.push({
    name: "wikilink_resolution",
    passed: wikiErrors.length === 0,
    message: wikiErrors.length === 0 ? "All wikilinks resolve cleanly" : `Found ${wikiErrors.length} broken wikilink(s)`,
    errors: wikiErrors.length > 0 ? wikiErrors : undefined,
  });

  // 5. Orphaned Candidate Policy Gate
  const candidateErrors: string[] = [];
  const maxDays = options.maxCandidateDays ?? 90;
  const cutoff = Date.now() - maxDays * 86400000;

  for (const e of entries) {
    if (e.status === "candidate") {
      const created = new Date(e.created_at).getTime();
      if (!isNaN(created) && created < cutoff) {
        candidateErrors.push(`Candidate memory ${e.id} ("${e.title}") has been orphaned for > ${maxDays} days without review.`);
      }
    }
  }

  checks.push({
    name: "candidate_retention",
    passed: candidateErrors.length === 0,
    message: candidateErrors.length === 0 ? "No orphaned candidates" : `Found ${candidateErrors.length} orphaned candidate(s)`,
    errors: candidateErrors.length > 0 ? candidateErrors : undefined,
  });

  const failedChecks = checks.filter((c) => !c.passed).length;
  const passedChecks = checks.filter((c) => c.passed).length;

  return {
    ok: failedChecks === 0,
    totalChecks: checks.length,
    passedChecks,
    failedChecks,
    checks,
  };
}

