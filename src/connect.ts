import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";
import { detectAgents } from "./agents/detect.ts";
import { AGENT_REGISTRY } from "./agents/registry.ts";
import type { AgentDefinition, ConnectOptions, ConnectReport, DetectedAgent } from "./agents/types.ts";

export const ALL_MEMORY_TOOLS = [
  "memory_read",
  "get_context",
  "search",
  "memory_capture",
  "memory_harvest",
  "memory_import_transcript",
  "memory_search_transcripts",
  "memory_get_user_profile",
  "memory_set_user_profile",
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

function resolveAgentConfigFile(agent: AgentDefinition, home: string, foundConfig?: string | null): string {
  if (foundConfig && existsSync(foundConfig)) {
    try {
      if (statSync(foundConfig).isFile()) return foundConfig;
    } catch {}
  }
  for (const p of agent.configPaths) {
    if (p.endsWith(".json") || p.endsWith(".jsonc") || p.endsWith(".yaml") || p.endsWith(".yml")) {
      return join(home, p);
    }
  }
  const baseDir = join(home, agent.configPaths[0] ?? `.${agent.id}`);
  if (agent.mcpFormat === "yaml-hermes" || agent.mcpFormat === "yaml-goose") {
    return join(baseDir, "config.yaml");
  }
  return join(baseDir, "mcp.json");
}

/**
 * Declarative format transformer applying stdio MCP config and tool permissions.
 */
function wireAgentFormat(
  agent: AgentDefinition,
  home: string,
  options: ConnectOptions = {},
  foundConfig?: string | null,
): ConnectReport {
  const configPath = resolveAgentConfigFile(agent, home, foundConfig);

  // Zero-folder-creation policy: never materialize config directories that do
  // not already exist. Only --force explicitly opts in to creating them.
  if (!options.force && !existsSync(configPath) && !existsSync(dirname(configPath))) {
    return {
      agent: agent.id,
      agentName: agent.name,
      configPath,
      updated: false,
      installed: false,
      permissionAutoApproved: false,
      message: `Skipped ${agent.name}: no existing config at ${configPath} (use --force to create it)`,
    };
  }

  try {
    switch (agent.mcpFormat) {
    case "claude-json": {
      const claudeJsonPath = join(home, ".claude.json");
      const settingsJsonPath = join(home, ".claude", "settings.json");

      const mcpConfig = safeReadJson(claudeJsonPath);
      if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
      mcpConfig.mcpServers.memory = { command: "memory", args: ["mcp"] };
      safeWriteJson(claudeJsonPath, mcpConfig, options.dryRun);

      // Never fabricate the .claude/ directory: only tighten permissions when
      // the user's Claude settings already exist on disk.
      if (!existsSync(settingsJsonPath) && !existsSync(join(home, ".claude"))) {
        return {
          agent: agent.id,
          agentName: agent.name,
          configPath: claudeJsonPath,
          updated: true,
          installed: true,
          permissionAutoApproved: false,
          message: `Wired MCP to ${claudeJsonPath} (skipped permission auto-approve: no existing .claude settings found)`,
        };
      }

      const settings = safeReadJson(settingsJsonPath);
      const existingAllowed = Array.isArray(settings.allowedTools) ? settings.allowedTools : [];
      settings.allowedTools = Array.from(new Set([...existingAllowed, ...ALL_MEMORY_TOOLS]));
      safeWriteJson(settingsJsonPath, settings, options.dryRun);

      return {
        agent: agent.id,
        agentName: agent.name,
        configPath: `${claudeJsonPath} & ${settingsJsonPath}`,
        updated: true,
        installed: true,
        permissionAutoApproved: true,
        message: `Wired MCP to ${claudeJsonPath} and auto-approved ${ALL_MEMORY_TOOLS.length} tools in ${settingsJsonPath}`,
      };
    }

    case "cursor-json": {
      const config = safeReadJson(configPath);
      if (!config.mcpServers) config.mcpServers = {};
      config.mcpServers.memory = { command: "memory", args: ["mcp"] };
      if (!Array.isArray(config.autoApprove)) config.autoApprove = [];
      if (!config.autoApprove.includes("memory")) config.autoApprove.push("memory");
      safeWriteJson(configPath, config, options.dryRun);

      return {
        agent: agent.id,
        agentName: agent.name,
        configPath,
        updated: true,
        installed: true,
        permissionAutoApproved: true,
        message: `Wired MCP and enabled autoApprove in ${configPath}`,
      };
    }

    case "yaml-hermes": {
      const doc = safeReadYaml(configPath);
      if (!doc.mcp_servers) doc.mcp_servers = {};
      doc.mcp_servers.memory = { command: "memory", args: ["mcp"], enabled: true };
      safeWriteYaml(configPath, doc, options.dryRun);

      return {
        agent: agent.id,
        agentName: agent.name,
        configPath,
        updated: true,
        installed: true,
        permissionAutoApproved: true,
        message: `Wired MCP server in ${configPath}`,
      };
    }

    case "opencode-json":
    case "openclaw-json": {
      const config = safeReadJson(configPath);
      if (!config.mcp) config.mcp = {};
      config.mcp.memory = { type: "local", command: ["memory", "mcp"], enabled: true };
      safeWriteJson(configPath, config, options.dryRun);

      return {
        agent: agent.id,
        agentName: agent.name,
        configPath,
        updated: true,
        installed: true,
        permissionAutoApproved: true,
        message: `Wired MCP server in ${configPath}`,
      };
    }

    case "yaml-goose": {
      const doc = safeReadYaml(configPath);
      if (!doc.extensions) doc.extensions = {};
      doc.extensions.memory = {
        cmd: "memory",
        args: ["mcp"],
        enabled: true,
        type: "stdio",
      };
      safeWriteYaml(configPath, doc, options.dryRun);

      return {
        agent: agent.id,
        agentName: agent.name,
        configPath,
        updated: true,
        installed: true,
        permissionAutoApproved: true,
        message: `Wired MCP server in ${configPath}`,
      };
    }

    case "continue-json": {
      const config = safeReadJson(configPath);
      if (!Array.isArray(config.customMcpServers)) config.customMcpServers = [];
      const exists = config.customMcpServers.some((s: any) => s.name === "memory");
      if (!exists) {
        config.customMcpServers.push({
          name: "memory",
          command: "memory",
          args: ["mcp"],
        });
      }
      safeWriteJson(configPath, config, options.dryRun);

      return {
        agent: agent.id,
        agentName: agent.name,
        configPath,
        updated: true,
        installed: true,
        permissionAutoApproved: true,
        message: `Wired MCP server in ${configPath}`,
      };
    }

    case "manual": {
      if (agent.id === "aider") {
        const doc = safeReadYaml(configPath);
        if (!Array.isArray(doc["mcp-servers"])) doc["mcp-servers"] = [];
        if (!doc["mcp-servers"].includes("memory mcp")) {
          doc["mcp-servers"].push("memory mcp");
        }
        safeWriteYaml(configPath, doc, options.dryRun);
      }
      return {
        agent: agent.id,
        agentName: agent.name,
        configPath,
        updated: true,
        installed: true,
        permissionAutoApproved: true,
        message: `Wired MCP server in ${configPath}`,
      };
    }

    case "standard-mcp-servers":
    default: {
      if (configPath.endsWith(".yaml") || configPath.endsWith(".yml")) {
        const doc = safeReadYaml(configPath);
        if (!doc.mcp_servers) doc.mcp_servers = {};
        doc.mcp_servers.memory = { command: "memory", args: ["mcp"] };
        safeWriteYaml(configPath, doc, options.dryRun);
      } else {
        const config = safeReadJson(configPath);
        if (!config.mcpServers) config.mcpServers = {};
        config.mcpServers.memory = { command: "memory", args: ["mcp"] };
        safeWriteJson(configPath, config, options.dryRun);
      }

      return {
        agent: agent.id,
        agentName: agent.name,
        configPath,
        updated: true,
        installed: true,
        permissionAutoApproved: true,
        message: `Wired MCP server in ${configPath}`,
      };
    }
  }
  } catch (err: any) {
    return {
      agent: agent.id,
      agentName: agent.name,
      configPath,
      updated: false,
      installed: true,
      permissionAutoApproved: false,
      message: `Failed to wire ${agent.name}: ${err.message}`,
    };
  }
}

/**
 * Universal Agent Connector Dispatcher:
 * Connects an agent by ID or "all" to auto-wire detected installed coding agents.
 */
export function connectAgent(
  target: string = "all",
  home: string = homedir(),
  options: ConnectOptions = {},
): ConnectReport[] {
  const targetLower = target.toLowerCase().trim();
  const detected = detectAgents(home);

  if (targetLower === "all" || targetLower === "detected") {
    const installed = detected.filter((a) => a.installed || options.force);
    const reports: ConnectReport[] = [];
    for (const a of installed) {
      const def = AGENT_REGISTRY.find((r) => r.id === a.id);
      if (def) {
        reports.push(wireAgentFormat(def, home, options, a.configPath));
      }
    }
    return reports;
  }

  // Handle specific agent id
  const def = AGENT_REGISTRY.find((r) => r.id === targetLower || r.id.replace("-cli", "") === targetLower);
  if (!def) {
    return [
      {
        agent: targetLower,
        agentName: target,
        configPath: "none",
        updated: false,
        installed: false,
        permissionAutoApproved: false,
        message: `Unknown agent '${target}'. Run 'memory agents' to inspect supported agents.`,
      },
    ];
  }

  return [wireAgentFormat(def, home, options)];
}

/**
 * Convenience named exports for specific agents.
 * Each binds an exported name to its AGENT_REGISTRY id; all wiring
 * (config path, format, server-entry shape) comes from registry metadata
 * via connectAgent → wireAgentFormat.
 */
function makeNamedConnector(agentId: string) {
  return (home: string = homedir(), options: ConnectOptions = {}): ConnectReport =>
    connectAgent(agentId, home, options)[0];
}

export const connectClaudeCode = makeNamedConnector("claude-code");
export const connectCursor = makeNamedConnector("cursor");
export const connectAntigravity = makeNamedConnector("antigravity");
export const connectWindsurf = makeNamedConnector("windsurf");
export const connectCodex = makeNamedConnector("codex");
export const connectGeminiCli = makeNamedConnector("gemini-cli");
export const connectHermes = makeNamedConnector("hermes");
export const connectOpenCode = makeNamedConnector("opencode");
export const connectGoose = makeNamedConnector("goose");
export const connectAider = makeNamedConnector("aider");
export const connectOpenClaw = makeNamedConnector("openclaw");
export const connectClawCode = makeNamedConnector("claw-code");
export const connectPi = makeNamedConnector("pi");
export const connectOpenHands = makeNamedConnector("openhands");
export const connectOpenInterpreter = makeNamedConnector("open-interpreter");
export const connectContinue = makeNamedConnector("continue");
export const connectCrush = makeNamedConnector("crush");
export const connectRooCode = makeNamedConnector("roo-code");
export const connectCline = makeNamedConnector("cline");

/**
 * Remove memory MCP configuration from a specific agent config.
 */
export function disconnectSingleAgent(
  agentId: string,
  home: string = homedir(),
  options: ConnectOptions = {},
): ConnectReport {
  const id = agentId.toLowerCase().trim();
  const detected = detectAgents(home);
  const matched = detected.find((a) => a.id === id || a.id.replace("-cli", "") === id);
  const agentName = matched ? matched.name : agentId;
  const configPath = matched?.configPath || "";

  if (!configPath || !existsSync(configPath)) {
    return {
      agent: id,
      agentName,
      configPath: configPath || "none",
      updated: false,
      installed: false,
      permissionAutoApproved: false,
      message: `No configuration found for ${agentName}`,
    };
  }

  try {
    if (configPath.endsWith(".yaml") || configPath.endsWith(".yml")) {
      const doc = safeReadYaml(configPath);
      if (doc.mcp_servers && doc.mcp_servers.memory) delete doc.mcp_servers.memory;
      if (doc.extensions && doc.extensions.memory) delete doc.extensions.memory;
      safeWriteYaml(configPath, doc, options.dryRun);
    } else {
      const config = safeReadJson(configPath);
      if (config.mcpServers && config.mcpServers.memory) delete config.mcpServers.memory;
      if (config.mcp && config.mcp.memory) delete config.mcp.memory;
      if (Array.isArray(config.autoApprove)) {
        config.autoApprove = config.autoApprove.filter((t: string) => t !== "memory");
      }
      safeWriteJson(configPath, config, options.dryRun);
    }

    return {
      agent: id,
      agentName,
      configPath,
      updated: true,
      installed: true,
      permissionAutoApproved: false,
      message: `Unwired memory MCP server from ${configPath}`,
    };
  } catch (err: any) {
    return {
      agent: id,
      agentName,
      configPath,
      updated: false,
      installed: true,
      permissionAutoApproved: false,
      message: `Failed to disconnect ${agentName}: ${err.message}`,
    };
  }
}

/**
 * Unwire memory MCP from all connected coding agents.
 */
export function disconnectAllAgents(home: string = homedir(), options: ConnectOptions = {}): ConnectReport[] {
  const detected = detectAgents(home);
  const connected = detected.filter((a) => a.connected);
  const reports: ConnectReport[] = [];

  for (const a of connected) {
    reports.push(disconnectSingleAgent(a.id, home, options));
  }
  return reports;
}
