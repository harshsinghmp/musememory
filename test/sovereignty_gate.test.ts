import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { executeSecretScan } from "../src/cli/secrets.ts";
import { collectSystemTerrain } from "../src/vault/system.ts";
import { initUserProfile } from "../src/user.ts";

describe("T-448: Sovereign Ecosystem & Decommissioning Gate", () => {
  it("verifies global ~/.memory/USER.md is populated and sovereign", () => {
    const userMdPath = join(homedir(), ".memory", "USER.md");
    if (!existsSync(userMdPath)) {
      initUserProfile(join(homedir(), ".memory"), "developer");
    }
    expect(existsSync(userMdPath)).toBe(true);

    const content = readFileSync(userMdPath, "utf8");
    expect(content.length).toBeGreaterThan(0);
    expect(content).not.toContain("@LIFEOS");
  });

  it("verifies native Vibeguard secret scanner is active and functional", async () => {
    const result = await executeSecretScan({ targetDir: "src" });
    expect(result.clean).toBe(true);
    expect(result.scannedFiles).toBeGreaterThan(100);
  });

  it("verifies machine terrain collector inspects host and toolchains", async () => {
    const terrain = await collectSystemTerrain();
    expect(terrain.host.platform).toBeDefined();
    expect(terrain.toolchains.bunVersion).toBeDefined();
  });

  it("verifies global ~/.agents/AGENTS.md has zero @LIFEOS imports", () => {
    const globalAgentsMd = join(homedir(), ".agents", "AGENTS.md");
    if (existsSync(globalAgentsMd)) {
      const content = readFileSync(globalAgentsMd, "utf8");
      expect(content).not.toContain("@LIFEOS");
    }
  });

  it("verifies legacy ingestion engine tool has been completely removed from source", () => {
    const legacyToolPath = join(process.cwd(), "src", "cli", "import_lifeos.ts");
    expect(existsSync(legacyToolPath)).toBe(false);
  });

  it("verifies lifeos_retirement.md documentation exists", () => {
    const docPath = join(process.cwd(), "docs", "lifeos_retirement.md");
    expect(existsSync(docPath)).toBe(true);
    const content = readFileSync(docPath, "utf8");
    expect(content).toContain("Ecosystem Decommissioning & Retirement Gate");
  });
});
