import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { setupFixtureRoot, cleanup } from "./helpers.ts";

const BIN = join(import.meta.dir, "..", "bin", "memory.ts");

function run(root: string, args: string[]): { stdout: string; stderr: string; code: number } {
  const res = spawnSync("bun", [BIN, ...args], { cwd: root, encoding: "utf8" });
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", code: res.status ?? -1 };
}

describe("cli e2e", () => {
  test("propose -> search finds it -> confirm -> briefing excludes superseded", () => {
    const { root, memoryDir } = setupFixtureRoot();

    // propose with type
    const p = run(root, ["propose", "alpha service uses port 8080", "--project", "aria", "--title", "Alpha port", "--type", "architecture"]);
    expect(p.code).toBe(0);
    const idMatch = p.stdout.match(/created (m_\d+_\w+)/);
    expect(idMatch).not.toBeNull();
    const id1 = idMatch![1];

    // search finds it
    const s = run(root, ["search", "alpha port"]);
    expect(s.code).toBe(0);
    expect(s.stdout).toContain(id1);

    // write a disputed entry directly, then confirm it
    const disputedId = "m_999_disputed";
    writeFileSync(
      join(memoryDir, "memories", `${disputedId}.yaml`),
      `id: ${disputedId}\ntitle: Disputed thing\ncontent: disputed fact about alpha\nproject: aria\nstatus: disputed\ncreated_at: 2026-01-01T00:00:00Z\nupdated_at: 2026-01-01T00:00:00Z\nsource: test\ntags: [test]\n`,
    );
    const c = run(root, ["confirm", disputedId]);
    expect(c.code).toBe(0);
    expect(c.stdout).toContain("confirmed");

    // supersede id1 with a new confirmed entry
    const p2 = run(root, [
      "propose",
      "alpha service uses port 9090 now",
      "--project",
      "aria",
      "--title",
      "Alpha port v2",
      "--confirmed",
    ]);
    const id2 = p2.stdout.match(/created (m_\d+_\w+)/)![1];
    const su = run(root, ["supersede", id1, "--with", id2]);
    expect(su.code).toBe(0);

    // briefing excludes superseded
    const b = run(root, ["briefing"]);
    expect(b.code).toBe(0);
    expect(b.stdout).not.toContain(id1);
    expect(b.stdout).toContain(id2);
    cleanup(root);
  });

  test("capture and propose block probable secret", () => {
    const { root } = setupFixtureRoot();
    const c = run(root, ["capture", "the key is sk-proj-abc123def456ghi789jkl123456", "--project", "aria"]);
    expect(c.code).toBe(1);
    expect(c.stderr).toContain("probable secret detected");

    const p = run(root, ["propose", "my github token is ghp_123456789012345678901234567890123456", "--project", "aria"]);
    expect(p.code).toBe(1);
    expect(p.stderr).toContain("probable secret detected");
    cleanup(root);
  });

  test("capture creates entry without secrets", () => {
    const { root } = setupFixtureRoot();
    const c = run(root, ["capture", "the deploy uses git push", "--project", "aria", "--title", "Deploy note", "--type", "operation"]);
    expect(c.code).toBe(0);
    expect(c.stdout).toMatch(/created m_\d+_\w+/);
    cleanup(root);
  });

  test("mark-stale and reject CLI commands", () => {
    const { root } = setupFixtureRoot();
    const p = run(root, ["propose", "old fact", "--project", "aria"]);
    const id = p.stdout.match(/created (m_\d+_\w+)/)![1];
    const m = run(root, ["mark-stale", id, "--reason", "outdated"]);
    expect(m.code).toBe(0);
    expect(m.stdout).toContain("stale");

    const p2 = run(root, ["propose", "rejected approach", "--project", "aria"]);
    const id2 = p2.stdout.match(/created (m_\d+_\w+)/)![1];
    const r = run(root, ["reject", id2]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`rejected ${id2}`);
    cleanup(root);
  });

  test("link CLI command links two entries", () => {
    const { root } = setupFixtureRoot();
    const p1 = run(root, ["propose", "entry one", "--project", "aria"]);
    const id1 = p1.stdout.match(/created (m_\d+_\w+)/)![1];
    const p2 = run(root, ["propose", "entry two", "--project", "aria"]);
    const id2 = p2.stdout.match(/created (m_\d+_\w+)/)![1];

    const l = run(root, ["link", id1, "--related", id2]);
    expect(l.code).toBe(0);
    expect(l.stdout).toContain(`linked ${id1} -> ${id2}`);
    cleanup(root);
  });

  test("recall filters by type/status/verified", () => {
    const { root } = setupFixtureRoot();
    const byType = run(root, ["recall", "deploy", "--type", "operation"]);
    expect(byType.code).toBe(0);
    expect(byType.stdout).toContain("m_1700000004000_newdeploy");
    expect(byType.stdout).not.toContain("m_1700000003000_olddeploy");

    const byStatus = run(root, ["recall", "deploy", "--status", "confirmed"]);
    expect(byStatus.stdout).toContain("m_1700000004000_newdeploy");

    const byVerified = run(root, ["recall", "login", "--verified"]);
    expect(byVerified.stdout).toContain("m_1700000009000_confirmed");
    cleanup(root);
  });

  test("validate CLI with --dry-run", () => {
    const { root } = setupFixtureRoot();
    const val = run(root, ["validate", "--dry-run"]);
    expect(val.code).toBe(0);
    expect(val.stdout).toContain("[dry-run] validation report:");
    expect(val.stdout).toContain("entries valid");
    cleanup(root);
  });

  test("graph status CLI", () => {
    const { root } = setupFixtureRoot();
    const g1 = run(root, ["graph", "status"]);
    expect(g1.code).toBe(0);
    expect(g1.stdout).toContain("graph provider: none");

    mkdirSync(join(root, ".codegraph"), { recursive: true });
    const g2 = run(root, ["graph", "status"]);
    expect(g2.code).toBe(0);
    expect(g2.stdout).toContain("graph provider: codegraph");
    cleanup(root);
  });

  test("briefing shows recurring due entries", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const id = "m_999_recurring";
    writeFileSync(
      join(memoryDir, "memories", `${id}.yaml`),
      `id: ${id}\ntitle: Weekly backup\ncontent: run weekly backup\nproject: aria\nstatus: active\ntype: operation\ncreated_at: 2026-01-01T00:00:00Z\nupdated_at: 2026-01-01T00:00:00Z\nsource: test\ntags: [backup]\nrecurring:\n  interval: weekly\n  next_due: 2026-01-02T00:00:00Z\n`,
    );
    const b = run(root, ["briefing"]);
    expect(b.code).toBe(0);
    expect(b.stdout).toContain("recurring due:");
    expect(b.stdout).toContain(id);
    expect(b.stdout).toContain("recurring: weekly next_due: 2026-01-02T00:00:00Z");
    cleanup(root);
  });
});