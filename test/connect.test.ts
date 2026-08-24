import { describe, test, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { connectAgent, connectClaudeCode, connectCursor, ALL_MEMORY_TOOLS } from "../src/connect.ts";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "connect-test-"));
}

describe("multi-agent connect and zero-permission auto-wiring", () => {
  test("connectClaudeCode wires mcp config without creating .claude folder when absent", () => {
    const home = temp();
    const report = connectClaudeCode(home);
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
    const report = connectClaudeCode(home);
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

    const reports = connectAgent("all", home);
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
    const reports = connectAgent("claude-code", home, { dryRun: true, force: true });
    expect(reports[0].updated).toBe(true);
    expect(existsSync(join(home, ".claude.json"))).toBe(false);
    expect(existsSync(join(home, ".claude", "settings.json"))).toBe(false);

    rmSync(home, { recursive: true, force: true });
  });
});
