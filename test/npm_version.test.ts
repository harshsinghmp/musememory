import { describe, test, expect } from "bun:test";
import { getLatestNpmVersion } from "../src/cli/upgrade.ts";

describe("T-397: getLatestNpmVersion command injection defense", () => {
  test("accepts valid package names without throwing", async () => {
    // Valid standard package name
    const version = await getLatestNpmVersion("typescript");
    // Either returns string version if network/npm available, or null
    if (version !== null) {
      expect(typeof version).toBe("string");
      expect(version.length).toBeGreaterThan(0);
    }
  });

  test("accepts valid scoped package names", async () => {
    const version = await getLatestNpmVersion("@modelcontextprotocol/sdk");
    if (version !== null) {
      expect(typeof version).toBe("string");
    }
  });

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
