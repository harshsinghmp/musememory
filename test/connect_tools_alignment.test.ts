import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALL_MEMORY_TOOLS } from "../src/connect.ts";
import { createServer } from "../src/mcp.ts";

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

    // 3. Exactly 111 registered tools
    expect(ALL_MEMORY_TOOLS.length).toBe(111);
    expect(registeredToolNames.size).toBe(111);
  });
});
