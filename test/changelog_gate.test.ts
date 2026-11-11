import { describe, test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

function runGate(): { code: number; out: string } {
  try {
    const out = execFileSync("bun", ["scripts/check-changelog.ts", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (err: any) {
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("changelog coverage gate", () => {
  test("passes on the current tree", () => {
    const { code, out } = runGate();
    const parsed = JSON.parse(out);
    expect(parsed.uncovered).toEqual([]);
    expect(code).toBe(0);
  });

  test("reports the tag it measured from", () => {
    const parsed = JSON.parse(runGate().out);
    // Either a real vX.Y.Z tag or the explicit no-tag marker.
    expect(typeof parsed.since).toBe("string");
    expect(parsed.since.length).toBeGreaterThan(0);
    expect(typeof parsed.behavioural).toBe("number");
  });

  test("a docs-only commit needs no changelog entry", () => {
    // Exercise the real classifier rather than grepping the source: create a
    // throwaway branch, add a docs commit, and confirm the gate still passes.
    const original = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    execFileSync("git", ["checkout", "-q", "-b", "tmp/changelog-gate-docs"], { cwd: ROOT });
    try {
      execFileSync("git", ["commit", "--allow-empty", "-q", "-m", "docs(readme): clarify zorblax wording"], { cwd: ROOT });
      const { code } = runGate();
      expect(code).toBe(0);
    } finally {
      execFileSync("git", ["checkout", "-q", original], { cwd: ROOT });
      execFileSync("git", ["branch", "-D", "tmp/changelog-gate-docs"], { cwd: ROOT });
    }
  });

  test("a feat commit with no entry fails the gate", () => {
    const original = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    execFileSync("git", ["checkout", "-q", "-b", "tmp/changelog-gate-feat"], { cwd: ROOT });
    try {
      execFileSync("git", ["commit", "--allow-empty", "-q", "-m", "feat(quantum): add zorblax entanglement caching"], { cwd: ROOT });
      const { code, out } = runGate();
      expect(code).toBe(1);
      expect(JSON.parse(out).uncovered.length).toBeGreaterThan(0);
    } finally {
      execFileSync("git", ["checkout", "-q", original], { cwd: ROOT });
      execFileSync("git", ["branch", "-D", "tmp/changelog-gate-feat"], { cwd: ROOT });
    }
  });
});
