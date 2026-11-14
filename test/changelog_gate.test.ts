import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { isBehavioural, isCovered, tokens, coveredBody, behaviouralCommits, duplicateHeadings } from "../scripts/check-changelog.ts";

const ROOT = join(import.meta.dir, "..");

// These tests exercise the classifier directly rather than creating git
// commits. The first version built throwaway branches, which failed in CI:
// the checkout is detached and carries no author identity, so `git commit`
// aborted — and mutating the shared worktree from a test is unsound anyway.
describe("changelog coverage gate: classifier", () => {
  test("behavioural commit types require an entry", () => {
    expect(isBehavioural("feat(cli): add thing")).toBe(true);
    expect(isBehavioural("fix(sync): repair thing")).toBe(true);
    expect(isBehavioural("perf(cte): speed up thing")).toBe(true);
  });

  test("docs, chore, test, ci and style are exempt", () => {
    for (const subject of [
      "docs(readme): clarify wording",
      "chore(release): v3.4.0",
      "test(gate): cover the classifier",
      "ci: widen the trigger",
      "style(ui): reflow markup",
      "refactor(store): rename internals",
    ]) {
      expect(isBehavioural(subject)).toBe(false);
    }
  });

  test("a bullet covering the subject is detected", () => {
    const body = "### Fixed\n- **Concurrent writes during sync are flagged (R31)**";
    expect(isCovered("fix(sync): flag concurrent writes instead of clobbering", body)).toBe(true);
  });

  test("an unrelated bullet does not cover a subject", () => {
    const body = "### Fixed\n- **Pre-flight over-budget message**";
    expect(isCovered("feat(quantum): add zorblax entanglement caching", body)).toBe(false);
  });

  test("stopwords alone cannot satisfy coverage", () => {
    // "add" and "fixed" are stopwords; they must not count as evidence.
    const toks = tokens("feat(cli): add the fixed thing");
    expect(toks).not.toContain("add");
    expect(toks).not.toContain("fixed");
  });
});

describe("changelog coverage gate: repository state", () => {
  /** Most recent release tag, discovered rather than hardcoded — a pinned
   *  version breaks the moment the repo cuts its next release. */
  function latestTag(): string {
    const proc = Bun.spawnSync(["git", "describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"], { cwd: ROOT });
    return proc.stdout.toString().trim();
  }

  test("every behavioural commit since the last tag is covered", () => {
    const body = coveredBody();
    const commits = behaviouralCommits(latestTag());
    const uncovered = commits.filter((c) => !isCovered(c.subject, body));
    expect(uncovered.map((c) => c.subject)).toEqual([]);
  });

  test("the newest dated section is included in the searched body", () => {
    // Releases land by squash merge, so shipped commits are often not tag
    // ancestors. Scanning only [Unreleased] re-flagged already-documented
    // work, which is why the body spans the newest dated section too.
    //
    // Assert against the section that actually comes first, not the newest
    // tag: while a release is staged but untagged (exactly this branch), the
    // first dated section is the version being cut, which has no tag yet.
    const text = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
    const firstDated = text.slice(text.indexOf("## [Unreleased]")).match(/^## \[(\d+\.\d+\.\d+)\]/m);
    expect(firstDated).not.toBeNull();
    expect(coveredBody()).toContain(`## [${firstDated![1]}]`);
  });

  test("the gate script exits zero on the current tree", () => {
    const proc = Bun.spawnSync(["bun", "scripts/check-changelog.ts"], { cwd: ROOT });
    expect(proc.exitCode).toBe(0);
  });

  test("no [Unreleased] section repeats a heading", () => {
    // Three separate sessions appended their own "### Fixed" to [Unreleased]
    // and the coverage check waved it through, so the published file was
    // structurally invalid while the gate reported success.
    //
    // Judged through the gate's own exported check rather than re-implementing
    // the rule here: a test that duplicates the logic can pass while the gate
    // is broken. Released sections are deliberately out of scope — their
    // duplicates are immutable history, not something to rewrite.
    expect(duplicateHeadings()).toEqual([]);
  });

  test("the published changelog has no duplicate version sections", () => {
    // A v3.4.0 back-merge once duplicated [3.3.0]; this pins the invariant.
    const text = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
    const sections = text.match(/^## \[\d+\.\d+\.\d+\]/gm) ?? [];
    expect(sections.length).toBeGreaterThan(0);
    expect(new Set(sections).size).toBe(sections.length);
  });
});
