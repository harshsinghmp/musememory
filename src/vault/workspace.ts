import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { extname, join, relative } from "node:path";
import { redactSecrets } from "../secrets.ts";

/**
 * T-457: deterministic workspace terrain maps.
 *
 * Every map is derived from files on disk (plus stable git metadata), with
 * sorted keys and relative paths so the same checkout always produces the
 * same bytes. No timestamps are embedded.
 */

export interface WorkspaceTerrainFile {
  name: string;
  content: string;
}

export interface WorkspaceTerrain {
  root: string;
  files: WorkspaceTerrainFile[];
}

const TERRAIN_FILES = [
  "repo.md",
  "stack.md",
  "habits.md",
  "ownership.md",
  "packages.md",
  "logs.md",
] as const;

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".memory", ".astro", ".stversions", ".commandcode"]);

function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function readJson(path: string): Record<string, any> | null {
  const raw = readIfPresent(path);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function topLevel(root: string): string[] {
  try {
    return readdirSync(root)
      .filter((entry) => !SKIP_DIRS.has(entry))
      .sort();
  } catch {
    return [];
  }
}

/** Recursively collect files, skipping heavy/irrelevant directories. */
function walkFiles(root: string, limit = 4000): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    if (files.length >= limit) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= limit) return;
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) walk(full);
        else if (stat.isFile()) files.push(full);
      } catch {
        // unreadable entry — skip
      }
    }
  };
  walk(root);
  return files;
}

function git(root: string, args: string[]): string | null {
  if (!existsSync(join(root, ".git"))) return null;
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) return null;
  return String(result.stdout || "").trim();
}

function bulletList(values: string[], empty: string): string {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : empty;
}

function authorLabel(author: unknown): string[] {
  if (!author) return [];
  if (typeof author === "string") return [author];
  if (typeof author === "object") {
    const record = author as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    const email = typeof record.email === "string" ? record.email : "";
    if (name && email) return [`${name} <${email}>`];
    if (name) return [name];
  }
  return [];
}

function detectWorkspacePackages(root: string): Array<{ name: string; version: string; path: string; private: boolean }> {
  const rootPkg = readJson(join(root, "package.json"));
  const candidates = new Set<string>();
  for (const base of ["packages", "apps", "src"]) {
    const dir = join(root, base);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir).sort()) {
      const pkgPath = join(dir, entry, "package.json");
      if (existsSync(pkgPath)) candidates.add(relative(root, join(dir, entry)));
    }
  }
  // Workspaces can be nested one level deeper (apps/web/package.json).
  for (const rel of [...candidates]) {
    const nested = join(root, rel);
    if (!existsSync(nested)) continue;
    for (const entry of readdirSync(nested).sort()) {
      if (existsSync(join(nested, entry, "package.json"))) candidates.add(join(rel, entry));
    }
  }
  const packages = [...candidates].sort().map((rel) => {
    const pkg = readJson(join(root, rel, "package.json")) || {};
    return {
      name: typeof pkg.name === "string" ? pkg.name : rel,
      version: typeof pkg.version === "string" ? pkg.version : "0.0.0",
      path: rel,
      private: pkg.private === true,
    };
  });
  if (packages.length === 0 && rootPkg) {
    packages.push({
      name: typeof rootPkg.name === "string" ? rootPkg.name : "workspace",
      version: typeof rootPkg.version === "string" ? rootPkg.version : "0.0.0",
      path: ".",
      private: rootPkg.private === true,
    });
  }
  return packages;
}

function repoMap(root: string): string {
  const pkg = readJson(join(root, "package.json"));
  const files = walkFiles(root);
  const languageCounts = new Map<string, number>();
  for (const file of files) {
    const ext = extname(file);
    if (!ext) continue;
    languageCounts.set(ext, (languageCounts.get(ext) || 0) + 1);
  }
  const languages = [...languageCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([ext, count]) => `| \`${ext}\` | ${count} |`);
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const head = git(root, ["rev-parse", "--short", "HEAD"]);
  const entries = topLevel(root).map((entry) => {
    const isDir = (() => {
      try {
        return statSync(join(root, entry)).isDirectory();
      } catch {
        return false;
      }
    })();
    return `- ${isDir ? "`" + entry + "/`" : "`" + entry + "`"}`;
  });

  return `# Repository Terrain

## Identity
- Name: ${typeof pkg?.name === "string" ? pkg.name : "(unnamed)"}
- Version: ${typeof pkg?.version === "string" ? pkg.version : "0.0.0"}
- Root: \`.\`

## Top Level
${bulletList(entries, "- (empty)")}

## Languages
| Extension | Files |
|---|---|
${languages.length ? languages.join("\n") : "| (none) | 0 |"}

## Git
- Branch: ${branch || "(not a git repository)"}
- HEAD: ${head || "(no commits)"}
`;
}

function stackMap(root: string): string {
  const pkg = readJson(join(root, "package.json")) || {};
  const dependencies = Object.keys(pkg?.dependencies || {}).sort();
  const devDependencies = Object.keys(pkg?.devDependencies || {}).sort();
  const scripts = Object.keys(pkg?.scripts || {}).sort();
  const engines = Object.keys(pkg?.engines || {}).sort();
  const managers: string[] = [];
  if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"))) managers.push("bun");
  if (existsSync(join(root, "pnpm-lock.yaml"))) managers.push("pnpm");
  if (existsSync(join(root, "package-lock.json"))) managers.push("npm");
  if (existsSync(join(root, "yarn.lock"))) managers.push("yarn");
  const configs = ["tsconfig.json", "bunfig.toml", ".editorconfig", "Dockerfile", "docker-compose.yml"]
    .filter((name) => existsSync(join(root, name)));

  return `# Stack Terrain

## Runtime
- Package managers: ${managers.length ? managers.join(", ") : "unknown"}
- Engines: ${engines.length ? engines.map((key) => `\`${key} ${pkg.engines[key]}\``).join(", ") : "undeclared"}
- Configs: ${configs.length ? configs.map((name) => `\`${name}\``).join(", ") : "none"}

## Scripts
${bulletList(scripts.map((name) => `\`${name}\` → \`${pkg.scripts[name]}\``), "- (none)")}

## Production Dependencies
${bulletList(dependencies.map((name) => `\`${name}\``), "- (none)")}

## Development Dependencies
${bulletList(devDependencies.map((name) => `\`${name}\``), "- (none)")}
`;
}

function habitsMap(root: string): string {
  const pkg = readJson(join(root, "package.json"));
  const scripts = pkg?.scripts || {};
  const workflows = existsSync(join(root, ".github", "workflows"))
    ? readdirSync(join(root, ".github", "workflows")).filter((f) => /\.ya?ml$/.test(f)).sort()
    : [];
  const files = walkFiles(root);
  const tests = files.filter((file) => /\.(test|spec)\.[a-z]+$/.test(file)).map((file) => relative(root, file));
  const gitignore = readIfPresent(join(root, ".gitignore"));
  const conventions: string[] = [];
  if (scripts.test) conventions.push(`Test command: \`${scripts.test}\``);
  if (scripts.lint) conventions.push(`Lint command: \`${scripts.lint}\``);
  if (scripts.format) conventions.push(`Format command: \`${scripts.format}\``);
  if (existsSync(join(root, "AGENTS.md"))) conventions.push("Contract file: `AGENTS.md`");
  if (existsSync(join(root, ".editorconfig"))) conventions.push("Editor config: `.editorconfig`");
  if (existsSync(join(root, "CONTRIBUTING.md"))) conventions.push("Contributor guide: `CONTRIBUTING.md`");

  return `# Habits Terrain

## Working Conventions
${bulletList(conventions, "- (none declared)")}

## CI Workflows
${bulletList(workflows.map((name) => `\`${name}\``), "- (none)")}

## Test Surface
- Test files: ${tests.length}
${bulletList(tests.slice(0, 40).map((file) => `\`${file}\``), "- (none)")}

## Ignore Surface
- \`.gitignore\` entries: ${gitignore ? gitignore.split("\n").filter((line) => line.trim() && !line.trim().startsWith("#")).length : 0}
`;
}

function ownershipMap(root: string): string {
  const pkg = readJson(join(root, "package.json"));
  const authors = authorLabel(pkg?.author);
  const contributors = Array.isArray(pkg?.contributors)
    ? pkg.contributors.flatMap((entry: unknown) => authorLabel(entry))
    : authorLabel(pkg?.contributors);
  const maintainers = Array.isArray(pkg?.maintainers)
    ? pkg.maintainers.flatMap((entry: unknown) => authorLabel(entry))
    : authorLabel(pkg?.maintainers);
  const codeowners = readIfPresent(join(root, "CODEOWNERS")) || readIfPresent(join(root, ".github", "CODEOWNERS"));
  const ownerLines = codeowners
    ? codeowners.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).slice(0, 40)
    : [];

  return `# Ownership Terrain

## Declared Owners
- Author: ${authors.length ? authors.join(", ") : "(unset)"}
- Maintainers: ${maintainers.length ? maintainers.join(", ") : "(unset)"}
- Contributors: ${contributors.length ? contributors.join(", ") : "(unset)"}

## CODEOWNERS
${bulletList(ownerLines.map((line) => `\`${line}\``), "- (none)")}
`;
}

function packagesMap(root: string): string {
  const packages = detectWorkspacePackages(root);
  const rows = packages.map(
    (pkg) => `| \`${pkg.name}\` | ${pkg.version} | \`${pkg.path}\` | ${pkg.private ? "private" : "public"} |`,
  );
  return `# Packages Terrain

| Package | Version | Path | Visibility |
|---|---|---|---|
${rows.length ? rows.join("\n") : "| (none) | — | — | — |"}
`;
}

function logsMap(root: string): string {
  const log = git(root, ["log", "-n", "20", "--pretty=format:%h %ad %s", "--date=short"]);
  if (!log) {
    return `# Logs Terrain

- No git history available.
`;
  }
  return `# Logs Terrain

## Recent Commits
${log.split("\n").filter(Boolean).map((line) => `- ${line}`).join("\n")}
`;
}

export function generateWorkspaceTerrain(root: string): WorkspaceTerrain {
  const maps: Record<(typeof TERRAIN_FILES)[number], () => string> = {
    "repo.md": () => repoMap(root),
    "stack.md": () => stackMap(root),
    "habits.md": () => habitsMap(root),
    "ownership.md": () => ownershipMap(root),
    "packages.md": () => packagesMap(root),
    "logs.md": () => logsMap(root),
  };
  return {
    root,
    // T-459: a terrain map is injected into prompts, so credential-shaped
    // strings are redacted at generation time rather than trusted to callers.
    files: TERRAIN_FILES.map((name) => ({ name, content: redactSecrets(maps[name]()) })),
  };
}

export function writeWorkspaceTerrain(root: string, outDir: string): { outDir: string; files: string[] } {
  const terrain = generateWorkspaceTerrain(root);
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const file of terrain.files) {
    const target = join(outDir, file.name);
    writeFileSync(target, file.content, "utf8");
    written.push(target);
  }
  return { outDir, files: written };
}
