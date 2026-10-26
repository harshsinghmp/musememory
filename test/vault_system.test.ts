import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  collectSystemTerrain,
  formatSystemTerrainMarkdown,
  writeSystemTerrainMap,
  handleTerrainCommand,
} from "../src/vault/system.ts";

describe("T-446: Machine Terrain Collector in src/vault/", () => {
  let tempBase: string;

  beforeEach(() => {
    tempBase = join(tmpdir(), `muse-vault-terrain-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    mkdirSync(tempBase, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempBase, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("collects host hardware, toolchains, and agent ecosystem terrain", async () => {
    const terrain = await collectSystemTerrain();

    expect(terrain.host.platform).toBeDefined();
    expect(terrain.host.arch).toBeDefined();
    expect(terrain.host.cpus.count).toBeGreaterThan(0);
    expect(terrain.host.totalMemoryGb).toBeGreaterThan(0);

    // Active toolchain (bun must be present)
    expect(terrain.toolchains.bunVersion).toBeDefined();
    expect(typeof terrain.toolchains.bunVersion).toBe("string");

    // Agent ecosystem
    expect(Array.isArray(terrain.agentEcosystem.detectedAgents)).toBe(true);
  });

  it("formats deterministic markdown document without secret traps", async () => {
    const terrain = await collectSystemTerrain();
    const md = formatSystemTerrainMarkdown(terrain);

    expect(md).toContain("# Machine & System Terrain");
    expect(md).toContain("## 🖥️ Host & Hardware");
    expect(md).toContain("## 🛠️ Toolchains & Runtimes");
    expect(md).toContain("## 🤖 Agent Ecosystem");
    expect(md).toContain(terrain.host.platform);
    expect(md).not.toContain("password");
    expect(md).not.toContain("sk-");
  });

  it("writes system.md into target vault directory", async () => {
    const filePath = await writeSystemTerrainMap(tempBase);
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf8");
    expect(content).toContain("# Machine & System Terrain");
  });

  it("executes CLI command with exit code 0", async () => {
    const code = await handleTerrainCommand({
      positional: [],
      flags: { out: join(tempBase, "custom-system.md"), silent: "true" },
    });
    expect(code).toBe(0);
    expect(existsSync(join(tempBase, "custom-system.md"))).toBe(true);
  });
});
