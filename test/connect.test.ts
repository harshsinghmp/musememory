import { describe, test, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { connectAgent, connectClaudeCode, connectCursor, ALL_MEMORY_TOOLS } from "../src/connect.ts";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "connect-test-"));
}

describe("multi-agent connect and zero-permission auto-wiring", () => {
  test("connectClaudeCode wires mcp config without creating .claude folder when absent", () => {
    const home = temp();
    const report = connectClaudeCode(home, { harness: "claude" });
    expect(report.agent).toBe("claude-code");
    expect(report.permissionAutoApproved).toBe(false);

    const claudeJson = JSON.parse(readFileSync(join(home, ".claude.json"), "utf8"));
    expect(claudeJson.mcpServers.memory.command).toBe("memory");

    // Zero-folder-creation policy: no .claude directory may be fabricated.
    expect(existsSync(join(home, ".claude"))).toBe(false);

    rmSync(home, { recursive: true, force: true });
  });

  test("connectClaudeCode auto-approves tools only into existing .claude settings", () => {
    const home = temp();
    mkdirSync(join(home, ".claude"), { recursive: true });
    const report = connectClaudeCode(home, { harness: "claude" });
    expect(report.permissionAutoApproved).toBe(true);

    const settingsJson = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
    expect(Array.isArray(settingsJson.allowedTools)).toBe(true);
    for (const tool of ALL_MEMORY_TOOLS) {
      expect(settingsJson.allowedTools).toContain(tool);
    }

    rmSync(home, { recursive: true, force: true });
  });

  test("connectCursor updates existing .cursor dir without creating it", () => {
    const home = temp();
    mkdirSync(join(home, ".cursor"), { recursive: true });
    const report = connectCursor(home);
    expect(report.agent).toBe("cursor");
    expect(report.permissionAutoApproved).toBe(true);

    const cursorMcp = JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8"));
    expect(cursorMcp.mcpServers.memory.command).toBe("memory");
    expect(cursorMcp.autoApprove).toContain("memory");

    rmSync(home, { recursive: true, force: true });
  });

  test("connect skips agents whose config directories do not exist", () => {
    const home = temp();
    const report = connectCursor(home);
    expect(report.updated).toBe(false);
    expect(existsSync(join(home, ".cursor"))).toBe(false);
    expect(report.message).toContain("--force");

    rmSync(home, { recursive: true, force: true });
  });

  test("connectAgent('all') wires detected installed agent platforms", () => {
    const home = temp();
    mkdirSync(join(home, ".claude"), { recursive: true });
    mkdirSync(join(home, ".cursor"), { recursive: true });
    mkdirSync(join(home, ".gemini", "antigravity-cli"), { recursive: true });
    mkdirSync(join(home, ".codeium", "windsurf"), { recursive: true });
    mkdirSync(join(home, ".codex"), { recursive: true });

    const reports = connectAgent("all", home, { harness: "claude" });
    expect(reports.length).toBeGreaterThanOrEqual(5);

    const agents = reports.map((r) => r.agent);
    expect(agents).toContain("claude-code");
    expect(agents).toContain("cursor");
    expect(agents).toContain("antigravity");
    expect(agents).toContain("windsurf");
    expect(agents).toContain("codex");

    rmSync(home, { recursive: true, force: true });
  });

  test("dryRun does not write files to disk", () => {
    const home = temp();
    const reports = connectAgent("claude-code", home, { dryRun: true, force: true, harness: "claude" });
    expect(reports[0].updated).toBe(true);
    expect(existsSync(join(home, ".claude.json"))).toBe(false);
    expect(existsSync(join(home, ".claude", "settings.json"))).toBe(false);

    rmSync(home, { recursive: true, force: true });
  });
});

describe("harness-independent claude wiring (T-390)", () => {
  test("pre-existing .claude config does NOT opt in: nothing is written without --harness", () => {
    const home = temp();
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ model: "opus" }), "utf8");

    const report = connectClaudeCode(home);
    expect(report.updated).toBe(false);
    expect(report.installed).toBe(false);
    expect(report.permissionAutoApproved).toBe(false);
    expect(report.message).toContain("--harness claude");

    // No MCP server written, no tool permissions injected.
    expect(existsSync(join(home, ".claude.json"))).toBe(false);
    const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
    expect(settings.allowedTools).toBeUndefined();

    rmSync(home, { recursive: true, force: true });
  });

  test("--harness claude opts in and wires MCP plus tool permissions", () => {
    const home = temp();
    mkdirSync(join(home, ".claude"), { recursive: true });

    const report = connectClaudeCode(home, { harness: "claude" });
    expect(report.updated).toBe(true);
    expect(report.permissionAutoApproved).toBe(true);
    expect(JSON.parse(readFileSync(join(home, ".claude.json"), "utf8")).mcpServers.memory.args).toEqual([
      "mcp",
    ]);

    rmSync(home, { recursive: true, force: true });
  });

  test("a mismatched --harness name never opts in", () => {
    const home = temp();
    const report = connectClaudeCode(home, { harness: "cursor", force: true });
    expect(report.updated).toBe(false);
    expect(existsSync(join(home, ".claude.json"))).toBe(false);

    rmSync(home, { recursive: true, force: true });
  });
});
