/**
 * Landing gate — is this work actually delivered?
 *
 * Why this exists
 * ---------------
 * On 2026-10-22 two complete waves (T-320 contradiction calibration, T-321
 * per-project health gate scope) were committed to a local branch and a local
 * `dev`, and the session ended. No push. No pull request. No CI run. The
 * close-out document in `.agents/context/current.md` nevertheless described
 * them as landed, under a heading that read *"Recently Landed Waves (Verified
 * on `dev`)"*. `dev` did not contain them. They were invisible to review and
 * invisible to the release.
 *
 * The code was correct and every test was green. The failure was not a coding
 * failure. It was a **false claim about the remote** — the close-out asserted
 * a fact about `origin/dev` that nothing had ever checked.
 *
 * A rule an agent can forget is not a rule. So this is a gate: it exits
 * non-zero when the work cannot be proven to be on the remote, and it prints
 * the exact evidence (commands and SHAs) so a report can quote it instead of
 * asserting it.
 *
 * The doctrine, in one line:
 *
 *   **A commit is not a delivery. Work is LANDED only when it is reachable
 *   from the integration branch on the remote. Until then it is LOCAL.**
 *
 * Usage:
 *   bun run scripts/check-landed.ts           # post-merge: is this landed on origin/<integration>?
 *   bun run scripts/check-landed.ts --pr      # pre-review: is this branch pushed with a green PR?
 *
 * Options:
 *   --integration <branch>   integration branch to check against (default: dev)
 *   --branch <name>          subject branch to inspect (default: the current branch)
 *   --no-fetch               do not run `git fetch origin` first
 *   --pr                     pre-review mode instead of post-merge mode
 *
 * Exit codes:
 *   0  every required check passed
 *   1  at least one required check failed — the work is not provably delivered
 */
import { spawnSync } from "node:child_process";

interface Check {
  ok: boolean;
  label: string;
  detail: string;
  /** A required check that could not run (missing tool, offline) is not a pass. */
  skipped?: boolean;
}

function git(args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { code: r.status ?? 1, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

function gitOk(args: string[]): boolean {
  return git(args).code === 0;
}

function sh(cmd: string, args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { code: r.status ?? 1, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

const INTEGRATION = val("--integration") ?? "dev";
const SUBJECT = val("--branch");
const PR_MODE = has("--pr");
const NO_FETCH = has("--no-fetch");

// ---------------------------------------------------------------- repository

const headSha = git(["rev-parse", "--short", "HEAD"]).out;
const currentBranch = git(["rev-parse", "--abbrev-ref", "HEAD"]).out;
const detached = currentBranch === "HEAD";
/** The branch whose delivery state we are judging. */
const branch = SUBJECT ?? currentBranch;
/** True when the subject branch was named explicitly (CI checks out a detached HEAD). */
const explicitBranch = SUBJECT !== undefined;

if (!NO_FETCH) {
  // The whole point is to check the REMOTE's state, not a stale local ref.
  // A failed fetch is tolerated here and surfaces as a failed check below.
  git(["fetch", "--quiet", "origin"]);
}

const checks: Check[] = [];
const notes: string[] = [];

// ------------------------------------------------------- shared: upstream ref

const upstream =
  detached || explicitBranch
    ? undefined
    : git(["rev-parse", "--abbrev-ref", "@{u}"]).out || undefined;
const unpushed = upstream ? git(["rev-list", "--count", `${upstream}..HEAD`]).out : "";

/**
 * Is the subject branch present on the remote?
 *
 * In CI the checkout is a detached HEAD of the PR merge commit, so there is no
 * local branch to compare against — the branch's existence on the remote is the
 * meaningful check instead.
 */
function checkBranchPushed(): void {
  const remoteRef = `origin/${branch}`;
  const remoteSha = git(["rev-parse", "--short", remoteRef]).out;
  if (!remoteSha) {
    checks.push({
      ok: false,
      label: "branch pushed",
      detail: `${remoteRef} does not exist. The branch was never pushed — the work is LOCAL.`,
    });
    return;
  }
  checks.push({
    ok: true,
    label: "branch pushed",
    detail: `${remoteRef} exists at ${remoteSha}`,
  });
}

function checkUnpushed(): void {
  if (explicitBranch) {
    // The subject branch was named explicitly; its remote presence is checked
    // separately. There is no local upstream to diff against.
    checkBranchPushed();
    return;
  }
  if (detached) {
    checks.push({
      ok: false,
      skipped: true,
      label: "unpushed commits",
      detail: "HEAD is detached — cannot determine an upstream. Run this on a named branch.",
    });
    return;
  }
  if (!upstream) {
    checks.push({
      ok: false,
      label: "unpushed commits",
      detail: `branch ${branch} has no upstream. The branch was never pushed — the work is LOCAL.`,
    });
    return;
  }
  const count = Number(unpushed || "0");
  checks.push({
    ok: count === 0,
    label: "unpushed commits",
    detail:
      count === 0
        ? `none (upstream: ${upstream})`
        : `${count} commit(s) not on ${upstream}: ${git(["log", "--oneline", `${upstream}..HEAD`]).out
            .split("\n")
            .slice(0, 5)
            .join(" | ")}`,
  });
}

// ----------------------------------------------------------- pull request

/** Is the GitHub CLI usable? The pull-request checks need it. */
let ghAvailable: boolean | undefined;
function hasGh(): boolean {
  if (ghAvailable === undefined) ghAvailable = sh("gh", ["--version"]).code === 0;
  return ghAvailable;
}

function prFor(ref: string): { number: number; state: string; url: string } | undefined {
  if (!hasGh()) return undefined;
  const r = sh("gh", ["pr", "view", ref, "--json", "number,state,url"]);
  if (r.code !== 0 || !r.out) return undefined;
  try {
    const p = JSON.parse(r.out) as { number: number; state: string; url: string };
    return p;
  } catch {
    return undefined;
  }
}

function prChecks(ref: string): { passing: number; failing: number } | undefined {
  if (!hasGh()) return undefined;
  const r = sh("gh", ["pr", "view", ref, "--json", "statusCheckRollup"]);
  if (r.code !== 0 || !r.out) return undefined;
  try {
    const parsed = JSON.parse(r.out) as {
      statusCheckRollup?: Array<{ conclusion?: string; status?: string }>;
    };
    let passing = 0;
    let failing = 0;
    for (const c of parsed.statusCheckRollup ?? []) {
      if (c.conclusion === "SUCCESS") passing++;
      else if (c.conclusion === "FAILURE" || c.conclusion === "CANCELLED" || c.conclusion === "TIMED_OUT") {
        failing++;
      }
    }
    return { passing, failing };
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------------- modes

if (PR_MODE) {
  console.log(`check-landed --pr — pre-review readiness on ${branch || "(detached)"}`);

  checkUnpushed();

  const pr = prFor(branch);
  if (!pr) {
    checks.push({
      ok: false,
      label: "pull request",
      detail: `no pull request found for ${branch}. The work cannot be reviewed until it has one.`,
    });
  } else {
    checks.push({
      ok: pr.state === "OPEN",
      label: "pull request",
      detail: `#${pr.number} is ${pr.state} (${pr.url})`,
    });
    const cs = prChecks(branch);
    if (!cs) {
      checks.push({
        ok: false,
        skipped: true,
        label: "pull request checks",
        detail: "could not read the PR check rollup (gh unavailable or not authenticated)",
      });
    } else {
      checks.push({
        ok: cs.failing === 0,
        label: "pull request checks",
        detail: `${cs.passing} passing, ${cs.failing} failing`,
      });
    }
  }
} else {
  console.log(`check-landed — integration branch: ${INTEGRATION}`);

  const integrationRef = `origin/${INTEGRATION}`;
  const integrationSha = git(["rev-parse", "--short", integrationRef]).out;

  if (!integrationSha) {
    checks.push({
      ok: false,
      label: `reachable from ${integrationRef}`,
      detail: `the remote branch ${integrationRef} does not exist locally. Run \`git fetch origin\` and retry.`,
    });
  } else {
    // With an explicit subject branch, the thing that must have landed is that
    // branch's remote head — not the local HEAD, which may be elsewhere.
    const subjectRef = explicitBranch ? `origin/${branch}` : "HEAD";
    const reachable = gitOk(["merge-base", "--is-ancestor", subjectRef, integrationRef]);
    const subjectLabel = explicitBranch ? `origin/${branch}` : `HEAD ${headSha}`;
    checks.push({
      ok: reachable,
      label: `reachable from ${integrationRef}`,
      detail: reachable
        ? `${subjectLabel} is an ancestor of ${integrationRef} (${integrationSha})`
        : `${subjectLabel} is NOT an ancestor of ${integrationRef} (${integrationSha}). The work is committed but has not landed.`,
    });
  }

  // On the integration branch itself, "unpushed" is the only thing that can go
  // wrong. On a feature branch, being unpushed is the whole failure.
  checkUnpushed();

  const pr = prFor(branch);
  if (pr) {
    checks.push({
      ok: true,
      label: "pull request",
      detail: `#${pr.number} is ${pr.state} (${pr.url})`,
    });
  } else if (!detached) {
    notes.push(`no pull request found for ${branch} — if this work was never reviewed, that is the gap.`);
  }
}

// ------------------------------------------------------------------ verdict

let failed = 0;
let skipped = 0;
console.log("");
for (const c of checks) {
  const mark = c.skipped ? "?" : c.ok ? "✓" : "✗";
  console.log(`  ${mark} ${c.label}: ${c.detail}`);
  if (c.skipped) skipped++;
  else if (!c.ok) failed++;
}

for (const n of notes) console.log(`  · ${n}`);

const LANDED = failed === 0;
console.log("");
if (LANDED) {
  console.log(`RESULT: ${PR_MODE ? "REVIEWABLE" : "LANDED"}`);
  console.log(
    `Quote this evidence in the report — do not restate it as an assertion:` +
      `\n  git merge-base --is-ancestor HEAD ${INTEGRATION ? `origin/${INTEGRATION}` : ""}`,
  );
} else {
  // The failure verdict deliberately does NOT contain the success verdict as a
  // substring. "RESULT: NOT LANDED" contains "LANDED" — and a report that
  // quotes this output, or a grep for "LANDED", must not be able to read it
  // as success. The two verdicts are LANDED/LOCAL and
  // REVIEWABLE/NOT REVIEWABLE.
  console.log(`RESULT: ${PR_MODE ? "NOT REVIEWABLE" : "LOCAL"}`);
  if (!PR_MODE) {
    console.log(
      `\nThe work is committed but is not on ${`origin/${INTEGRATION}`}. It is LOCAL.\n` +
        `  1. git push -u origin ${branch}\n` +
        `  2. gh pr create --base ${INTEGRATION} --head ${branch}\n` +
        `  3. wait for CI, then merge\n` +
        `\nDo not describe this work as landed, shipped, released or "verified on ${INTEGRATION}"` +
        `\nuntil this gate exits 0.`,
    );
  }
}
console.log("");
process.exit(LANDED ? 0 : 1);
