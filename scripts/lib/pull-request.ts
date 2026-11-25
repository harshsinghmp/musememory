/**
 * Pre-review gate: how a pull request's state maps to a verdict.
 *
 * `check-landed --pr` answers one question — "is this work reviewable?" — and it
 * used to answer it with `pr.state === "OPEN"`. That is correct while the PR is
 * open and wrong the moment it merges: the CI run keeps going, reaches the gate,
 * and fails on a condition that is already settled. On 2026-11-24 that produced
 * **19 of the last 19 CI failures** across every recent branch, none of which was
 * a test failure. A gate that reports an unreachable condition as a failure is
 * noise, and noise is what makes a real red run easy to miss.
 *
 * A terminal state is a skip, not a pass of the work: the integration-branch
 * gate (`check-landed`, without `--pr`) is still what proves the commit actually
 * landed.
 */

export type PullRequestVerdict = {
  ok: boolean;
  skipped: boolean;
  /** Appended to the human-readable detail line. */
  note: string;
};

export function pullRequestVerdict(state: string): PullRequestVerdict {
  switch (state) {
    case "OPEN":
      return { ok: true, skipped: false, note: "" };
    case "MERGED":
      return {
        ok: true,
        skipped: true,
        note: " — already merged; the pre-merge review gate no longer applies",
      };
    case "CLOSED":
      return {
        ok: true,
        skipped: true,
        note: " — closed without merging; the pre-merge review gate no longer applies",
      };
    default:
      return { ok: false, skipped: false, note: "" };
  }
}
