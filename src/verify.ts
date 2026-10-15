import { execFile } from "node:child_process";
import { resolve, sep } from "node:path";
import type { Store } from "./store.ts";
import { get, confirm, save } from "./store.ts";
import { recordAuditEvent } from "./audit.ts";
import type { AuditOperation, MemoryEntry } from "./types.ts";

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

/** Shell syntax that must never reach the parser unquoted. */
const SHELL_METACHARS = /[|;&$`><\r\n]/;

/**
 * Runtime flags that execute attacker-supplied code rather than checking anything.
 * The templates below already exclude them; the explicit list only buys a precise
 * refusal reason for the audit trail.
 */
const CODE_EXEC_FLAGS = new Set([
  "-e", "--eval", "-p", "--print", "--input-type",
  "-r", "--require", "--import", "--loader", "--experimental-loader", "--env-file",
]);

/** The only command shapes the oracle ever executes. Memory selects WHICH file, never WHAT code. */
const ALLOWED_TEMPLATES = ["bun test <relative-path>", "bunx tsc --noEmit", "node --check <relative-path>"];

export type ParsedCommand = { ok: true; argv: string[] } | { ok: false; error: string };

/** A path is usable only if it is relative, free of `..`, and stays inside the workspace root. */
function checkRelativePath(path: string, workspaceRoot?: string): string | null {
  if (!path) return "path is empty";
  if (path.includes("\0")) return "path contains a null byte";
  // A legitimate target is always a file path — a leading dash means flag
  // smuggling (`--preload=./evil.js`, `--import=./hook.mjs`), not a file.
  if (path.startsWith("-")) return `flag-like path '${path}' is not allowed — target must be a file`;
  if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(path)) {
    return `absolute path '${path}' is not allowed`;
  }
  if (path.split(/[\\/]/).includes("..")) return `'..' traversal is not allowed in '${path}'`;
  if (workspaceRoot) {
    const root = resolve(workspaceRoot);
    const full = resolve(root, path);
    if (full !== root && !full.startsWith(root + sep)) {
      return `path '${path}' resolves outside the workspace root`;
    }
  }
  return null;
}

/** Matches argv against the fixed templates; returns a refusal reason or null when it fits. */
function checkTemplate(argv: string[], workspaceRoot?: string): string | null {
  if (argv.length === 3 && argv[0] === "bun" && argv[1] === "test") {
    const pathError = checkRelativePath(argv[2], workspaceRoot);
    if (pathError) return pathError;
    // The oracle runs the test suite — the target must be a test file, never an
    // arbitrary script (`bun test ./evil.js` executes it).
    if (!/\.(test|spec)\.[jt]s$/.test(argv[2])) return `'${argv[2]}' is not a test file (expected *.test.ts or *.spec.js)`;
    return null;
  }
  if (argv.length === 3 && argv[0] === "node" && argv[1] === "--check") return checkRelativePath(argv[2], workspaceRoot);
  // Pinned verbatim: no extra flags, no project override, no second package.
  if (argv.length === 3 && argv[0] === "bunx" && argv[1] === "tsc" && argv[2] === "--noEmit") return null;
  return `command does not match an allowed template (allowed: ${ALLOWED_TEMPLATES.join(", ")})`;
}

/**
 * Parse a test_command into argv for direct exec. There is no shell: quoted spans
 * become inert argument text handed verbatim to the child, so a metacharacter only
 * carries meaning when it appears unquoted. Fails closed on any unquoted shell
 * syntax, an unterminated quote, an empty command, a code-execution flag, or any
 * command that is not one of the fixed templates.
 *
 * `workspaceRoot`, when given, additionally requires a relative path to resolve
 * inside it — the schema-time guard passes none and stays purely syntactic.
 */
export function parseTestCommand(command: string, workspaceRoot?: string): ParsedCommand {
  const argv: string[] = [];
  let current = "";
  let hasCurrent = false;
  let quote: '"' | "'" | null = null;

  for (const ch of command) {
    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasCurrent = true;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (hasCurrent) {
        argv.push(current);
        current = "";
        hasCurrent = false;
      }
      continue;
    }
    if (SHELL_METACHARS.test(ch)) {
      return { ok: false, error: `shell metacharacter '${ch === "\n" ? "\\n" : ch}' is not allowed` };
    }
    current += ch;
    hasCurrent = true;
  }

  if (quote) return { ok: false, error: "unterminated quote" };
  if (hasCurrent) argv.push(current);

  const binary = argv[0];
  if (!binary) return { ok: false, error: "empty command" };
  for (const arg of argv) {
    // Prefix-match on the `name` half so `--flag=value` single-token forms
    // cannot slip past the denylist by string inequality.
    if (CODE_EXEC_FLAGS.has(arg.split("=")[0])) {
      return { ok: false, error: `'${arg}' executes arbitrary code — not allowed in a test_command` };
    }
  }
  const templateError = checkTemplate(argv, workspaceRoot);
  if (templateError) return { ok: false, error: templateError };
  return { ok: true, argv };
}

function runCommand(argv: string[], cwd: string, timeoutSec: number): Promise<VerifyResult> {
  return new Promise((resolve) => {
    execFile(
      argv[0],
      argv.slice(1),
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
 * A refused command executes nothing and is audit-logged as `verify_refused`.
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

  const parsed = parseTestCommand(entry.test_command.trim(), workspaceRoot);
  if (!parsed.ok) {
    // Fail closed: nothing is executed and no `verify` event is written, but the
    // refusal leaves a forensic trace so an attacker probing the oracle is visible.
    if (memoryDir) {
      recordAuditEvent(memoryDir, {
        operation: "verify_refused",
        entry_id: id,
        project: entry.project,
        actor: "oracle",
        reason: "refused test_command",
        details: { error: parsed.error, command: entry.test_command },
      });
    }
    return { ok: false, ran: false, message: `refused test_command for ${id}: ${parsed.error}` };
  }

  const result = await runCommand(parsed.argv, workspaceRoot, options.timeout ?? 60);
  const nowIso = new Date(options.now ?? Date.now()).toISOString();

  if (result.ok) {
    const wasCandidate = entry.status === "candidate";
    let updated: MemoryEntry | null = entry;
    if (wasCandidate) {
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
        details: { exit_code: 0, promoted: wasCandidate, command: entry.test_command },
      });
    }
    return { ...result, message: `verified: ${result.message}${wasCandidate ? "; promoted to confirmed" : ""}` };
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

