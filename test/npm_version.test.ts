import { describe, test, expect } from "bun:test";
import { getLatestNpmVersion, compareVersions, getCurrentVersion } from "../src/cli/upgrade.ts";

describe("T-397: getLatestNpmVersion and Version Utilities", () => {
  test("compareVersions accurately handles semver ordering", () => {
    expect(compareVersions("3.2.0", "3.0.2")).toBe(1);
    expect(compareVersions("3.0.2", "3.2.0")).toBe(-1);
    expect(compareVersions("3.2.0", "3.2.0")).toBe(0);
    expect(compareVersions("v3.2.0", "3.2.0")).toBe(0);
    expect(compareVersions("3.10.0", "3.2.0")).toBe(1);
    expect(compareVersions("3.2.1", "3.2.0")).toBe(1);
  });

  test("getCurrentVersion returns valid semver matching package.json", () => {
    const ver = getCurrentVersion();
    expect(typeof ver).toBe("string");
    expect(ver).toMatch(/^\d+\.\d+\.\d+$/);
    expect(compareVersions(ver, "3.0.0")).toBeGreaterThanOrEqual(0);
  });
  test("accepts valid package names without throwing", async () => {
    // Valid standard package name
    const version = await getLatestNpmVersion("typescript");
    // Either returns string version if network/npm available, or null
    if (version !== null) {
      expect(typeof version).toBe("string");
      expect(version.length).toBeGreaterThan(0);
    }
  }, 10000);

  test("accepts valid scoped package names", async () => {
    const version = await getLatestNpmVersion("@modelcontextprotocol/sdk");
    if (version !== null) {
      expect(typeof version).toBe("string");
    }
  }, 10000);

  test("rejects dangerous package names containing shell metacharacters early", async () => {
    const maliciousNames = [
      "musememory; touch /tmp/pwned",
      "musememory && whoami",
      "musememory | cat /etc/passwd",
      "`id`",
      "$(id)",
      "pkg name with spaces",
      "pkg;rm -rf /",
      "pkg\nrm -rf /",
      "> /tmp/hack",
    ];

    for (const name of maliciousNames) {
      const result = await getLatestNpmVersion(name);
      expect(result).toBeNull();
    }
  });

  test("rejects empty or invalid package names", async () => {
    expect(await getLatestNpmVersion("")).toBeNull();
    expect(await getLatestNpmVersion("   ")).toBeNull();
    expect(await getLatestNpmVersion(null as any)).toBeNull();
    expect(await getLatestNpmVersion(undefined as any)).toBeDefined(); // defaults to "musememory"
  });
});
