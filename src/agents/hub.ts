import { homedir } from "node:os";
import { detectAgents } from "./detect.ts";
import type { DetectedAgent } from "./types.ts";

/**
 * T-460: three-state wiring status for the studio's agents hub.
 * ABSENT = not installed, UNWIRED = installed but no memory MCP config,
 * WIRED = installed and connected.
 */
export type AgentWiringStatus = "WIRED" | "UNWIRED" | "ABSENT";

export interface HubAgent {
  id: string;
  name: string;
  category: string;
  description: string;
  status: AgentWiringStatus;
  binaryPath?: string;
  configPath?: string;
}

export function toHubAgent(agent: DetectedAgent): HubAgent {
  const status: AgentWiringStatus = !agent.installed ? "ABSENT" : agent.connected ? "WIRED" : "UNWIRED";
  return {
    id: agent.id,
    name: agent.name,
    category: agent.category,
    description: agent.description,
    status,
    binaryPath: agent.binaryPath,
    configPath: agent.configPath,
  };
}

export function discoverAgentHub(home: string = process.env.HOME || homedir()): HubAgent[] {
  return detectAgents(home).map(toHubAgent);
}
