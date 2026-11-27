/**
 * Streamable HTTP transport + Bearer auth for the MCP server (issue #444, slice 2).
 *
 * Lifted out of `src/mcp.ts` so the protocol surface, the dispatch switch and the
 * transport stop sharing one file. The MCP `Server` factory (`createServer`) and the
 * protocol-version allowlist still live in `../mcp.ts` and are imported from there —
 * this module is a leaf that depends on `mcp.ts`, never the other way round, so there
 * is no import cycle. Behaviour is unchanged: same auth results, status codes,
 * headers, SSE/JSON responses, port binding and shutdown.
 */
import { randomUUID } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
  type Server as HttpServer,
} from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, SUPPORTED_MCP_PROTOCOL_VERSIONS } from "../mcp.ts";
import { isLoopbackHost } from "../net.ts";

export interface HttpMcpServerOptions {
  port?: number;
  host?: string;
  endpoint?: string;
  stateless?: boolean;
  enableJsonResponse?: boolean;
  /**
   * T-151 / issue #511: the operator's browser-origin allowlist (`--allowed-origins`).
   *
   * A request that carries an `Origin` header is a browser request, and it is
   * allowed **only** when that exact origin is listed here. An absent `Origin`
   * means a native MCP client and is always allowed. There is no
   * "loopback implies trusted" shortcut: the default is deny for every browser
   * origin, because any web page the user visits can reach 127.0.0.1.
   */
  allowedOrigins?: string[];
  /** T-151: Allowed Host headers for DNS rebinding protection. */
  allowedHosts?: string[];
  /** T-151: Enable strict DNS rebinding validation against allowedHosts. */
  enableDnsRebindingProtection?: boolean;
  /** T-386: Single bearer token or require auth flag. */
  bearerToken?: string;
  /** T-386: Map of token -> peer ID or peer ID -> token, or array of valid tokens. */
  bearerTokens?: string[] | Record<string, string>;
  /** T-386: Allowlist of authorized peer identifiers. */
  allowedPeers?: string[];
  /** T-386: Require authentication even if tokens are passed via env or settings. */
  requireAuth?: boolean;
  /**
   * Issue #453: the address the server actually binds. Authentication is
   * required whenever this is not loopback, even without `requireAuth` or a
   * configured token, so a programmatic caller cannot expose every tool by
   * binding `0.0.0.0`. Defaults to `host`.
   */
  bindHost?: string;
  /**
   * Issue #453: explicit opt-out for an *unauthenticated* non-loopback bind.
   * Only the CLI's `--insecure` flag sets it, and only after printing the
   * exposure warning. With a token configured, auth is enforced regardless.
   */
  allowInsecureBind?: boolean;
}

export interface HttpAuthResult {
  authenticated: boolean;
  peerId?: string;
  status?: number;
  errorMessage?: string;
}

export interface HttpOriginResult {
  allowed: boolean;
  /**
   * The only value this server may ever put in `access-control-allow-origin`:
   * an origin that `allowedOrigins` explicitly contains. Never `*`, never an
   * echo of an arbitrary caller header.
   */
  allowOrigin?: string;
  status?: number;
  errorMessage?: string;
}

/**
 * Issue #511: decide whether a request may proceed, based on its `Origin` header.
 *
 * The transport previously authenticated only when a token existed or the bind
 * was non-loopback, so the default `127.0.0.1` server answered everyone — and
 * its OPTIONS branch reflected `req.headers.origin ?? "*"` with `authorization`
 * in `access-control-allow-headers`. Any page the user loaded could therefore
 * POST `initialize` + `tools/call` to `http://127.0.0.1:<port>/mcp` and drive
 * every tool (integrity/availability; response bodies stay unreadable).
 *
 * Native MCP clients send no `Origin` header; browsers always do. That is the
 * discriminator: absent → allow (non-browser client); present → allow only when
 * `options.allowedOrigins` explicitly includes it. Deny is the default even on
 * loopback, and it applies before auth and before dispatch.
 */
export function validateHttpOrigin(
  req: IncomingMessage,
  options: HttpMcpServerOptions = {},
): HttpOriginResult {
  const rawOrigin = req.headers["origin"];
  if (rawOrigin === undefined) {
    // No Origin header: a native MCP client (stdio-bridge, CLI, SDK, curl).
    return { allowed: true };
  }

  const origin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;

  // An empty or opaque (`Origin: null`) value is a browser origin like any
  // other — it is not a wildcard, and it is not allowlisted by default.
  if (typeof origin === "string" && options.allowedOrigins?.includes(origin)) {
    return { allowed: true, allowOrigin: origin };
  }

  return {
    allowed: false,
    status: 403,
    errorMessage: `Forbidden: Origin '${origin ?? ""}' is not allowed (browser origins must be allowlisted with --allowed-origins; MCP clients that send no Origin header are unaffected)`,
  };
}

/**
 * T-386: Validate Bearer token authentication and per-peer allowlists on HTTP MCP requests.
 */
export function validateHttpAuth(
  req: IncomingMessage,
  options: HttpMcpServerOptions,
): HttpAuthResult {
  const tokenToPeer = new Map<string, string>();
  const validTokens = new Set<string>();

  if (options.bearerToken) {
    validTokens.add(options.bearerToken);
    tokenToPeer.set(options.bearerToken, "default");
  }

  if (Array.isArray(options.bearerTokens)) {
    for (const t of options.bearerTokens) {
      if (t.includes(":")) {
        const [peer, tok] = t.split(":");
        validTokens.add(tok.trim());
        tokenToPeer.set(tok.trim(), peer.trim());
      } else {
        validTokens.add(t.trim());
      }
    }
  } else if (options.bearerTokens && typeof options.bearerTokens === "object") {
    for (const [k, v] of Object.entries(options.bearerTokens)) {
      validTokens.add(v);
      tokenToPeer.set(v, k);
      validTokens.add(k);
      tokenToPeer.set(k, v);
    }
  }

  if (validTokens.size === 0) {
    const envToken = process.env.MUSE_BEARER_TOKEN;
    if (envToken) {
      validTokens.add(envToken.trim());
      tokenToPeer.set(envToken.trim(), "default");
    }
    const envTokens = process.env.MUSE_AUTH_TOKENS;
    if (envTokens) {
      for (const item of envTokens.split(",")) {
        const trimmed = item.trim();
        if (trimmed.includes(":")) {
          const [peer, tok] = trimmed.split(":");
          validTokens.add(tok.trim());
          tokenToPeer.set(tok.trim(), peer.trim());
        } else if (trimmed) {
          validTokens.add(trimmed);
        }
      }
    }
  }

  // Issue #453: the HTTP transport used to fail open whenever no token was
  // configured, so `--host 0.0.0.0` (or any programmatic non-loopback bind)
  // exposed every tool anonymously. A non-loopback bind now always requires
  // authentication; the loopback fail-open path is kept intact so local MCP
  // clients keep working without configuration.
  const bindHost = options.bindHost ?? options.host;
  const authRequiredByBind =
    bindHost !== undefined && !isLoopbackHost(bindHost) && options.allowInsecureBind !== true;

  const isAuthRequired = options.requireAuth || validTokens.size > 0 || authRequiredByBind;
  if (!isAuthRequired) {
    return { authenticated: true };
  }

  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    return {
      authenticated: false,
      status: 401,
      errorMessage:
        authRequiredByBind && validTokens.size === 0 && !options.requireAuth
          ? `Unauthorized: Missing Bearer token in Authorization header (authentication is mandatory on the non-loopback bind "${bindHost}")`
          : "Unauthorized: Missing Bearer token in Authorization header",
    };
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return {
      authenticated: false,
      status: 401,
      errorMessage: "Unauthorized: Invalid Authorization header format. Expected 'Bearer <token>'",
    };
  }

  const token = match[1].trim();
  if (!validTokens.has(token)) {
    return {
      authenticated: false,
      status: 403,
      errorMessage: "Forbidden: Invalid Bearer token",
    };
  }

  const mappedPeer = tokenToPeer.get(token);
  const headerPeer = (req.headers["mcp-peer-id"] || req.headers["x-peer-id"]) as string | undefined;
  // A single shared token maps to the synthetic identity "default": it says
  // "authenticated", not "this is peer X". Only an explicit `peer:token` mapping
  // is an identity, and a conflicting header against one is an attempt to
  // borrow another peer's name — rejected rather than resolved in favour of
  // either side.
  const identityPeer = mappedPeer && mappedPeer !== "default" ? mappedPeer : undefined;
  if (identityPeer && headerPeer && headerPeer !== identityPeer) {
    return {
      authenticated: false,
      status: 403,
      errorMessage: "Forbidden: peer header does not match the token identity",
    };
  }
  const peerId = identityPeer ?? headerPeer ?? mappedPeer ?? "default";

  if (options.allowedPeers && options.allowedPeers.length > 0) {
    const isPeerAllowed =
      options.allowedPeers.includes(peerId) ||
      (mappedPeer ? options.allowedPeers.includes(mappedPeer) : false);

    if (!isPeerAllowed) {
      return {
        authenticated: false,
        status: 403,
        errorMessage: `Forbidden: Peer '${peerId}' is not authorized`,
      };
    }
  }

  return { authenticated: true, peerId };
}

export interface HttpMcpServerHandle {
  server: HttpServer;
  port: number;
  host: string;
  url: string;
  endpoint: string;
  close: () => Promise<void>;
}

/**
 * T-150, T-151, T-386 & #511: Start MCP Streamable HTTP transport server (2025-06-18 spec).
 * Supports JSON-RPC tool/method execution over HTTP POST and SSE streaming,
 * with strict Bearer token authentication, per-peer allowlists, deny-by-default
 * browser-origin validation, DNS rebinding protection, and protocol version headers.
 */
export async function startHttpMcpServer(options: HttpMcpServerOptions = {}): Promise<HttpMcpServerHandle> {
  const server = createServer();
  const endpoint = options.endpoint ?? "/mcp";
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: options.stateless ? undefined : () => randomUUID(),
    enableJsonResponse: options.enableJsonResponse ?? true,
    allowedOrigins: options.allowedOrigins,
    allowedHosts: options.allowedHosts,
    enableDnsRebindingProtection: options.enableDnsRebindingProtection,
  });

  await server.connect(transport);

  /**
   * Issue #511: the single refusal path for a browser origin that is not on the
   * allowlist. It never sets `access-control-allow-origin`, so a browser cannot
   * even read the refusal.
   */
  const rejectOrigin = (res: ServerResponse, errorMessage: string): void => {
    res.writeHead(403, { "content-type": "application/json", vary: "Origin" });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: errorMessage },
        id: null,
      }),
    );
  };

  const httpServer = createHttpServer((req, res) => {
    // Issue #511: the Origin decision runs first, for the pre-flight *and* for
    // every real request, before auth and before dispatch. A request with no
    // Origin is a native MCP client and is unaffected; a request with an Origin
    // is a browser and must name an allowlisted origin.
    const originResult = validateHttpOrigin(req, options);
    if (!originResult.allowed) {
      rejectOrigin(res, originResult.errorMessage ?? "Forbidden: Origin is not allowed");
      return;
    }

    // Handle CORS OPTIONS pre-flight. Only an allowlisted origin is ever
    // echoed; there is no `*` fallback, because `*` plus the pre-flight's
    // `authorization` allowance is exactly what let a web page drive the tools.
    if (req.method === "OPTIONS") {
      const headers: Record<string, string> = {
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers":
          "content-type, authorization, accept, mcp-session-id, mcp-protocol-version, mcp-peer-id, x-peer-id",
        "access-control-max-age": "86400",
        vary: "Origin",
      };
      if (originResult.allowOrigin) {
        headers["access-control-allow-origin"] = originResult.allowOrigin;
      }
      res.writeHead(204, headers);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === endpoint || (endpoint === "/mcp" && url.pathname === "/")) {
      // An allowlisted browser origin gets a readable (if always same-origin
      // policy) answer; nothing else can appear in this header.
      if (originResult.allowOrigin) {
        res.setHeader("access-control-allow-origin", originResult.allowOrigin);
        res.setHeader("vary", "Origin");
      }
      // T-386: Bearer token auth + per-peer allowlist
      const authResult = validateHttpAuth(req, options);
      if (!authResult.authenticated) {
        const status = authResult.status ?? 401;
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (status === 401) {
          headers["www-authenticate"] = 'Bearer error="invalid_token"';
        }
        res.writeHead(status, headers);
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: status === 401 ? -32002 : -32000,
              message: authResult.errorMessage,
            },
            id: null,
          }),
        );
        return;
      }
      // T-151: Protocol version header validation and echo
      const clientProtoVersion = req.headers["mcp-protocol-version"];
      if (typeof clientProtoVersion === "string") {
        if (!SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(clientProtoVersion)) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -32000,
                message: `Unsupported protocol version: ${clientProtoVersion}. Supported: ${SUPPORTED_MCP_PROTOCOL_VERSIONS.join(", ")}`,
              },
              id: null,
            }),
          );
          return;
        }
        res.setHeader("mcp-protocol-version", clientProtoVersion);
      } else {
        res.setHeader("mcp-protocol-version", "2024-11-05");
      }

      // T-151: Allowed hosts check (DNS-rebinding protection, unchanged)
      if (options.allowedHosts && options.allowedHosts.length > 0) {
        const hostHeader = (req.headers["host"] ?? "").split(":")[0];
        if (!options.allowedHosts.includes(hostHeader)) {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -32000,
                message: `Forbidden: Host '${hostHeader}' is not allowed`,
              },
              id: null,
            }),
          );
          return;
        }
      }

      transport.handleRequest(req, res);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not Found");
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, host, () => resolve());
    httpServer.on("error", reject);
  });

  const address = httpServer.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const actualUrl = `http://${host}:${actualPort}${endpoint}`;

  return {
    server: httpServer,
    port: actualPort,
    host,
    url: actualUrl,
    endpoint,
    close: async () => {
      await transport.close();
      await server.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
