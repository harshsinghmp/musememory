import { describe, test, expect } from "bun:test";
import { startHttpMcpServer } from "../src/mcp/http.ts";
import { SUPPORTED_MCP_PROTOCOL_VERSIONS } from "../src/mcp.ts";

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

describe("T-151: Origin validation, session ID enforcement, and protocol version headers", () => {
  test("enforces Origin allowlist and rejects untrusted origins with 403", async () => {
    const handle = await startHttpMcpServer({
      port: 0,
      host: "127.0.0.1",
      allowedOrigins: ["https://trusted.agency.internal"],
    });

    try {
      // 1. Untrusted origin rejected
      const rejectedResp = await fetch(handle.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json, text/event-stream",
          "origin": "https://attacker.site.xyz",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } },
        }),
      });

      expect(rejectedResp.status).toBe(403);
      const rejJson = (await rejectedResp.json()) as any;
      expect(rejJson.error.message).toContain("Forbidden: Origin 'https://attacker.site.xyz' is not allowed");

      // 2. Allowed origin accepted
      const acceptedResp = await fetch(handle.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json, text/event-stream",
          "origin": "https://trusted.agency.internal",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } },
        }),
      });

      expect(acceptedResp.status).toBe(200);
    } finally {
      await handle.close();
    }
  });

  test("enforces Host allowlist for DNS rebinding protection", async () => {
    const handle = await startHttpMcpServer({
      port: 0,
      host: "127.0.0.1",
      allowedHosts: ["127.0.0.1", "localhost"],
    });

    try {
      const resp = await fetch(handle.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json, text/event-stream",
          "host": "rebinding-target.attacker.com",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } },
        }),
      });

      expect(resp.status).toBe(403);
      const json = (await resp.json()) as any;
      expect(json.error.message).toContain("Forbidden: Host 'rebinding-target.attacker.com' is not allowed");
    } finally {
      await handle.close();
    }
  });

  test("validates and echoes mcp-protocol-version header, rejecting unsupported versions with 400", async () => {
    const handle = await startHttpMcpServer({
      port: 0,
      host: "127.0.0.1",
    });

    try {
      // 1. Supported version 2025-06-18
      const okResp = await fetch(handle.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } },
        }),
      });

      expect(okResp.status).toBe(200);
      expect(okResp.headers.get("mcp-protocol-version")).toBe("2025-06-18");

      // 2. Unsupported version fails fast with 400
      const badResp = await fetch(handle.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json, text/event-stream",
          "mcp-protocol-version": "1999-01-01",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } },
        }),
      });

      expect(badResp.status).toBe(400);
      const badJson = (await badResp.json()) as any;
      expect(badJson.error.message).toContain("Unsupported protocol version: 1999-01-01");
    } finally {
      await handle.close();
    }

    // 3. Omitted version on fresh server defaults to 2024-11-05
    const defaultHandle = await startHttpMcpServer({
      port: 0,
      host: "127.0.0.1",
    });
    try {
      const defaultResp = await fetch(defaultHandle.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } },
        }),
      });

      expect(defaultResp.status).toBe(200);
      expect(defaultResp.headers.get("mcp-protocol-version")).toBe("2024-11-05");
    } finally {
      await defaultHandle.close();
    }
  });

  test("#494: accepts every advertised protocol version and still rejects 2026-07-28 with 400", async () => {
    // The allowlist is the installed SDK's own list, newest first.
    expect([...SUPPORTED_MCP_PROTOCOL_VERSIONS]).toEqual([
      "2025-11-25",
      "2025-06-18",
      "2025-03-26",
      "2024-11-05",
      "2024-10-07",
    ]);

    // 1. The newest version the SDK negotiates is accepted and echoed back.
    const currentHandle = await startHttpMcpServer({ port: 0, host: "127.0.0.1" });
    try {
      const resp = await fetch(currentHandle.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json, text/event-stream",
          "mcp-protocol-version": "2025-11-25",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } },
        }),
      });

      expect(resp.status).toBe(200);
      expect(resp.headers.get("mcp-protocol-version")).toBe("2025-11-25");
      const payload = (await resp.json()) as any;
      expect(payload.result.protocolVersion).toBe("2025-11-25");
    } finally {
      await currentHandle.close();
    }

    // 2. The 2026-07-28 revision is not supported by the installed SDK, so the
    //    transport must reject the header outright rather than half-negotiate it.
    const futureHandle = await startHttpMcpServer({ port: 0, host: "127.0.0.1" });
    try {
      const badResp = await fetch(futureHandle.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json, text/event-stream",
          "mcp-protocol-version": "2026-07-28",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "initialize",
          params: { protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "t", version: "1" } },
        }),
      });

      expect(badResp.status).toBe(400);
      const badJson = (await badResp.json()) as any;
      expect(badJson.error.message).toContain("Unsupported protocol version: 2026-07-28");
      expect(badJson.error.message).toContain("2025-11-25");
    } finally {
      await futureHandle.close();
    }
  });

  test("enforces session ID presence and validity on subsequent requests", async () => {
    const handle = await startHttpMcpServer({
      port: 0,
      host: "127.0.0.1",
    });

    try {
      // 1. Initialize session
      const initResp = await fetch(handle.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } },
        }),
      });
      expect(initResp.status).toBe(200);
      const sessionId = initResp.headers.get("mcp-session-id");
      expect(sessionId).toBeDefined();

      // 2. Request without session ID rejected with 400
      const missingSessionResp = await fetch(handle.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        }),
      });
      expect(missingSessionResp.status).toBe(400);

      // 3. Request with nonexistent session ID rejected with 404
      const invalidSessionResp = await fetch(handle.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json, text/event-stream",
          "mcp-session-id": "non-existent-session-xyz",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/list",
          params: {},
        }),
      });
      expect(invalidSessionResp.status).toBe(404);

      // 4. Request with valid session ID succeeds
      const validSessionResp = await fetch(handle.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json, text/event-stream",
          "mcp-session-id": sessionId!,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/list",
          params: {},
        }),
      });
      expect(validSessionResp.status).toBe(200);
    } finally {
      await handle.close();
    }
  });
});

describe("#511: browser origins are deny-by-default on the MCP HTTP server", () => {
  const initPayload = (id = 1) =>
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });

  test("a request from an unlisted Origin is refused with 403 and no CORS header", async () => {
    const handle = await startHttpMcpServer({ port: 0, host: "127.0.0.1" });

    try {
      const resp = await fetch(handle.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json, text/event-stream",
          "origin": "https://evil.example",
        },
        body: initPayload(),
      });

      expect(resp.status).toBe(403);
      // The refusal must not be readable by the page that sent it: no ACAO at
      // all, and certainly not a reflection of its own origin.
      expect(resp.headers.get("access-control-allow-origin")).toBeNull();
      const json = (await resp.json()) as any;
      expect(json.error.message).toContain("Origin 'https://evil.example' is not allowed");
      // The refused request never reached the transport, so no session exists.
      expect(resp.headers.get("mcp-session-id")).toBeNull();
    } finally {
      await handle.close();
    }
  });

  test("the same request with no Origin header (a native MCP client) succeeds", async () => {
    const handle = await startHttpMcpServer({ port: 0, host: "127.0.0.1" });

    try {
      const resp = await fetch(handle.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json, text/event-stream",
        },
        body: initPayload(),
      });

      expect(resp.status).toBe(200);
      expect(resp.headers.get("mcp-session-id")).toBeDefined();
      const json = (await resp.json()) as any;
      expect(json.result.serverInfo.name).toBe("musememory");
    } finally {
      await handle.close();
    }
  });

  test("an explicitly allowlisted Origin is allowed and echoed back", async () => {
    const handle = await startHttpMcpServer({
      port: 0,
      host: "127.0.0.1",
      allowedOrigins: ["http://localhost:5173"],
    });

    try {
      const resp = await fetch(handle.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json, text/event-stream",
          "origin": "http://localhost:5173",
        },
        body: initPayload(),
      });

      expect(resp.status).toBe(200);
      // Exactly the allowlisted origin — never `*` and never a reflection of
      // whatever the caller happened to send.
      expect(resp.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    } finally {
      await handle.close();
    }
  });

  test("a browser origin cannot drive tools/call even after a native client initialised a session", async () => {
    const handle = await startHttpMcpServer({ port: 0, host: "127.0.0.1" });

    try {
      // A native client (no Origin) opens a real session.
      const initResp = await fetch(handle.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json, text/event-stream",
        },
        body: initPayload(),
      });
      expect(initResp.status).toBe(200);
      const sessionId = initResp.headers.get("mcp-session-id");
      expect(sessionId).toBeDefined();

      // A hostile page that learned the session id still cannot use it: the
      // Origin gate runs before dispatch, so no tool body is ever executed.
      const evilResp = await fetch(handle.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json, text/event-stream",
          "mcp-session-id": sessionId!,
          "origin": "https://evil.example",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "memory_capture", arguments: { content: "pwned", project: "pwned" } },
        }),
      });

      expect(evilResp.status).toBe(403);
      expect(evilResp.headers.get("access-control-allow-origin")).toBeNull();
      const evilJson = (await evilResp.json()) as any;
      expect(evilJson.result).toBeUndefined();
      expect(evilJson.error.message).toContain("is not allowed");
    } finally {
      await handle.close();
    }
  });

  test("OPTIONS preflight from an unlisted Origin is refused with 403 and no CORS header", async () => {
    const handle = await startHttpMcpServer({ port: 0, host: "127.0.0.1" });

    try {
      const resp = await fetch(handle.url, {
        method: "OPTIONS",
        headers: {
          "origin": "https://evil.example",
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization, content-type",
        },
      });

      expect(resp.status).toBe(403);
      expect(resp.headers.get("access-control-allow-origin")).toBeNull();
      // The dangerous allowances must not be handed to a refused preflight
      // either — `authorization` in `allow-headers` was how the page got past
      // the preflight in the first place.
      expect(resp.headers.get("access-control-allow-headers")).toBeNull();
    } finally {
      await handle.close();
    }
  });

  test("OPTIONS preflight from an allowlisted Origin is answered with that Origin", async () => {
    const handle = await startHttpMcpServer({
      port: 0,
      host: "127.0.0.1",
      allowedOrigins: ["http://localhost:5173"],
    });

    try {
      const resp = await fetch(handle.url, {
        method: "OPTIONS",
        headers: {
          "origin": "http://localhost:5173",
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization, content-type",
        },
      });

      expect(resp.status).toBe(204);
      expect(resp.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
      expect(resp.headers.get("access-control-allow-methods")).toContain("POST");
      expect(resp.headers.get("access-control-allow-headers")).toContain("authorization");
    } finally {
      await handle.close();
    }
  });

  test("OPTIONS without an Origin header is answered without any CORS origin", async () => {
    const handle = await startHttpMcpServer({ port: 0, host: "127.0.0.1" });

    try {
      const resp = await fetch(handle.url, { method: "OPTIONS" });

      expect(resp.status).toBe(204);
      expect(resp.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      await handle.close();
    }
  });
});

