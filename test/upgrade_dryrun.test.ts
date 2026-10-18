import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repairInstallation } from "../src/cli/upgrade.ts";

describe("T-341: repairInstallation dryRun flag enforcement", () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-upgrade-dryrun-test-"));
    memoryDir = join(tmpDir, ".memory");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not create any directories or files when dryRun is true", async () => {
    const result = await repairInstallation({
      workspaceRoot: tmpDir,
      memoryDir,
      dryRun: true,
      skipAgentConnect: true,
    });

    expect(result.repaired).toBe(true);
    expect(existsSync(join(memoryDir, "memories"))).toBe(false);
    expect(existsSync(join(memoryDir, "CURRENT.md"))).toBe(false);
    expect(existsSync(join(memoryDir, "USER.md"))).toBe(false);

    expect(result.actionsTaken.some((a) => a.includes("[dry-run] Would create missing memories directory"))).toBe(true);
    expect(result.actionsTaken.some((a) => a.includes("[dry-run] Would recover missing CURRENT.md"))).toBe(true);
    expect(result.actionsTaken.some((a) => a.includes("[dry-run] Would recover missing USER.md"))).toBe(true);
  });

  it("creates missing directories and files when dryRun is false", async () => {
    const result = await repairInstallation({
      workspaceRoot: tmpDir,
      memoryDir,
      dryRun: false,
      skipAgentConnect: true,
    });

    expect(result.repaired).toBe(true);
    expect(existsSync(join(memoryDir, "memories"))).toBe(true);
    expect(existsSync(join(memoryDir, "CURRENT.md"))).toBe(true);
    expect(existsSync(join(memoryDir, "USER.md"))).toBe(true);

    expect(result.actionsTaken.some((a) => a.includes("Created missing memories directory"))).toBe(true);
    expect(result.actionsTaken.some((a) => a.includes("Recovered missing CURRENT.md"))).toBe(true);
    expect(result.actionsTaken.some((a) => a.includes("Recovered missing USER.md"))).toBe(true);
  });
});
