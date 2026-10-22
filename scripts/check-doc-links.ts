/**
 * Markdown link integrity check.
 *
 * Why this exists
 * ---------------
 * The documentation tree carried thirteen `file:///` links pointing at the
 * original author's local checkout (`file:///home/harsh/Projects/github/...`).
 * They are dead for every other reader and for CI, and nothing flagged them.
 *
 * This resolves every relative link in every markdown file in the workspace
 * and reports the ones that do not exist on disk. It is the same check the
 * `audit` skill calls "Link Integrity", run as a gate instead of a one-off.
 *
 * Usage:
 *   bun run scripts/check-doc-links.ts          # report and exit 1 on any dead link
 *   bun run scripts/check-doc-links.ts --quiet  # summary only
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

/** Directories that are not part of the documentation tree. */
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".memory", // owned by the MuseMemory engine — never read or validated
  "dist",
  ".astro",
  ".agents/artifacts/archive",
]);

/** Path prefixes (relative to ROOT) that are excluded from the scan. */
const SKIP_PREFIXES = ["docs/superpowers"];

const LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function isSkipped(relPath: string): boolean {
  const parts = relPath.split("/");
  if (parts.some((p) => SKIP_DIRS.has(p))) return true;
  return SKIP_PREFIXES.some((p) => relPath.startsWith(p + "/"));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (extname(entry) === ".md") out.push(full);
  }
  return out;
}

interface DeadLink {
  file: string;
  line: number;
  target: string;
}

const files = walk(ROOT);
const dead: DeadLink[] = [];
let checked = 0;

for (const file of files) {
  const rel = relative(ROOT, file);
  if (isSkipped(rel)) continue;
  const text = readFileSync(file, "utf8");
  LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINK_RE.exec(text)) !== null) {
    const raw = m[1]!;
    // Strip the anchor and any title.
    const target = raw.split("#")[0]!.trim();
    if (!target) continue;
    if (/^(https?:|mailto:|tel:|data:)/i.test(target)) continue;
    if (target.startsWith("file://")) {
      dead.push({ file: rel, line: text.slice(0, m.index).split("\n").length, target });
      continue;
    }
    checked++;
    const resolved = resolve(dirname(file), target);
    // A link may point at a file OR at a directory (e.g. `../../`). statSync
    // succeeds for both, so existence is one question, not two.
    let exists = false;
    try {
      statSync(resolved);
      exists = true;
    } catch {
      exists = false;
    }
    if (!exists) {
      dead.push({ file: rel, line: text.slice(0, m.index).split("\n").length, target });
    }
  }
}

const quiet = process.argv.includes("--quiet");

if (dead.length) {
  console.error(`✗ ${dead.length} dead link(s) in ${files.length} markdown files:\n`);
  for (const d of dead) {
    console.error(`  ${d.file}:${d.line}  →  ${d.target}`);
  }
  console.error(
    `\nA machine-specific \`file:///\` link means the document was written against ` +
      `one machine's checkout. Use a repository-relative path instead.`,
  );
  process.exit(1);
}

if (!quiet) {
  console.log(`✓ ${checked} relative links across ${files.length} markdown files — all resolve.`);
}
process.exit(0);
