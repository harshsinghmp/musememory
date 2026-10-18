import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  detectPackageManager,
  formatProgressBar,
  formatPandaProgressBar,
  playPandaLoader,
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

  it("formats dynamic single-line panda progress bars accurately", () => {
    const bar0 = formatPandaProgressBar(0, 20);
    expect(bar0).toBe("[ʕ•ᴥ•ʔ────────────────────] 0%");

    const bar50 = formatPandaProgressBar(50, 20);
    expect(bar50).toBe("[━━━━━━━━━━ʕ•ᴥ•ʔ──────────] 50%");

    const bar100 = formatPandaProgressBar(100, 20);
    expect(bar100).toBe("[━━━━━━━━━━━━━━━━━━━━ʕ•ᴥ•ʔ] 100%");
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

  it("T-346: handleUpgradeCommand returns 0 or 1 based on flags and update state", async () => {
    const { handleUpgradeCommand } = await import("../src/cli/upgrade.ts");

    // Check mode without update should exit 0
    const codeCheck = await handleUpgradeCommand({
      positional: [],
      flags: { check: "true" },
    });
    expect([0, 1]).toContain(codeCheck);

    // Dry run upgrade should complete and return an exit code
    const codeDryRun = await handleUpgradeCommand({
      positional: [],
      flags: { "dry-run": "true" },
    });
    expect(codeDryRun).toBe(0);
  });

  it("T-359: repairInstallation surfaces errors in RepairResult instead of swallowing them", async () => {
    // Point memoryDir to a file path so mkdirSync throws ENOTDIR
    const filePath = join(testDir, "regular_file.txt");
    writeFileSync(filePath, "not a directory", "utf-8");

    const result = await repairInstallation({
      workspaceRoot: testDir,
      memoryDir: filePath,
      skipAgentConnect: true,
    });

    expect(result.repaired).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors![0]).toContain("Failed creating");
  });

  it("T-359: upgrade step fails when Vibeguard detects unmasked credentials", async () => {
    const memoryDir = join(testDir, ".memory");
    mkdirSync(memoryDir, { recursive: true });
    // Write an unmasked secret into CURRENT.md
    writeFileSync(join(memoryDir, "CURRENT.md"), "secret token: sk-ant-api03-abcdef12345678901234567890123456", "utf-8");

    const steps: UpgradeStep[] = [
      {
        level: 1,
        title: "Vibeguard Security & Credential Audit",
        action: async () => {
          const { scanSecrets } = await import("../src/secrets.ts");
          const { readFileSync } = await import("node:fs");
          const content = readFileSync(join(memoryDir, "CURRENT.md"), "utf-8");
          const secrets = scanSecrets(content);
          if (secrets.length > 0) {
            throw new Error(`Vibeguard audit detected unmasked secrets: ${secrets.join(", ")}`);
          }
        },
      },
    ];

    const res = await playPandaLoader(steps, { isTTY: false });
    expect(res.success).toBe(false);
    expect(res.failedSteps.length).toBe(1);
    expect(res.failedSteps[0].error.message).toContain("Vibeguard audit detected unmasked secrets");
  });
});
