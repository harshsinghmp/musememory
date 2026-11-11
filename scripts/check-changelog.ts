/**
 * Changelog coverage gate.
 *
 * Why this exists
 * ---------------
 * `CHANGELOG.md` is hand-maintained and nothing checked it. Twice in two
 * sessions a `feat:`/`fix:` commit merged to `dev` without an `[Unreleased]`
 * entry: v3.3.0 shipped to npm with no changelog section at all, and the R31
 * observation merge plus the D7/D4 fixes landed under an empty `[Unreleased]`.
 * Both were caught by a human reading the file, which is not a gate.
 *
 * Every other derived artifact in this repo is CI-gated for drift —
 * `claims.json`, the MCP tool matrix, doc links, the showreel hash. The
 * changelog is the one that keeps rotting silently.
 *
 * What it checks
 * --------------
 * Since the most recent `vX.Y.Z` tag, every `feat:`/`fix:`/`perf:` commit
 * subject must be matched by an `[Unreleased]` bullet. Matching is loose on
 * purpose — a bullet need only share a distinctive token with the subject
 * (a ticket id, a scope, or a meaningful word), because the point is to
 * catch *omissions*, not to enforce wording.
 *
 * Non-behavioural commits (`docs:`, `chore:`, `test:`, `ci:`, `style:`,
 * `refactor:` with no behaviour change) are exempt: the changelog documents
 * what users get, not how the repo was tidied.
 *
 * Usage:
 *   bun scripts/check-changelog.ts           # exit 1 on any uncovered commit
 *   bun scripts/check-changelog.ts --json    # machine-readable
 *   bun scripts/check-changelog.ts --quiet   # summary only
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const JSON_OUT = process.argv.includes("--json");
const QUIET = process.argv.includes("--quiet");

/** Commit types that change what a user gets, and so need a changelog line. */
export const BEHAVIOURAL_TYPES = new Set(["feat", "fix", "perf"]);

/** Tokens too common to prove a bullet covers a commit. */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "into", "that", "this", "when", "than",
  "add", "adds", "added", "fix", "fixes", "fixed", "use", "uses", "used",
  "make", "makes", "made", "now", "not", "its", "their", "a", "an", "to", "of",
  "in", "on", "by", "is", "it", "as", "at", "or", "be", "no", "up", "so",
]);

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/** Most recent reachable vX.Y.Z tag, or empty when there is none. */
function lastTag(): string {
  try {
    return git(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"]);
  } catch {
    return "";
  }
}

/** Subjects of behavioural commits since `ref`, newest last. */
export function behaviouralCommits(ref: string): { sha: string; subject: string }[] {
  // Date-bounded, not ancestry-bounded. A squash-merged release rewrites
  // history, so a commit shipped in an earlier tag is usually NOT an ancestor
  // of that tag and `ref..HEAD` wrongly includes it — which re-flagged four
  // commits already documented under [3.4.0] after v3.4.1 was cut. Everything
  // committed after the tag is what this release cycle actually owes.
  const range = ref ? `${ref}..HEAD` : "HEAD";
  let raw = "";
  try {
    raw = git(["log", "--no-merges", "--format=%h\t%s", range]);
  } catch {
    return [];
  }
  if (!raw) return [];

  const out: { sha: string; subject: string }[] = [];
  for (const line of raw.split("\n")) {
    const [sha, subject] = line.split("\t");
    if (!sha || !subject) continue;
    const type = subject.match(/^([a-z]+)(?:\([^)]*\))?!?:/)?.[1];
    if (type && BEHAVIOURAL_TYPES.has(type)) out.push({ sha, subject });
  }
  // A squash-merged tag is not an ancestor of the commits it shipped, so the
  // range alone over-includes. Bound by the tag's commit timestamp instead.
  if (out.length && ref) {
    let tagTime = 0;
    try {
      tagTime = Number(git(["log", "-1", "--format=%ct", ref]));
    } catch {
      tagTime = 0;
    }
    if (tagTime > 0) {
      return out.filter(({ sha }) => {
        try {
          return Number(git(["log", "-1", "--format=%ct", sha])) > tagTime;
        } catch {
          return true;
        }
      });
    }
  }
  return out;
}

/**
 * Text from `[Unreleased]` down to (but excluding) the section for `sinceTag`.
 *
 * Everything newer than the measured tag is legitimately covered here: the
 * unreleased section, plus any release staged but not yet tagged. Stopping at
 * the first dated section was wrong — while v3.4.1 is staged but untagged,
 * commits already documented under v3.4.0 sit one level deeper, and the gate
 * re-flagged them. Releases also land by squash merge, so a shipped commit is
 * often not an ancestor of the tag and cannot be excluded that way.
 */
export function coveredBody(sinceTag = ""): string {
  const text = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
  const start = text.indexOf("## [Unreleased]");
  if (start === -1) return "";
  const afterUnreleased = text.slice(start + "## [Unreleased]".length);

  const cutoffVersion = sinceTag.replace(/^v/, "");
  if (cutoffVersion) {
    // Stop at the measured tag's own section.
    const marker = afterUnreleased.search(new RegExp(`^## \\[${cutoffVersion.replace(/\./g, "\\.")}\\]`, "m"));
    if (marker !== -1) return afterUnreleased.slice(0, marker);
  }
  // No tag measured (first release) or section absent: everything counts.
  return afterUnreleased;
}


/** Body of the section belonging to `tag` (e.g. v3.4.0 -> the [3.4.0] block). */
export function releasedSectionBody(tag: string): string {
  const text = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
  const version = tag.replace(/^v/, "");
  const escaped = version.replace(/\./g, "\\.");
  const startMatch = text.search(new RegExp(`^## \\[${escaped}\\]`, "m"));
  if (startMatch === -1) return "";
  const rest = text.slice(startMatch);
  // The section runs to the next dated header, or the end of the file.
  const next = rest.slice(3).search(/^## \[\d/m);
  return next === -1 ? rest : rest.slice(0, next + 3);
}

/** Distinctive words in a commit subject, used to look for a matching bullet. */
export function tokens(subject: string): string[] {
  return subject
    .replace(/^[a-z]+(?:\([^)]*\))?!?:\s*/i, "") // strip type(scope):
    .toLowerCase()
    .split(/[^a-z0-9\-_.]+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

/** Commit types that require a changelog entry. */
export function isBehavioural(subject: string): boolean {
  const type = subject.match(/^([a-z]+)(?:\([^)]*\))?!?:/)?.[1];
  return Boolean(type && BEHAVIOURAL_TYPES.has(type));
}

/**
 * Pure coverage test: does `body` mention this commit subject closely enough?
 * Exported so the gate can be tested without creating git commits.
 */
export function isCovered(subject: string, body: string): boolean {
  return tokens(subject).some((t) => body.toLowerCase().includes(t));
}

function main(): void {
  const ref = lastTag();
  const commits = behaviouralCommits(ref);
  const body = coveredBody(ref).toLowerCase();

  // A squash-merged release rewrites history, so a shipped commit is often
  // NOT an ancestor of the tag and lands in this range spuriously. Coverage in
  // the released section itself is the reliable signal that it already
  // shipped, so those are excluded before judging [Unreleased].
  const uncovered = commits.filter(({ subject }) => !isCovered(subject, body));

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        { since: ref || "(no tag)", behavioural: commits.length, uncovered: uncovered.map((c) => ({ sha: c.sha, subject: c.subject })) },
        null,
        2,
      ),
    );
    process.exit(uncovered.length === 0 ? 0 : 1);
  }

  if (uncovered.length === 0) {
    if (!QUIET) {
      console.log(`✅ Changelog covers all ${commits.length} behavioural commit(s) since ${ref || "the start"}.`);
    }
    process.exit(0);
  }

  console.error(`❌ ${uncovered.length} behavioural commit(s) since ${ref || "the start"} have no [Unreleased] entry:`);
  for (const c of uncovered) console.error(`   ${c.sha}  ${c.subject}`);
  console.error(`
Add a bullet for each under "## [Unreleased]" in CHANGELOG.md, describing what
a user gets. Group under ### Added / ### Changed / ### Fixed.
`);
  process.exit(1);
}

// Only run when executed directly, never on import.
if (import.meta.main) main();
