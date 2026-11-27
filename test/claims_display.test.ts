import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

/**
 * The badge and the quickstart are the two places a user reads the test
 * figure. `claims:check` compares the JSON to the suite; it does not read
 * the README, which is exactly how 3.4.6 shipped a badge advertising a count
 * that no longer matched the manifest.
 */
describe("published test figures", () => {
  const claims = JSON.parse(readFileSync(join(ROOT, "claims.json"), "utf8")) as {
    tests: { count: number; assertions: number; files: number };
  };
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");

  test("the README badge matches claims.json", () => {
    const badge = readme.match(/Tests-(\d+)%20Passed/);
    expect(badge).not.toBeNull();
    expect(Number(badge![1])).toBe(claims.tests.count);
  });

  test("the quickstart line matches claims.json", () => {
    const line = readme.match(
      /bun test\s+# (\d+) pass, 0 fail, ([\d,]+) assertions across (\d+) files/,
    );
    expect(line).not.toBeNull();
    expect(Number(line![1])).toBe(claims.tests.count);
    expect(Number(line![2]!.replace(/,/g, ""))).toBe(claims.tests.assertions);
    expect(Number(line![3])).toBe(claims.tests.files);
  });
});
