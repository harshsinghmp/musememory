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
const BEHAVIOURAL_TYPES = new Set(["feat", "fix", "perf"]);

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
function behaviouralCommits(ref: string): { sha: string; subject: string }[] {
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
  return out;
}

/** Text from `[Unreleased]` down to the first dated section, plus that
 *  section's own body when the tag has already been cut.
 *
 *  Range subtlety: releases land on `main` via squash merge, so a commit that
 *  shipped in v3.4.0 is often NOT an ancestor of the tag — it was rewritten
 *  into a single squash commit. Scanning only `[Unreleased]` therefore
 *  re-flags work that is already documented under `[3.4.0]`. Everything newer
 *  than the tag is covered by `[Unreleased]` plus that section, so both are
 *  searched.
 */
function coveredBody(): string {
  const text = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
  const start = text.indexOf("## [Unreleased]");
  if (start === -1) return "";
  const afterUnreleased = text.slice(start + "## [Unreleased]".length);
  // First dated section header.
  const firstDated = afterUnreleased.search(/^## \[\d/m);
  if (firstDated === -1) return afterUnreleased;
  const unreleased = afterUnreleased.slice(0, firstDated);
  const rest = afterUnreleased.slice(firstDated);
  // That section runs to the next dated header. Search from after its own
  // leading `## ` (3 chars) so the current header is not re-matched — an
  // earlier off-by-three here let a section's whole body count as
  // "unreleased" whenever [Unreleased] was empty, which made the gate pass
  // with every entry stripped.
  const next = rest.slice(3).search(/^## \[\d/m);
  const firstSection = next === -1 ? rest : rest.slice(0, next + 3);
  return `${unreleased}\n${firstSection}`;
}

/** Distinctive words in a commit subject, used to look for a matching bullet. */
function tokens(subject: string): string[] {
  return subject
    .replace(/^[a-z]+(?:\([^)]*\))?!?:\s*/i, "") // strip type(scope):
    .toLowerCase()
    .split(/[^a-z0-9\-_.]+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

function main(): void {
  const ref = lastTag();
  const commits = behaviouralCommits(ref);
  const body = coveredBody().toLowerCase();

  const uncovered = commits.filter(({ subject }) => {
    const toks = tokens(subject);
    // A bullet covers the commit when it shares at least one distinctive token.
    return !toks.some((t) => body.includes(t));
  });

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

main();
