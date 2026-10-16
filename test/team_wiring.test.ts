import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generateClientConfigRecipe } from "../src/connect.ts";
import { handleConnectCommand } from "../src/cli/ecosystem.ts";

describe("T-387: Team Slice Member Wiring & Scoping Policy", () => {
  test("generates client configuration recipes for Cursor, Opencode, and Claude/Antigravity", () => {
    const customEndpoint = "http://192.168.1.100:31338/mcp";
    const customToken = "secret-team-token-xyz";
    const peerId = "alice";

    const recipes = generateClientConfigRecipe(customEndpoint, customToken, peerId);

    expect(recipes.endpoint).toBe(customEndpoint);

    // Cursor recipe
    expect(recipes.cursor.mcpServers.musememory.url).toBe(customEndpoint);
    expect(recipes.cursor.mcpServers.musememory.headers.Authorization).toBe(`Bearer ${customToken}`);
    expect(recipes.cursor.mcpServers.musememory.headers["mcp-peer-id"]).toBe("alice");

    // Opencode recipe
    expect(recipes.opencode.mcp.musememory.url).toBe(customEndpoint);
    expect(recipes.opencode.mcp.musememory.type).toBe("remote");
    expect(recipes.opencode.mcp.musememory.headers.Authorization).toBe(`Bearer ${customToken}`);
    expect(recipes.opencode.mcp.musememory.headers["mcp-peer-id"]).toBe("alice");

    // Claude / Antigravity recipe
    expect(recipes.claude.mcpServers.musememory.url).toBe(customEndpoint);
    expect(recipes.claude.mcpServers.musememory.transport).toBe("http");
    expect(recipes.claude.mcpServers.musememory.headers.Authorization).toBe(`Bearer ${customToken}`);
    expect(recipes.claude.mcpServers.musememory.headers["mcp-peer-id"]).toBe("alice");
  });

  test("team-slice-wiring.md documentation exists and covers required architecture mandates", () => {
    const docPath = join(process.cwd(), "docs/architecture/team-slice-wiring.md");
    expect(existsSync(docPath)).toBe(true);

    const docContent = readFileSync(docPath, "utf8");

    // Must document single host server topology and network filesystem rejection
    expect(docContent).toContain("Team Topology Architecture");
    expect(docContent).toContain("NFS");
    expect(docContent).toContain("WAL");
    expect(docContent).toContain("team.db");

    // Must document client configuration recipes
    expect(docContent).toContain("Client Configuration Recipes");
    expect(docContent).toContain("Cursor");
    expect(docContent).toContain("Opencode");

    // Must document shared vs personal memory scoping policy
    expect(docContent).toContain("Shared Team Memory vs. Personal Memory");
    expect(docContent).toContain("Personal Developer Memory");

    // Must document CURRENT.md governance and poisoning prevention
    expect(docContent).toContain("CURRENT.md");
    expect(docContent).toContain("Poisoning");
  });

  test("handleConnectCommand executes cleanly with --recipe flag", async () => {
    const origLog = console.log;
    let output = "";
    console.log = (...args: any[]) => {
      output += args.join(" ") + "\n";
    };

    try {
      const exitCode = await handleConnectCommand({
        positional: [],
        flags: {
          recipe: "true",
          endpoint: "http://10.0.0.5:31338/mcp",
          token: "tok-test-123",
          peer: "nexus",
        },
      });

      expect(exitCode).toBe(0);
      expect(output).toContain("Muse Memory Team Server Client Configuration Recipes (T-387)");
      expect(output).toContain("http://10.0.0.5:31338/mcp");
      expect(output).toContain("tok-test-123");
      expect(output).toContain("nexus");
    } finally {
      console.log = origLog;
    }
  });
});
