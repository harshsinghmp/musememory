export type AgentCategory =
  | "terminal-agent"
  | "openclaw-ecosystem"
  | "ide-agent"
  | "harness"
  | "proprietary";

export type AgentMcpFormat =
  | "claude-json"
  | "cursor-json"
  | "standard-mcp-servers"
  | "opencode-json"
  | "yaml-hermes"
  | "yaml-goose"
  | "continue-json"
  | "openclaw-json"
  | "custom"
  | "manual";

export interface AgentDefinition {
  id: string;
  name: string;
  category: AgentCategory;
  stars?: string;
  binaries: string[];
  configPaths: string[];
  mcpFormat: AgentMcpFormat;
  description: string;
  connect?: (home: string, options: ConnectOptions) => ConnectReport;
}

export interface DetectedAgent {
  id: string;
  name: string;
  category: AgentCategory;
  stars?: string;
  installed: boolean;
  binaryPath?: string;
  configPath?: string;
  connected: boolean;
  description: string;
}

export interface ConnectOptions {
  dryRun?: boolean;
  force?: boolean;
  all?: boolean;
}

export interface ConnectReport {
  agent: string;
  agentName: string;
  configPath: string;
  updated: boolean;
  installed: boolean;
  permissionAutoApproved: boolean;
  message: string;
}
