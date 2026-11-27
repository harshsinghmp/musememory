import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { startHttpMcpServer, validateHttpAuth, validateHttpOrigin } from "../src/mcp/http.ts";
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

    // Issue #453: the transport failed open whenever no token was configured,
    // so a non-loopback bind published every tool anonymously.
    test("requires authentication on a non-loopback bind even with no token configured (issue #453)", () => {
      const res = validateHttpAuth(mockReq({}), { bindHost: "0.0.0.0" });
      expect(res.authenticated).toBe(false);
      expect(res.status).toBe(401);
      expect(res.errorMessage).toContain("non-loopback bind");
    });

    test("treats the plain `host` option as the bind host for programmatic callers (issue #453)", () => {
      const res = validateHttpAuth(mockReq({}), { host: "0.0.0.0" });
      expect(res.authenticated).toBe(false);
      expect(res.status).toBe(401);

      // A request that presents *a* token cannot authenticate either when the
      // operator configured none: non-loopback binds fail closed.
      const resWithHeader = validateHttpAuth(mockReq({ authorization: "Bearer anything" }), { bindHost: "192.168.1.10" });
      expect(resWithHeader.authenticated).toBe(false);
      expect(resWithHeader.status).toBe(403);
    });

    test("keeps the loopback fail-open path so local clients need no token (issue #453)", () => {
      for (const bindHost of ["127.0.0.1", "::1", "localhost", "[::1]", " 127.0.0.1 "]) {
        const res = validateHttpAuth(mockReq({}), { bindHost });
        expect(res.authenticated).toBe(true);
      }
      // No bind information at all keeps the historical default (loopback).
      expect(validateHttpAuth(mockReq({}), {}).authenticated).toBe(true);
    });

    test("only an explicit allowInsecureBind opts out of the non-loopback guard (issue #453)", () => {
      expect(validateHttpAuth(mockReq({}), { bindHost: "0.0.0.0" }).authenticated).toBe(false);
      expect(
        validateHttpAuth(mockReq({}), { bindHost: "0.0.0.0", allowInsecureBind: true }).authenticated,
      ).toBe(true);
      // The opt-out does not disable a configured token.
      const withToken = validateHttpAuth(mockReq({}), {
        bindHost: "0.0.0.0",
        allowInsecureBind: true,
        bearerToken: "tok",
      });
      expect(withToken.authenticated).toBe(false);
      expect(withToken.status).toBe(401);
    });
  });

  describe("Unit: validateHttpOrigin (issue #511)", () => {
    test("treats a missing Origin header as a native client and allows it", () => {
      expect(validateHttpOrigin(mockReq({}), {}).allowed).toBe(true);
      // Even with an allowlist configured, a non-browser client is unaffected.
      const res = validateHttpOrigin(mockReq({}), { allowedOrigins: ["http://localhost:5173"] });
      expect(res.allowed).toBe(true);
      expect(res.allowOrigin).toBeUndefined();
    });

    test("denies any browser origin by default, including on loopback", () => {
      for (const bindHost of ["127.0.0.1", "::1", "localhost"]) {
        const res = validateHttpOrigin(mockReq({ origin: "https://evil.example" }), { bindHost });
        expect(res.allowed).toBe(false);
        expect(res.status).toBe(403);
        expect(res.allowOrigin).toBeUndefined();
        expect(res.errorMessage).toContain("Origin 'https://evil.example' is not allowed");
      }
    });

    test("denies an unlisted origin even when an allowlist exists", () => {
      const res = validateHttpOrigin(mockReq({ origin: "https://evil.example" }), {
        allowedOrigins: ["http://localhost:5173"],
      });
      expect(res.allowed).toBe(false);
      expect(res.status).toBe(403);
      expect(res.allowOrigin).toBeUndefined();
    });

    test("denies an empty allowlist and the opaque `null` origin", () => {
      expect(
        validateHttpOrigin(mockReq({ origin: "https://evil.example" }), { allowedOrigins: [] }).allowed,
      ).toBe(false);
      // `Origin: null` is what a sandboxed iframe or a file:// page sends; it is
      // a browser origin, not an absence of one.
      const opaque = validateHttpOrigin(mockReq({ origin: "null" }), {});
      expect(opaque.allowed).toBe(false);
      expect(opaque.status).toBe(403);
    });

    test("allows exactly the allowlisted origin and echoes only that value", () => {
      const res = validateHttpOrigin(mockReq({ origin: "http://localhost:5173" }), {
        allowedOrigins: ["http://localhost:5173", "https://trusted.agency.internal"],
      });
      expect(res.allowed).toBe(true);
      expect(res.allowOrigin).toBe("http://localhost:5173");
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

    // Issue #453: a programmatic caller cannot expose the server by binding a
    // non-loopback address and simply not configuring a token.
    test("rejects unauthenticated requests when bindHost is non-loopback (issue #453)", async () => {
      const handle = await startHttpMcpServer({
        port: 0,
        host: "127.0.0.1",
        bindHost: "0.0.0.0",
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
        const json = (await resp.json()) as any;
        expect(json.error.message).toContain("non-loopback bind");
      } finally {
        await handle.close();
      }
    });

    // Issue #511: an allowlisted browser origin still has to authenticate when
    // tokens are configured — the origin gate admits it to the auth check, it
    // does not stand in for one.
    test("an allowlisted browser origin is still subject to Bearer auth", async () => {
      const handle = await startHttpMcpServer({
        port: 0,
        host: "127.0.0.1",
        bearerToken: "team-bearer-token-abc",
        allowedOrigins: ["http://localhost:5173"],
      });

      try {
        const initialize = JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } },
        });

        // Allowlisted origin, no token: 401 (and now readable by that origin).
        const noToken = await fetch(handle.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "accept": "application/json, text/event-stream",
            "origin": "http://localhost:5173",
          },
          body: initialize,
        });
        expect(noToken.status).toBe(401);
        expect(noToken.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
        expect(noToken.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");

        // Allowlisted origin plus the token: 200.
        const withToken = await fetch(handle.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "accept": "application/json, text/event-stream",
            "origin": "http://localhost:5173",
            "authorization": "Bearer team-bearer-token-abc",
          },
          body: initialize,
        });
        expect(withToken.status).toBe(200);
        expect(withToken.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
      } finally {
        await handle.close();
      }
    });

    test("still serves loopback requests without a token (issue #453)", async () => {
      const handle = await startHttpMcpServer({ port: 0, host: "127.0.0.1", bindHost: "127.0.0.1" });

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

        expect(resp.status).toBe(200);
      } finally {
        await handle.close();
      }
    });

    test("handles CORS OPTIONS preflight without requiring Authorization header", async () => {
      const handle = await startHttpMcpServer({
        port: 0,
        host: "127.0.0.1",
        bearerToken: "team-bearer-token-abc",
        // Issue #511: a preflight is only answered for an allowlisted origin.
        allowedOrigins: ["https://dashboard.example.com"],
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
