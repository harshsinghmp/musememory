import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectAgent, disconnectSingleAgent, disconnectAllAgents } from "../src/connect.ts";
import { detectAgents } from "../src/agents/detect.ts";

describe("Phase 8: Multi-Agent MCP Connect/Disconnect Full Lifecycle", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "muse-connect-lifecycle-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("completes full connect -> verify -> disconnect single -> disconnect all lifecycle", () => {
    // 1. Setup mock installations for 4 diverse agent formats:
    // - Antigravity (standard-mcp-servers in .gemini/antigravity-cli/mcp_config.json)
    // - Cursor (cursor-json in .cursor/mcp.json)
    // - Hermes (yaml-hermes in .hermes/config.yaml)
    // - OpenCode (opencode-json in .config/opencode/opencode.json)
    mkdirSync(join(home, ".gemini", "antigravity-cli"), { recursive: true });
    mkdirSync(join(home, ".cursor"), { recursive: true });
    mkdirSync(join(home, ".hermes"), { recursive: true });
    writeFileSync(join(home, ".hermes", "config.yaml"), "mcp_servers: {}\n", "utf8");
    mkdirSync(join(home, ".config", "opencode"), { recursive: true });
    writeFileSync(join(home, ".config", "opencode", "opencode.json"), '{"mcp": {}}\n', "utf8");

    // 2. Connect all installed agents
    const connectReports = connectAgent("all", home);
    expect(connectReports.length).toBeGreaterThanOrEqual(4);

    const connectedAgents = connectReports.map((r) => r.agent);
    expect(connectedAgents).toContain("antigravity");
    expect(connectedAgents).toContain("cursor");
    expect(connectedAgents).toContain("hermes");
    expect(connectedAgents).toContain("opencode");

    // 3. Verify configurations on disk
    // - Antigravity
    const antigravityConf = JSON.parse(readFileSync(join(home, ".gemini", "antigravity-cli", "mcp_config.json"), "utf8"));
    expect(antigravityConf.mcpServers.memory.command).toBe("memory");

    // - Cursor
    const cursorConf = JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8"));
    expect(cursorConf.mcpServers.memory.command).toBe("memory");
    expect(cursorConf.autoApprove).toContain("memory");

    // - Hermes
    const hermesRaw = readFileSync(join(home, ".hermes", "config.yaml"), "utf8");
    expect(hermesRaw).toContain("memory");

    // - OpenCode
    const opencodeConf = JSON.parse(readFileSync(join(home, ".config", "opencode", "opencode.json"), "utf8"));
    expect(opencodeConf.mcp.memory.command).toEqual(["memory", "mcp"]);

    // 4. Verify detectAgents reports all 4 as connected
    const detectedAfterConnect = detectAgents(home);
    const connectedAfter = detectedAfterConnect.filter((a) => a.connected);
    const connectedIds = connectedAfter.map((a) => a.id);
    expect(connectedIds).toContain("antigravity");
    expect(connectedIds).toContain("cursor");
    expect(connectedIds).toContain("hermes");
    expect(connectedIds).toContain("opencode");

    // 5. Disconnect single agent (Cursor)
    const discCursor = disconnectSingleAgent("cursor", home);
    expect(discCursor.updated).toBe(true);

    const cursorConfAfter = JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8"));
    expect(cursorConfAfter.mcpServers?.memory).toBeUndefined();

    // 6. Disconnect all remaining agents
    const discAll = disconnectAllAgents(home);
    expect(discAll.length).toBeGreaterThanOrEqual(3);

    // 7. Verify all are now disconnected
    const detectedAfterDisc = detectAgents(home);
    const stillConnected = detectedAfterDisc.filter((a) => a.connected);
    expect(stillConnected.length).toBe(0);

    // 8. Idempotency test: disconnecting again does not fail or throw
    const discAgain = disconnectAllAgents(home);
    expect(discAgain.length).toBe(0);
  });
});
