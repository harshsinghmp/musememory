import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROFILE_TOOL_DEFINITIONS,
  filterToolsForProfile,
  getProfileToolNames,
  listMcpProfiles,
} from "../src/orchestrator/profiles.ts";
import type { McpProfile } from "../src/orchestrator/types.ts";
import { createServer } from "../src/mcp.ts";

describe("T-010: Profile Tool Definitions Alignment with Registered MCP Tools", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-profile-align-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ensures every tool in every profile exists in the full MCP tool list", async () => {
    const server = createServer(tmpDir, "full");
    const listHandler = (server as any)._requestHandlers.get("tools/list");
    expect(listHandler).toBeDefined();

    const response = await listHandler({ method: "tools/list", params: {} });
    const registeredToolNames = new Set<string>(response.tools.map((t: any) => t.name));

    const profiles = Object.keys(PROFILE_TOOL_DEFINITIONS) as McpProfile[];
    const phantomTools: Array<{ profile: string; tool: string }> = [];

    for (const profile of profiles) {
      if (profile === "full") continue; // full uses all registered tools
      const toolNames = PROFILE_TOOL_DEFINITIONS[profile];
      for (const tool of toolNames) {
        if (!registeredToolNames.has(tool)) {
          phantomTools.push({ profile, tool });
        }
      }
    }

    expect(phantomTools).toEqual([]);
  });

  it("filters tools cleanly for all named profiles", () => {
    const mockTools = [
      { name: "memory_read" },
      { name: "memory_observe" },
      { name: "memory_resolve_conflict" },
      { name: "memory_adr_record" },
      { name: "memory_consolidate" },
      { name: "unregistered_external_tool" },
    ];

    const debuggingTools = filterToolsForProfile(mockTools, "debugging");
    expect(debuggingTools.map((t) => t.name)).toContain("memory_read");
    expect(debuggingTools.map((t) => t.name)).toContain("memory_observe");
    expect(debuggingTools.map((t) => t.name)).not.toContain("memory_adr_record");
    expect(debuggingTools.map((t) => t.name)).not.toContain("unregistered_external_tool");

    const reviewTools = filterToolsForProfile(mockTools, "review");
    expect(reviewTools.map((t) => t.name)).toContain("memory_resolve_conflict");
    expect(reviewTools.map((t) => t.name)).not.toContain("memory_observe");

    const maintenanceTools = filterToolsForProfile(mockTools, "maintenance");
    expect(maintenanceTools.map((t) => t.name)).toContain("memory_consolidate");
    expect(maintenanceTools.map((t) => t.name)).not.toContain("memory_observe");
  });

  it("lists all MCP profiles with correct metadata", () => {
    const profiles = listMcpProfiles();
    expect(profiles.length).toBe(7);
    const names = profiles.map((p) => p.profile);
    expect(names).toContain("core");
    expect(names).toContain("coding");
    expect(names).toContain("debugging");
    expect(names).toContain("review");
    expect(names).toContain("architecture");
    expect(names).toContain("maintenance");
    expect(names).toContain("full");
  });
});
