import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openStore, save } from "../src/store.ts";
import { createServer } from "../src/mcp.ts";
import { handleDistillRouteCommand } from "../src/cli/lifecycle.ts";
import { ALL_MEMORY_TOOLS } from "../src/connect.ts";
import { PROFILE_TOOL_DEFINITIONS } from "../src/orchestrator/profiles.ts";

const TEST_DIR = join(import.meta.dir, ".tmp_mcp_distill_route_test");

describe("MCP memory_distill_route Tool Handler & CLI", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("is registered in ALL_MEMORY_TOOLS and architecture profile", () => {
    expect(ALL_MEMORY_TOOLS.includes("memory_distill_route")).toBe(true);
    expect(PROFILE_TOOL_DEFINITIONS.architecture.includes("memory_distill_route")).toBe(true);
  });

  it("handles tools/call for memory_distill_route via MCP server", async () => {
    const memoryDir = join(TEST_DIR, ".memory");
    mkdirSync(memoryDir, { recursive: true });
    const store = openStore(memoryDir);
    const now = new Date().toISOString();

    save(store, {
      id: "mem_fix_mcp",
      title: "Tool registration patch",
      content: "Exported tool schemas.",
      type: "fix",
      status: "confirmed",
      project: "core",
      created_at: now,
      updated_at: now,
    });

    const server = createServer(TEST_DIR, "full");
    const callTool = (server as any)._requestHandlers.get("tools/call");
    expect(callTool).toBeDefined();

    const res = await callTool({
      method: "tools/call",
      params: {
        name: "memory_distill_route",
        arguments: { dir: TEST_DIR },
      },
    });

    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.routed.system.length).toBe(1);
    expect(payload.total_routed).toBe(1);
  });

  it("executes handleDistillRouteCommand via CLI lifecycle", async () => {
    const memoryDir = join(TEST_DIR, ".memory");
    mkdirSync(memoryDir, { recursive: true });
    const store = openStore(memoryDir);
    const now = new Date().toISOString();

    save(store, {
      id: "mem_arch_cli",
      title: "Storage Engine Layout",
      content: "SQLite dual-write persistence.",
      type: "architecture",
      status: "confirmed",
      project: "core",
      created_at: now,
      updated_at: now,
    });

    const exitCode = await handleDistillRouteCommand({
      positional: [],
      flags: { dir: TEST_DIR, "dry-run": "true" },
    });

    expect(exitCode).toBe(0);
  });
});
