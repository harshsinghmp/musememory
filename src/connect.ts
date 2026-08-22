import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";
import { detectAgents } from "./agents/detect.ts";
import { AGENT_REGISTRY } from "./agents/registry.ts";
import type { ConnectOptions, ConnectReport, DetectedAgent } from "./agents/types.ts";

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
  "memory_detect_providers",
  "memory_migrate",
  "memory_detect_agents",
  "memory_export",
  "memory_import",
  "memory_validate",
  "graph_status",
];

export { ConnectOptions, ConnectReport };

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

function safeReadYaml(path: string): Record<string, any> {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = yaml.load(raw);
    return (parsed && typeof parsed === "object") ? (parsed as Record<string, any>) : {};
  } catch {
    return {};
  }
}

function safeWriteYaml(path: string, data: Record<string, any>, dryRun = false): void {
  if (dryRun) return;
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const dumped = yaml.dump(data, { indent: 2, lineWidth: -1 });
  writeFileSync(path, dumped, "utf8");
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
    agentName: "Claude Code",
    configPath: `${claudeJsonPath} & ${settingsJsonPath}`,
    updated: true,
    installed: true,
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
    agentName: "Cursor",
    configPath: cursorMcpPath,
    updated: true,
    installed: true,
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
    agentName: "Antigravity",
    configPath: agConfigPath,
    updated: true,
    installed: true,
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
    agentName: "Windsurf",
    configPath: windsurfPath,
    updated: true,
    installed: true,
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
    agentName: "Codex CLI",
    configPath: codexPath,
    updated: true,
    installed: true,
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
    agentName: "Gemini CLI",
    configPath: geminiPath,
    updated: true,
    installed: true,
    permissionAutoApproved: true,
    message: `Wired MCP server in ${geminiPath}`,
  };
}

/**
 * Configure Hermes Agent with stdio MCP server in config.yaml.
 */
export function connectHermes(home: string = homedir(), options: ConnectOptions = {}): ConnectReport {
  const hermesConfigPath = join(home, ".hermes", "config.yaml");
  const doc = safeReadYaml(hermesConfigPath);
  if (!doc.mcp_servers) doc.mcp_servers = {};
  doc.mcp_servers.memory = {
    command: "memory",
    args: ["mcp"],
    timeout: 120,
    connect_timeout: 60,
    enabled: true,
  };
  safeWriteYaml(hermesConfigPath, doc, options.dryRun);

  return {
    agent: "hermes",
    agentName: "Hermes Agent",
    configPath: hermesConfigPath,
    updated: true,
    installed: true,
    permissionAutoApproved: true,
    message: `Wired MCP server in ${hermesConfigPath}`,
  };
}

/**
 * Configure OpenCode with local stdio MCP server.
 */
export function connectOpenCode(home: string = homedir(), options: ConnectOptions = {}): ConnectReport {
  const opencodeConfigPath = join(home, ".config", "opencode", "opencode.json");
  const fallbackPath = join(home, ".opencode", "opencode.json");
  const targetPath = existsSync(opencodeConfigPath) ? opencodeConfigPath : (existsSync(fallbackPath) ? fallbackPath : opencodeConfigPath);

  const config = safeReadJson(targetPath);
  if (!config.mcp) config.mcp = {};
  config.mcp.memory = {
    type: "local",
    command: ["memory", "mcp"],
    enabled: true,
  };
  safeWriteJson(targetPath, config, options.dryRun);

  return {
    agent: "opencode",
    agentName: "OpenCode",
    configPath: targetPath,
    updated: true,
    installed: true,
    permissionAutoApproved: true,
    message: `Wired MCP server into ${targetPath}`,
  };
}

/**
 * Configure OpenClaw with stdio MCP server.
 */
export function connectOpenClaw(home: string = homedir(), options: ConnectOptions = {}): ConnectReport {
  const openclawPath = join(home, ".openclaw", "openclaw.json");
  const config = safeReadJson(openclawPath);
  if (!config.mcp) config.mcp = {};
  config.mcp.memory = {
    command: ["memory", "mcp"],
    enabled: true,
  };
  safeWriteJson(openclawPath, config, options.dryRun);

  return {
    agent: "openclaw",
    agentName: "OpenClaw",
    configPath: openclawPath,
    updated: true,
    installed: true,
    permissionAutoApproved: true,
    message: `Wired MCP server in ${openclawPath}`,
  };
}

/**
 * Configure Goose with stdio MCP server.
 */
export function connectGoose(home: string = homedir(), options: ConnectOptions = {}): ConnectReport {
  const goosePath = join(home, ".config", "goose", "config.yaml");
  const fallbackPath = join(home, ".goose", "config.yaml");
  const targetPath = existsSync(goosePath) ? goosePath : (existsSync(fallbackPath) ? fallbackPath : goosePath);

  const doc = safeReadYaml(targetPath);
  if (!doc.extensions) doc.extensions = {};
  doc.extensions.memory = {
    cmd: "memory",
    args: ["mcp"],
    enabled: true,
    type: "stdio",
  };
  safeWriteYaml(targetPath, doc, options.dryRun);

  return {
    agent: "goose",
    agentName: "Goose",
    configPath: targetPath,
    updated: true,
    installed: true,
    permissionAutoApproved: true,
    message: `Wired MCP extension in ${targetPath}`,
  };
}

/**
 * Configure Continue CLI/IDE with stdio MCP server.
 */
export function connectContinue(home: string = homedir(), options: ConnectOptions = {}): ConnectReport {
  const continuePath = join(home, ".continue", "config.json");
  const config = safeReadJson(continuePath);
  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers.memory = {
    command: "memory",
    args: ["mcp"],
  };
  safeWriteJson(continuePath, config, options.dryRun);

  return {
    agent: "continue",
    agentName: "Continue CLI",
    configPath: continuePath,
    updated: true,
    installed: true,
    permissionAutoApproved: true,
    message: `Wired MCP server in ${continuePath}`,
  };
}

/**
 * Configure Cline with stdio MCP server & autoApprove.
 */
export function connectCline(home: string = homedir(), options: ConnectOptions = {}): ConnectReport {
  const clinePath = join(home, ".cline", "mcp_settings.json");
  const config = safeReadJson(clinePath);
  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers.memory = {
    command: "memory",
    args: ["mcp"],
    disabled: false,
    autoApprove: ALL_MEMORY_TOOLS,
  };
  safeWriteJson(clinePath, config, options.dryRun);

  return {
    agent: "cline",
    agentName: "Cline CLI",
    configPath: clinePath,
    updated: true,
    installed: true,
    permissionAutoApproved: true,
    message: `Wired MCP server & autoApprove in ${clinePath}`,
  };
}

/**
 * Configure Roo Code CLI with stdio MCP server & autoApprove.
 */
export function connectRooCode(home: string = homedir(), options: ConnectOptions = {}): ConnectReport {
  const rooPath = join(home, ".roo", "mcp_settings.json");
  const config = safeReadJson(rooPath);
  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers.memory = {
    command: "memory",
    args: ["mcp"],
    disabled: false,
    autoApprove: ALL_MEMORY_TOOLS,
  };
  safeWriteJson(rooPath, config, options.dryRun);

  return {
    agent: "roo-code",
    agentName: "Roo Code CLI",
    configPath: rooPath,
    updated: true,
    installed: true,
    permissionAutoApproved: true,
    message: `Wired MCP server & autoApprove in ${rooPath}`,
  };
}

/**
 * Configure generic JSON-based MCP agent.
 */
export function connectGenericJsonAgent(agentId: string, agentName: string, relPath: string, home: string = homedir(), options: ConnectOptions = {}): ConnectReport {
  let targetPath = join(home, relPath);
  try {
    if (existsSync(targetPath) && statSync(targetPath).isDirectory()) {
      targetPath = join(targetPath, "mcp.json");
    } else if (!targetPath.endsWith(".json") && !targetPath.endsWith(".jsonc")) {
      targetPath = join(targetPath, "mcp.json");
    }
  } catch {
    if (!targetPath.endsWith(".json") && !targetPath.endsWith(".jsonc")) {
      targetPath = join(targetPath, "mcp.json");
    }
  }

  const config = safeReadJson(targetPath);
  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers.memory = {
    command: "memory",
    args: ["mcp"],
  };
  safeWriteJson(targetPath, config, options.dryRun);

  return {
    agent: agentId,
    agentName,
    configPath: targetPath,
    updated: true,
    installed: true,
    permissionAutoApproved: true,
    message: `Wired MCP server in ${targetPath}`,
  };
}

/**
 * Dispatch agent connection by ID.
 */
export function connectSingleAgent(agentId: string, home: string = homedir(), options: ConnectOptions = {}): ConnectReport {
  const id = agentId.toLowerCase().trim();
  switch (id) {
    case "claude":
    case "claude-code":
      return connectClaudeCode(home, options);
    case "cursor":
      return connectCursor(home, options);
    case "antigravity":
    case "antigravity-cli":
      return connectAntigravity(home, options);
    case "windsurf":
      return connectWindsurf(home, options);
    case "codex":
    case "codex-cli":
      return connectCodex(home, options);
    case "gemini":
    case "gemini-cli":
      return connectGemini(home, options);
    case "hermes":
    case "hermes-agent":
      return connectHermes(home, options);
    case "opencode":
    case "oh-my-openagent":
      return connectOpenCode(home, options);
    case "openclaw":
      return connectOpenClaw(home, options);
    case "goose":
      return connectGoose(home, options);
    case "continue":
      return connectContinue(home, options);
    case "cline":
      return connectCline(home, options);
    case "roo":
    case "roo-code":
      return connectRooCode(home, options);
    case "openhands":
      return connectGenericJsonAgent("openhands", "OpenHands", ".openhands/config.json", home, options);
    case "crush":
      return connectGenericJsonAgent("crush", "Crush", ".config/crush/crush.json", home, options);
    case "pi":
    case "oh-my-pi":
      return connectGenericJsonAgent("pi", "Pi", ".pi/mcp.json", home, options);
    case "letta":
    case "letta-code":
    case "lettabot":
      return connectGenericJsonAgent("letta", "Letta Code", ".letta/config.json", home, options);
    case "trae":
    case "trae-agent":
      return connectGenericJsonAgent("trae", "Trae Agent", ".trae/mcp.json", home, options);
    case "kimi":
    case "kimi-cli":
      return connectGenericJsonAgent("kimi", "Kimi CLI", ".kimi/mcp.json", home, options);
    default: {
      const matched = AGENT_REGISTRY.find(a => a.id === id || a.binaries.includes(id));
      if (matched && matched.configPaths.length > 0) {
        return connectGenericJsonAgent(matched.id, matched.name, matched.configPaths[0], home, options);
      }
      throw new Error(`Unsupported agent adapter: ${agentId}. Check 'memory agents' for the full list of 80+ supported agents.`);
    }
  }
}

/**
 * Wire memory into specified agent or AUTO-DETECT installed agents (leaving out all uninstalled ones).
 */
export function connectAgent(agentName: string = "all", home: string = homedir(), options: ConnectOptions = {}): ConnectReport[] {
  const target = agentName ? agentName.toLowerCase().trim() : "all";
  const reports: ConnectReport[] = [];

  if (target === "all" || target === "--all" || target === "") {
    // 1. Auto-detect all agents installed on this machine
    const detected = detectAgents(home);
    const installed = detected.filter(a => a.installed);

    if (installed.length === 0) {
      // Fallback: If no agent detected on clean system, connect standard Claude Code only if forced
      if (options.force) {
        reports.push(connectClaudeCode(home, options));
      }
      return reports;
    }

    // 2. Connect ONLY the installed agents — leave out uninstalled ones so NO extra files/folders are created!
    const seenConfigs = new Set<string>();
    const seenIds = new Set<string>();

    for (const agent of installed) {
      if (seenIds.has(agent.id)) continue;
      seenIds.add(agent.id);

      try {
        const report = connectSingleAgent(agent.id, home, options);
        if (seenConfigs.has(report.configPath)) continue;
        seenConfigs.add(report.configPath);
        reports.push(report);
      } catch (err: any) {
        reports.push({
          agent: agent.id,
          agentName: agent.name,
          configPath: agent.configPath || "unknown",
          updated: false,
          installed: true,
          permissionAutoApproved: false,
          message: `Failed to connect ${agent.name}: ${err.message}`,
        });
      }
    }

    return reports;
  }

  // Multiple comma-separated targets: "claude,cursor,hermes"
  if (target.includes(",")) {
    const targets = target.split(",").map((t) => t.trim()).filter(Boolean);
    for (const t of targets) {
      reports.push(connectSingleAgent(t, home, options));
    }
    return reports;
  }

  // Explicit single agent connection
  reports.push(connectSingleAgent(target, home, options));
  return reports;
}
