import { describe, it, expect } from "bun:test";
import { pullRequestVerdict } from "../scripts/lib/pull-request.ts";

/**
 * The pre-review gate must not fail a CI run because the PR it was reviewing
 * has already merged. On 2026-11-24 every one of the last 19 CI failures was
 * this condition: the run keeps going after the merge, reaches the gate, and
 * the gate reported `✗ pull request: #N is MERGED` with `0 passing, 0 failing`
 * checks beside it. Nothing could act on that failure, and the noise hid real
 * red runs.
 */
describe("check-landed --pr: pull request state verdict", () => {
  it("passes an open pull request and requires its checks", () => {
    const v = pullRequestVerdict("OPEN");
    expect(v.ok).toBe(true);
    expect(v.skipped).toBe(false);
    expect(v.note).toBe("");
  });

  it("skips, rather than fails, a merged pull request", () => {
    const v = pullRequestVerdict("MERGED");
    expect(v.ok).toBe(true);
    expect(v.skipped).toBe(true);
    expect(v.note).toContain("already merged");
  });

  it("skips a pull request closed without merging", () => {
    const v = pullRequestVerdict("CLOSED");
    expect(v.ok).toBe(true);
    expect(v.skipped).toBe(true);
    expect(v.note).toContain("closed without merging");
  });

  it("fails an unknown state instead of guessing", () => {
    const v = pullRequestVerdict("DRAFT");
    expect(v.ok).toBe(false);
    expect(v.skipped).toBe(false);
  });
});
