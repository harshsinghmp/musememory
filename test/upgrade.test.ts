import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  detectPackageManager,
  formatProgressBar,
  getUpgradeMilestones,
  repairInstallation,
  type UpgradeStep,
} from "../src/cli/upgrade.ts";

describe("Automated Upgrade & Self-Healing Installer Engine", () => {
  const testDir = join(process.cwd(), ".tmp-test-upgrade");

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it("formats gamified ASCII progress bars accurately", () => {
    const bar0 = formatProgressBar(0, 20);
    expect(bar0).toBe("[░░░░░░░░░░░░░░░░░░░░] 0%");

    const bar50 = formatProgressBar(50, 20);
    expect(bar50).toBe("[██████████░░░░░░░░░░] 50%");

    const bar100 = formatProgressBar(100, 20);
    expect(bar100).toBe("[████████████████████] 100%");
  });

  it("detects installed package manager or defaults to bun/npm", () => {
    const pm = detectPackageManager();
    expect(["bun", "npm", "pnpm", "yarn"]).toContain(pm);
  });

  it("provides structured gamified upgrade milestones", () => {
    const milestones = getUpgradeMilestones();
    expect(milestones.length).toBeGreaterThanOrEqual(4);
    expect(milestones[0].stage).toContain("Vibeguard");
    expect(milestones[milestones.length - 1].stage).toContain("Complete");
  });

  it("repairs missing CURRENT.md, USER.md, and skills in workspace", async () => {
    const memoryDir = join(testDir, ".memory");
    mkdirSync(memoryDir, { recursive: true });

    // Missing CURRENT.md and USER.md initially
    expect(existsSync(join(memoryDir, "CURRENT.md"))).toBe(false);

    const result = await repairInstallation({
      workspaceRoot: testDir,
      memoryDir,
      skipAgentConnect: true,
    });

    expect(result.repaired).toBe(true);
    expect(existsSync(join(memoryDir, "CURRENT.md"))).toBe(true);
    expect(existsSync(join(memoryDir, "USER.md"))).toBe(true);
    expect(existsSync(join(memoryDir, "memories"))).toBe(true);
  });
});
