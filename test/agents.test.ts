import { describe, test, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import yaml from "js-yaml";
import { detectAgents } from "../src/agents/detect.ts";
import { AGENT_REGISTRY } from "../src/agents/registry.ts";
import { connectAgent, connectHermes, connectOpenCode, connectGoose, connectOpenClaw, ALL_MEMORY_TOOLS } from "../src/connect.ts";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "agents-test-"));
}

describe("80+ coding agent baseline registry & smart auto-detection", () => {
  test("registry includes comprehensive baseline of coding agents", () => {
    expect(AGENT_REGISTRY.length).toBeGreaterThan(45);
    const ids = AGENT_REGISTRY.map((a) => a.id);
    expect(ids).toContain("hermes");
    expect(ids).toContain("opencode");
    expect(ids).toContain("claw-code");
    expect(ids).toContain("gemini-cli");
    expect(ids).toContain("codex");
    expect(ids).toContain("pi");
    expect(ids).toContain("openhands");
    expect(ids).toContain("open-interpreter");
    expect(ids).toContain("goose");
    expect(ids).toContain("aider");
    expect(ids).toContain("continue");
    expect(ids).toContain("crush");
    expect(ids).toContain("openclaw");
    expect(ids).toContain("claude-code");
    expect(ids).toContain("cursor");
  });

  test("detectAgents identifies installed agents and skips non-existent ones", () => {
    const home = temp();
    mkdirSync(join(home, ".hermes"), { recursive: true });
    mkdirSync(join(home, ".config", "opencode"), { recursive: true });
    mkdirSync(join(home, ".cursor"), { recursive: true });

    const detected = detectAgents(home);
    const installed = detected.filter((a) => a.installed);
    const installedIds = installed.map((a) => a.id);

    expect(installedIds).toContain("hermes");
    expect(installedIds).toContain("opencode");
    expect(installedIds).toContain("cursor");

    // Ensure non-existent agents are not marked installed
    const nanobot = detected.find((a) => a.id === "nanobot");
    expect(nanobot?.installed).toBe(false);

    rmSync(home, { recursive: true, force: true });
  });

  test("connectAgent('all') connects ONLY installed agents and leaves out all uninstalled", () => {
    const home = temp();
    // Simulate a machine with only Hermes and OpenCode installed
    mkdirSync(join(home, ".hermes"), { recursive: true });
    writeFileSync(join(home, ".hermes", "config.yaml"), "mcp_servers: {}\n", "utf8");
    
    mkdirSync(join(home, ".config", "opencode"), { recursive: true });
    writeFileSync(join(home, ".config", "opencode", "opencode.json"), "{}\n", "utf8");

    const reports = connectAgent("all", home);
    const connectedIds = reports.map((r) => r.agent);

    expect(connectedIds).toContain("hermes");
    expect(connectedIds).toContain("opencode");

    // Verify uninstalled agents were NOT created or touched
    expect(existsSync(join(home, ".goose"))).toBe(false);
    expect(existsSync(join(home, ".continue"))).toBe(false);
    expect(existsSync(join(home, ".cline"))).toBe(false);
    expect(existsSync(join(home, ".openhands"))).toBe(false);
    expect(existsSync(join(home, ".nanobot"))).toBe(false);

    // Verify Hermes YAML configuration
    const hermesYaml = yaml.load(readFileSync(join(home, ".hermes", "config.yaml"), "utf8")) as any;
    expect(hermesYaml.mcp_servers.memory.command).toBe("memory");
    expect(hermesYaml.mcp_servers.memory.enabled).toBe(true);

    // Verify OpenCode JSON configuration
    const opencodeJson = JSON.parse(readFileSync(join(home, ".config", "opencode", "opencode.json"), "utf8"));
    expect(opencodeJson.mcp.memory.command).toEqual(["memory", "mcp"]);
    expect(opencodeJson.mcp.memory.enabled).toBe(true);

    rmSync(home, { recursive: true, force: true });
  });

  test("connectGoose and connectOpenClaw wire MCP configurations properly", () => {
    const home = temp();
    mkdirSync(join(home, ".config", "goose"), { recursive: true });
    mkdirSync(join(home, ".openclaw"), { recursive: true });
    
    // Goose
    const gooseReport = connectGoose(home);
    expect(gooseReport.agent).toBe("goose");
    const gooseDoc = yaml.load(readFileSync(join(home, ".config", "goose", "config.yaml"), "utf8")) as any;
    expect(gooseDoc.extensions.memory.cmd).toBe("memory");

    // OpenClaw
    const openclawReport = connectOpenClaw(home);
    expect(openclawReport.agent).toBe("openclaw");
    const openclawJson = JSON.parse(readFileSync(join(home, ".openclaw", "openclaw.json"), "utf8"));
    expect(openclawJson.mcp.memory.command).toEqual(["memory", "mcp"]);

    rmSync(home, { recursive: true, force: true });
  });
});
