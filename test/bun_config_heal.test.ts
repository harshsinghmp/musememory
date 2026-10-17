import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { healBunGlobalConfig } from "../src/cli/upgrade.ts";

describe("T-396: healBunGlobalConfig safety, backup, and opt-in gate", () => {
  let tmpDir: string;
  let pkgPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-bun-heal-"));
    pkgPath = join(tmpDir, "package.json");
    delete process.env.MUSE_HEAL_BUN_CONFIG;
  });

  afterEach(() => {
    delete process.env.MUSE_HEAL_BUN_CONFIG;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("skips healing by default when opt-in gate is not passed", () => {
    writeFileSync(
      pkgPath,
      JSON.stringify({
        dependencies: {
          "": "1.0.0",
          "valid-pkg": "2.0.0",
        },
      }),
    );

    const result = healBunGlobalConfig({ packagePath: pkgPath });
    expect(result.skipped).toBe(true);
    expect(result.healed).toBe(false);
    expect(result.reason).toContain("Opt-in required");

    // File should not be modified
    const parsed = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(parsed.dependencies[""]).toBe("1.0.0");
    expect(existsSync(`${pkgPath}.bak`)).toBe(false);
  });

  test("creates .bak backup and removes empty keys when enabled: true", () => {
    const originalContent = JSON.stringify(
      {
        dependencies: {
          "": "1.0.0",
          " ": "1.2.0",
          "valid-pkg": "2.0.0",
        },
      },
      null,
      2,
    );
    writeFileSync(pkgPath, originalContent);

    const result = healBunGlobalConfig({ enabled: true, packagePath: pkgPath });
    expect(result.healed).toBe(true);
    expect(result.backupCreated).toBe(true);
    expect(result.skipped).toBe(false);

    // .bak backup must exist with original content
    expect(existsSync(`${pkgPath}.bak`)).toBe(true);
    expect(readFileSync(`${pkgPath}.bak`, "utf-8")).toBe(originalContent);

    // Repaired package.json should only contain valid keys
    const repaired = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(repaired.dependencies).toEqual({ "valid-pkg": "2.0.0" });
  });

  test("respects MUSE_HEAL_BUN_CONFIG=true environment variable as opt-in", () => {
    process.env.MUSE_HEAL_BUN_CONFIG = "true";
    writeFileSync(
      pkgPath,
      JSON.stringify({
        dependencies: {
          "": "1.0.0",
          "my-tool": "3.0.0",
        },
      }),
    );

    const result = healBunGlobalConfig({ packagePath: pkgPath });
    expect(result.healed).toBe(true);
    expect(result.skipped).toBe(false);

    const repaired = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(repaired.dependencies).toEqual({ "my-tool": "3.0.0" });
  });

  test("surfaces JSON syntax errors instead of swallowing silently", () => {
    writeFileSync(pkgPath, "{ invalid json content: true ");

    const result = healBunGlobalConfig({ enabled: true, packagePath: pkgPath });
    expect(result.healed).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Failed to heal bun global package.json");
  });

  test("returns skipped when package file does not exist", () => {
    const nonexistentPath = join(tmpDir, "does-not-exist.json");
    const result = healBunGlobalConfig({ enabled: true, packagePath: nonexistentPath });
    expect(result.skipped).toBe(true);
    expect(result.healed).toBe(false);
    expect(result.reason).toContain("not found");
  });
});
