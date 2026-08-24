import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { openStore, propose, get, save } from "../src/store.ts";
import { verifyEntry } from "../src/verify.ts";
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

  test("test_command passes schema validation", () => {
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
  });
});
