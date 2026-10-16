import { describe, test, expect } from "bun:test";
import { startHttpMcpServer } from "../src/mcp.ts";

describe("T-150: MCP Streamable HTTP Transport (2025-06-18 spec)", () => {
  test("starts HTTP server on ephemeral port and handles initialize request", async () => {
    const handle = await startHttpMcpServer({
      port: 0,
      host: "127.0.0.1",
      endpoint: "/mcp",
    });

    try {
      expect(handle.port).toBeGreaterThan(0);
      expect(handle.url).toBe(`http://127.0.0.1:${handle.port}/mcp`);

      // 1. Send Initialize request
      const initPayload = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-http-client", version: "1.0.0" },
        },
      };

      const resp = await fetch(handle.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json, text/event-stream",
        },
        body: JSON.stringify(initPayload),
      });

      expect(resp.status).toBe(200);
      const sessionId = resp.headers.get("mcp-session-id");
      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe("string");

      const initResult = (await resp.json()) as any;
      expect(initResult.jsonrpc).toBe("2.0");
      expect(initResult.id).toBe(1);
      expect(initResult.result).toBeDefined();
      expect(initResult.result.serverInfo.name).toBe("musememory");

      // 2. Send tools/list request with session ID
      const toolsListPayload = {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      };

      const toolsResp = await fetch(handle.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json, text/event-stream",
          "mcp-session-id": sessionId!,
        },
        body: JSON.stringify(toolsListPayload),
      });

      expect(toolsResp.status).toBe(200);
      const toolsResult = (await toolsResp.json()) as any;
      expect(toolsResult.jsonrpc).toBe("2.0");
      expect(toolsResult.id).toBe(2);
      expect(Array.isArray(toolsResult.result?.tools)).toBe(true);

      const toolNames = toolsResult.result.tools.map((t: any) => t.name);
      expect(toolNames).toContain("muse_context");
      expect(toolNames).toContain("memory_capture");
      expect(toolNames).toContain("memory_confirm");
    } finally {
      await handle.close();
    }
  });

  test("rejects requests missing required accept header per 2025-06-18 spec", async () => {
    const handle = await startHttpMcpServer({
      port: 0,
      host: "127.0.0.1",
    });

    try {
      const resp = await fetch(handle.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // Intentionally omitting accept: application/json, text/event-stream
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test-client", version: "1.0.0" },
          },
        }),
      });

      // 406 Not Acceptable
      expect(resp.status).toBe(406);
    } finally {
      await handle.close();
    }
  });

  test("returns 404 for unmapped endpoints", async () => {
    const handle = await startHttpMcpServer({
      port: 0,
      host: "127.0.0.1",
      endpoint: "/mcp",
    });

    try {
      const resp = await fetch(`http://127.0.0.1:${handle.port}/unknown-route`);
      expect(resp.status).toBe(404);
    } finally {
      await handle.close();
    }
  });
});
