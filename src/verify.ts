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
