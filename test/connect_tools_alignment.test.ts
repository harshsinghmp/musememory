import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALL_MEMORY_TOOLS } from "../src/connect.ts";
import { createServer } from "../src/mcp.ts";

// The expected tool count is read from the generated claims manifest rather
// than hardcoded: a hardcoded count is a second place to forget to update
// whenever a tool is added, and it failed exactly that way.
const claims = JSON.parse(readFileSync(join(import.meta.dir, "..", "claims.json"), "utf8"));

describe("T-011: ALL_MEMORY_TOOLS Alignment with Registered MCP Tools", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-connect-align-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("verifies 100% parity between ALL_MEMORY_TOOLS and live registered MCP tools", async () => {
    const server = createServer(tmpDir, "full");
    const listHandler = (server as any)._requestHandlers.get("tools/list");
    expect(listHandler).toBeDefined();

    const response = await listHandler({ method: "tools/list", params: {} });
    const registeredToolNames = new Set<string>(response.tools.map((t: any) => t.name));
    const allMemoryToolsSet = new Set<string>(ALL_MEMORY_TOOLS);

    // 1. Zero phantom tools in ALL_MEMORY_TOOLS
    const phantomTools = ALL_MEMORY_TOOLS.filter((t) => !registeredToolNames.has(t));
    expect(phantomTools).toEqual([]);

    // 2. Zero missing registered tools in ALL_MEMORY_TOOLS
    const missingTools = Array.from(registeredToolNames).filter((t) => !allMemoryToolsSet.has(t));
    expect(missingTools).toEqual([]);

    // 3. The registered count matches the generated claims manifest.
    expect(ALL_MEMORY_TOOLS.length).toBe(claims.mcpTools);
    expect(registeredToolNames.size).toBe(claims.mcpTools);
  });
});
