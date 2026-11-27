import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const MARKER = /^(<{7}|>{7})(\s|$)/;

const ROOTS = ["README.md", "CHANGELOG.md", "SECURITY.md", "CONTRIBUTING.md", "docs", ".agents"];

function walk(path: string, out: string[] = []): string[] {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (entry === "node_modules" || entry === ".git" || entry === "archive") continue;
      walk(join(path, entry), out);
    }
  } else if (path.endsWith(".md")) {
    out.push(path);
  }
  return out;
}

/**
 * A conflict marker is invisible to the claims gate: both sides can carry the
 * same (stale) number and every other check passes. 3.4.6 shipped a README
 * with six of these, so the check is now explicit and mechanical.
 */
describe("documentation integrity", () => {
  test("the marker detector matches a real conflict block", () => {
    const sample = ["<<<<<<< HEAD", "value", "=======", "value", ">>>>>>> origin/dev"].join("\n");
    expect(sample.split("\n").filter((line) => MARKER.test(line))).toHaveLength(2);
    expect(MARKER.test("======= setext heading underline")).toBe(false);
  });

  test("no tracked documentation file contains a git conflict marker", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(join(ROOT, root))) {
        const lines = readFileSync(file, "utf8").split("\n");
        lines.forEach((line, index) => {
          if (MARKER.test(line)) offenders.push(`${file.slice(ROOT.length + 1)}:${index + 1}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
