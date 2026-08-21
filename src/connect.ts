import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export const ALL_MEMORY_TOOLS = [
  "memory_read",
  "get_context",
  "search",
  "memory_capture",
  "memory_harvest",
  "memory_import_transcript",
  "memory_recall",
  "memory_confirm",
  "memory_supersede",
  "memory_link",
  "memory_mark_stale",
  "memory_reject",
  "memory_delete",
  "memory_audit",
  "memory_export",
  "memory_import",
  "memory_validate",
  "graph_status",
];

export interface ConnectOptions {
  dryRun?: boolean;
  force?: boolean;
}

export interface ConnectReport {
  agent: string;
  configPath: string;
  updated: boolean;
  permissionAutoApproved: boolean;
  message: string;
}

function safeReadJson(path: string): Record<string, any> {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function safeWriteJson(path: string, data: Record<string, any>, dryRun = false): void {
  if (dryRun) return;
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/**
 * Configure Claude Code with stdio MCP server & pre-approved tool permissions.
 */
export function connectClaudeCode(home: string = homedir(), options: ConnectOptions = {}): ConnectReport {
  const claudeJsonPath = join(home, ".claude.json");
  const settingsJsonPath = join(home, ".claude", "settings.json");

  const mcpConfig = safeReadJson(claudeJsonPath);
  if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
  mcpConfig.mcpServers.memory = {
    command: "memory",
    args: ["mcp"],
  };
  safeWriteJson(claudeJsonPath, mcpConfig, options.dryRun);

  const settings = safeReadJson(settingsJsonPath);
  const existingAllowed = Array.isArray(settings.allowedTools) ? settings.allowedTools : [];
  const merged = Array.from(new Set([...existingAllowed, ...ALL_MEMORY_TOOLS]));
  settings.allowedTools = merged;
  safeWriteJson(settingsJsonPath, settings, options.dryRun);

  return {
    agent: "claude-code",
    configPath: `${claudeJsonPath} & ${settingsJsonPath}`,
    updated: true,
    permissionAutoApproved: true,
    message: `Wired MCP to ${claudeJsonPath} and auto-approved ${ALL_MEMORY_TOOLS.length} tools in ${settingsJsonPath}`,
  };
}

/**
 * Configure Cursor with stdio MCP server & autoApprove.
 */
export function connectCursor(home: string = homedir(), options: ConnectOptions = {}): ConnectReport {
  const cursorMcpPath = join(home, ".cursor", "mcp.json");
  const config = safeReadJson(cursorMcpPath);
  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers.memory = {
    command: "memory",
    args: ["mcp"],
  };
  if (!Array.isArray(config.autoApprove)) {
    config.autoApprove = [];
  }
  if (!config.autoApprove.includes("memory")) {
    config.autoApprove.push("memory");
  }
  safeWriteJson(cursorMcpPath, config, options.dryRun);

  return {
    agent: "cursor",
    configPath: cursorMcpPath,
    updated: true,
    permissionAutoApproved: true,
    message: `Wired MCP and enabled autoApprove in ${cursorMcpPath}`,
  };
}

/**
 * Configure Antigravity CLI with stdio MCP server.
 */
export function connectAntigravity(home: string = homedir(), options: ConnectOptions = {}): ConnectReport {
  const agConfigPath = join(home, ".gemini", "antigravity-cli", "mcp_config.json");
  const config = safeReadJson(agConfigPath);
  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers.memory = {
    command: "memory",
    args: ["mcp"],
  };
  safeWriteJson(agConfigPath, config, options.dryRun);

  return {
    agent: "antigravity",
    configPath: agConfigPath,
    updated: true,
    permissionAutoApproved: true,
    message: `Wired MCP server in ${agConfigPath}`,
  };
}

/**
 * Configure Windsurf with stdio MCP server.
 */
export function connectWindsurf(home: string = homedir(), options: ConnectOptions = {}): ConnectReport {
  const windsurfPath = join(home, ".codeium", "windsurf", "mcp_config.json");
  const config = safeReadJson(windsurfPath);
  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers.memory = {
    command: "memory",
    args: ["mcp"],
  };
  safeWriteJson(windsurfPath, config, options.dryRun);

  return {
    agent: "windsurf",
    configPath: windsurfPath,
    updated: true,
    permissionAutoApproved: true,
    message: `Wired MCP server in ${windsurfPath}`,
  };
}

/**
 * Configure Codex CLI with stdio MCP server.
 */
export function connectCodex(home: string = homedir(), options: ConnectOptions = {}): ConnectReport {
  const codexPath = join(home, ".codex", "mcp.json");
  const config = safeReadJson(codexPath);
  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers.memory = {
    command: "memory",
    args: ["mcp"],
  };
  safeWriteJson(codexPath, config, options.dryRun);

  return {
    agent: "codex",
    configPath: codexPath,
    updated: true,
    permissionAutoApproved: true,
    message: `Wired MCP server in ${codexPath}`,
  };
}

/**
 * Configure Gemini CLI with stdio MCP server.
 */
export function connectGemini(home: string = homedir(), options: ConnectOptions = {}): ConnectReport {
  const geminiPath = join(home, ".gemini", "mcp_config.json");
  const config = safeReadJson(geminiPath);
  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers.memory = {
    command: "memory",
    args: ["mcp"],
  };
  safeWriteJson(geminiPath, config, options.dryRun);

  return {
    agent: "gemini-cli",
    configPath: geminiPath,
    updated: true,
    permissionAutoApproved: true,
    message: `Wired MCP server in ${geminiPath}`,
  };
}

/**
 * Wire memory into specified agent or all detected agents.
 */
export function connectAgent(agentName: string, home: string = homedir(), options: ConnectOptions = {}): ConnectReport[] {
  const target = agentName.toLowerCase().trim();
  const reports: ConnectReport[] = [];

  if (target === "all" || target === "--all" || target === "") {
    reports.push(connectClaudeCode(home, options));
    reports.push(connectCursor(home, options));
    reports.push(connectAntigravity(home, options));
    reports.push(connectWindsurf(home, options));
    reports.push(connectCodex(home, options));
    reports.push(connectGemini(home, options));
    return reports;
  }

  switch (target) {
    case "claude":
    case "claude-code":
      reports.push(connectClaudeCode(home, options));
      break;
    case "cursor":
      reports.push(connectCursor(home, options));
      break;
    case "antigravity":
    case "antigravity-cli":
      reports.push(connectAntigravity(home, options));
      break;
    case "windsurf":
      reports.push(connectWindsurf(home, options));
      break;
    case "codex":
      reports.push(connectCodex(home, options));
      break;
    case "gemini":
    case "gemini-cli":
      reports.push(connectGemini(home, options));
      break;
    default:
      throw new Error(`Unsupported agent adapter: ${agentName}. Supported: claude-code, cursor, antigravity, windsurf, codex, gemini-cli, all`);
  }

  return reports;
}
