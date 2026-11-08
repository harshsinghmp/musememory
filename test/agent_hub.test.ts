import { describe, test, expect } from "bun:test";
import { toHubAgent } from "../src/agents/hub.ts";
import type { DetectedAgent } from "../src/agents/types.ts";

function agent(overrides: Partial<DetectedAgent>): DetectedAgent {
  return {
    id: "claude-code",
    name: "Claude Code",
    category: "terminal-agent",
    installed: true,
    connected: false,
    description: "fixture",
    ...overrides,
  };
}

describe("T-460: agents hub status mapping", () => {
  test("maps installed/connected to WIRED, UNWIRED and ABSENT", () => {
    expect(toHubAgent(agent({ installed: true, connected: true })).status).toBe("WIRED");
    expect(toHubAgent(agent({ installed: true, connected: false })).status).toBe("UNWIRED");
    expect(toHubAgent(agent({ installed: false, connected: false })).status).toBe("ABSENT");
  });

  test("preserves identity, description and paths", () => {
    const hub = toHubAgent(agent({ id: "cursor", name: "Cursor", configPath: "/tmp/cursor.json" }));
    expect(hub.id).toBe("cursor");
    expect(hub.name).toBe("Cursor");
    expect(hub.configPath).toBe("/tmp/cursor.json");
    expect(hub.description).toBe("fixture");
  });
});
