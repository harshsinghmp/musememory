import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

/**
 * The Landing Gate's own regression tests.
 *
 * The gate exists because a close-out document once described two complete
 * waves of work as "landed, verified on `dev`" while `dev` did not contain
 * them — the work was committed locally, never pushed, and never reviewed.
 * The code was correct and every test was green. The failure was a false
 * claim about the remote that nothing had checked.
 *
 * So the gate itself needs cover. If someone weakens it — makes it pass on an
 * unpushed branch, or on a branch that was never merged — the exact failure
 * becomes possible again, silently. These tests pin the failing behaviour,
 * not just the passing behaviour.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const GATE = join(ROOT, "scripts", "check-landed.ts");

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Gate Test",
  GIT_AUTHOR_EMAIL: "gate@test.invalid",
  GIT_COMMITTER_NAME: "Gate Test",
  GIT_COMMITTER_EMAIL: "gate@test.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function git(cwd: string, args: string[]): { code: number; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
  return { code: r.status ?? 1, out: (r.stdout ?? "").trim() };
}

function runGate(cwd: string, args: string[] = []): { code: number; out: string } {
  const r = spawnSync("bun", [GATE, ...args], { cwd, encoding: "utf8", env: GIT_ENV });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("The Landing Gate", () => {
  let tmp: string;
  let origin: string;
  let work: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "muse-landing-gate-"));
    origin = join(tmp, "origin.git");
    work = join(tmp, "work");

    // A bare repo standing in for the remote, and a clone of it.
    expect(git(tmp, ["init", "--bare", "--initial-branch=dev", origin]).code).toBe(0);
    expect(git(tmp, ["clone", origin, work]).code).toBe(0);
    expect(git(work, ["config", "user.email", "gate@test.invalid"]).code).toBe(0);
    expect(git(work, ["config", "user.name", "Gate Test"]).code).toBe(0);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  /** Seed `dev` with one commit and push it, so `origin/dev` exists. */
  function seedIntegrationBranch(): void {
    expect(git(work, ["checkout", "-B", "dev"]).code).toBe(0);
    expect(git(work, ["commit", "--allow-empty", "-m", "seed"]).code).toBe(0);
    expect(git(work, ["push", "origin", "dev"]).code).toBe(0);
  }

  /** A feature branch with one commit that was never pushed. */
  function seedUnpushedFeatureBranch(): string {
    expect(git(work, ["checkout", "-b", "fix/feature"]).code).toBe(0);
    expect(git(work, ["commit", "--allow-empty", "-m", "feature work"]).code).toBe(0);
    return "fix/feature";
  }

  describe("the failure it exists to prevent", () => {
    it("FAILS on a branch whose commit was never pushed", () => {
      seedIntegrationBranch();
      seedUnpushedFeatureBranch();

      const gate = runGate(work, ["--integration", "dev", "--no-fetch"]);

      expect(gate.code).toBe(1);
      expect(gate.out).toContain("RESULT: LOCAL");
      expect(gate.out).toContain("LOCAL");
      expect(gate.out).not.toContain("RESULT: LANDED");
    });

    it("FAILS on a branch that was pushed but never merged into the integration branch", () => {
      seedIntegrationBranch();
      seedUnpushedFeatureBranch();
      expect(git(work, ["push", "origin", "fix/feature"]).code).toBe(0);

      const gate = runGate(work, ["--integration", "dev", "--no-fetch"]);

      expect(gate.code).toBe(1);
      expect(gate.out).toContain("RESULT: LOCAL");
      expect(gate.out).toContain("is NOT an ancestor");
    });

    it("FAILS when the integration branch does not exist on the remote", () => {
      // No seedIntegrationBranch() — origin/dev does not exist yet.
      expect(git(work, ["checkout", "-b", "fix/feature"]).code).toBe(0);
      expect(git(work, ["commit", "--allow-empty", "-m", "work"]).code).toBe(0);

      const gate = runGate(work, ["--integration", "dev", "--no-fetch"]);

      expect(gate.code).toBe(1);
      expect(gate.out).toContain("RESULT: LOCAL");
    });
  });

  describe("the passing case", () => {
    it("PASSES once the work is merged into the integration branch and pushed", () => {
      seedIntegrationBranch();
      seedUnpushedFeatureBranch();
      expect(git(work, ["push", "origin", "fix/feature"]).code).toBe(0);
      expect(git(work, ["checkout", "dev"]).code).toBe(0);
      expect(git(work, ["merge", "--ff-only", "fix/feature"]).code).toBe(0);
      expect(git(work, ["push", "origin", "dev"]).code).toBe(0);

      const gate = runGate(work, ["--integration", "dev", "--no-fetch"]);

      expect(gate.code).toBe(0);
      expect(gate.out).toContain("RESULT: LANDED");
      expect(gate.out).toContain("is an ancestor of");
    });
  });

  describe("pre-review mode", () => {
    it("FAILS when the branch was never pushed", () => {
      seedIntegrationBranch();
      seedUnpushedFeatureBranch();

      const gate = runGate(work, ["--pr", "--branch", "fix/feature", "--no-fetch"]);

      expect(gate.code).toBe(1);
      expect(gate.out).toContain("RESULT: NOT REVIEWABLE");
      expect(gate.out).toContain("never pushed");
    });
  });

  describe("the doctrine it encodes", () => {
    it("never prints a landed verdict alongside a failure", () => {
      seedIntegrationBranch();
      seedUnpushedFeatureBranch();

      const gate = runGate(work, ["--integration", "dev", "--no-fetch"]);

      // A report that quotes this output must not be able to read it as
      // "landed". The failure verdict is the only RESULT line.
      const results = gate.out.match(/RESULT: .*/g) ?? [];
      expect(results.length).toBe(1);
      expect(results[0]).toBe("RESULT: LOCAL");
      expect(gate.out).not.toContain("RESULT: LANDED");
    });

    it("uses verdicts that cannot be misread as each other", () => {
      // "RESULT: NOT LANDED" would contain "LANDED" as a substring — a report
      // quoting the output, or a grep for "LANDED", could read a failure as a
      // success. The failure verdicts are LOCAL and NOT REVIEWABLE.
      expect("RESULT: NOT LANDED".includes("RESULT: LANDED")).toBe(false);
      expect("RESULT: NOT READY FOR REVIEW".includes("RESULT: READY FOR REVIEW")).toBe(false);

      seedIntegrationBranch();
      seedUnpushedFeatureBranch();
      const gate = runGate(work, ["--integration", "dev", "--no-fetch"]);
      expect(gate.out).not.toContain("RESULT: LANDED");

      const prGate = runGate(work, ["--pr", "--branch", "fix/feature", "--no-fetch"]);
      expect(prGate.out).not.toContain("RESULT: REVIEWABLE");
    });

    it("tells the agent what to do next when it fails", () => {
      seedIntegrationBranch();
      seedUnpushedFeatureBranch();

      const gate = runGate(work, ["--integration", "dev", "--no-fetch"]);

      expect(gate.out).toContain("git push");
      expect(gate.out).toContain("gh pr create");
      expect(gate.out).toContain("Do not describe this work as landed");
    });
  });
});
