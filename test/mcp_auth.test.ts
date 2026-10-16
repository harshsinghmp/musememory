import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { startHttpMcpServer, validateHttpAuth } from "../src/mcp.ts";
import type { IncomingMessage } from "node:http";

function mockReq(headers: Record<string, string>): IncomingMessage {
  return {
    headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
  } as unknown as IncomingMessage;
}

describe("T-386: Bearer-token authentication & per-peer allowlist", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.MUSE_BEARER_TOKEN;
    delete process.env.MUSE_AUTH_TOKENS;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  describe("Unit: validateHttpAuth", () => {
    test("allows all requests when authentication is not configured", () => {
      const req = mockReq({});
      const res = validateHttpAuth(req, {});
      expect(res.authenticated).toBe(true);
    });

    test("enforces Bearer token and rejects missing/malformed headers", () => {
      const opts = { bearerToken: "secret-token-123" };

      // Missing
      const resMissing = validateHttpAuth(mockReq({}), opts);
      expect(resMissing.authenticated).toBe(false);
      expect(resMissing.status).toBe(401);
      expect(resMissing.errorMessage).toContain("Missing Bearer token");

      // Malformed
      const resMalformed = validateHttpAuth(mockReq({ authorization: "Basic dXNlcjpwYXNz" }), opts);
      expect(resMalformed.authenticated).toBe(false);
      expect(resMalformed.status).toBe(401);
      expect(resMalformed.errorMessage).toContain("Invalid Authorization header format");

      // Wrong token
      const resWrong = validateHttpAuth(mockReq({ authorization: "Bearer invalid-token" }), opts);
      expect(resWrong.authenticated).toBe(false);
      expect(resWrong.status).toBe(403);
      expect(resWrong.errorMessage).toContain("Invalid Bearer token");

      // Valid token
      const resValid = validateHttpAuth(mockReq({ authorization: "Bearer secret-token-123" }), opts);
      expect(resValid.authenticated).toBe(true);
      expect(resValid.peerId).toBe("default");
    });

    test("resolves peer mapping from bearerTokens and enforces allowedPeers allowlist", () => {
      const opts = {
        bearerTokens: ["sol:sol-tok-1", "nexus:nexus-tok-2", "crew:crew-tok-3"],
        allowedPeers: ["nexus", "crew"],
      };

      // Sol is valid token but not in allowedPeers
      const resSol = validateHttpAuth(mockReq({ authorization: "Bearer sol-tok-1" }), opts);
      expect(resSol.authenticated).toBe(false);
      expect(resSol.status).toBe(403);
      expect(resSol.errorMessage).toContain("Forbidden: Peer 'sol' is not authorized");

      // Nexus is valid token and in allowedPeers
      const resNexus = validateHttpAuth(mockReq({ authorization: "Bearer nexus-tok-2" }), opts);
      expect(resNexus.authenticated).toBe(true);
      expect(resNexus.peerId).toBe("nexus");

      // Crew is valid token and in allowedPeers
      const resCrew = validateHttpAuth(mockReq({ authorization: "Bearer crew-tok-3" }), opts);
      expect(resCrew.authenticated).toBe(true);
      expect(resCrew.peerId).toBe("crew");
    });

    test("reads auth tokens from environment variables MUSE_BEARER_TOKEN and MUSE_AUTH_TOKENS", () => {
      process.env.MUSE_AUTH_TOKENS = "agentA:tok-a,agentB:tok-b";

      const resA = validateHttpAuth(mockReq({ authorization: "Bearer tok-a" }), {});
      expect(resA.authenticated).toBe(true);
      expect(resA.peerId).toBe("agentA");

      const resB = validateHttpAuth(mockReq({ authorization: "Bearer tok-b" }), {});
      expect(resB.authenticated).toBe(true);
      expect(resB.peerId).toBe("agentB");

      const resFail = validateHttpAuth(mockReq({ authorization: "Bearer unknown-tok" }), {});
      expect(resFail.authenticated).toBe(false);
      expect(resFail.status).toBe(403);
    });
  });

  describe("Integration: HTTP server authentication", () => {
    test("rejects unauthenticated requests with 401 and WWW-Authenticate header", async () => {
      const handle = await startHttpMcpServer({
        port: 0,
        host: "127.0.0.1",
        bearerToken: "team-bearer-token-abc",
      });

      try {
        const resp = await fetch(handle.url, {
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

        expect(resp.status).toBe(401);
        expect(resp.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
        const json = (await resp.json()) as any;
        expect(json.error.code).toBe(-32002);
        expect(json.error.message).toContain("Missing Bearer token");
      } finally {
        await handle.close();
      }
    });

    test("rejects invalid Bearer tokens with 403 Forbidden", async () => {
      const handle = await startHttpMcpServer({
        port: 0,
        host: "127.0.0.1",
        bearerToken: "team-bearer-token-abc",
      });

      try {
        const resp = await fetch(handle.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "accept": "application/json, text/event-stream",
            "authorization": "Bearer wrong-token-xyz",
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
        expect(json.error.code).toBe(-32000);
        expect(json.error.message).toContain("Invalid Bearer token");
      } finally {
        await handle.close();
      }
    });

    test("authorizes valid Bearer tokens and allows session workflow", async () => {
      const handle = await startHttpMcpServer({
        port: 0,
        host: "127.0.0.1",
        bearerToken: "team-bearer-token-abc",
      });

      try {
        // 1. Initialize with Bearer token
        const resp = await fetch(handle.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "accept": "application/json, text/event-stream",
            "authorization": "Bearer team-bearer-token-abc",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } },
          }),
        });

        expect(resp.status).toBe(200);
        const sessionId = resp.headers.get("mcp-session-id");
        expect(sessionId).toBeDefined();

        // 2. tools/list with session ID and Bearer token
        const listResp = await fetch(handle.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "accept": "application/json, text/event-stream",
            "authorization": "Bearer team-bearer-token-abc",
            "mcp-session-id": sessionId!,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list",
            params: {},
          }),
        });

        expect(listResp.status).toBe(200);
        const listJson = (await listResp.json()) as any;
        expect(listJson.result?.tools).toBeDefined();
      } finally {
        await handle.close();
      }
    });

    test("handles CORS OPTIONS preflight without requiring Authorization header", async () => {
      const handle = await startHttpMcpServer({
        port: 0,
        host: "127.0.0.1",
        bearerToken: "team-bearer-token-abc",
      });

      try {
        const resp = await fetch(handle.url, {
          method: "OPTIONS",
          headers: {
            "origin": "https://dashboard.example.com",
            "access-control-request-method": "POST",
            "access-control-request-headers": "authorization, content-type",
          },
        });

        expect(resp.status).toBe(204);
        expect(resp.headers.get("access-control-allow-methods")).toContain("POST");
        expect(resp.headers.get("access-control-allow-headers")).toContain("authorization");
      } finally {
        await handle.close();
      }
    });
  });
});
