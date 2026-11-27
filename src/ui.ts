import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { Store } from "./store.ts";
import {
  STUDIO_HTML_ASSET,
  STUDIO_CSS_ASSET,
  STUDIO_JS_ASSET,
  renderStandaloneHtml,
  type StudioAsset,
} from "./ui_assets.ts";
import { createStudioRouter, READ_ONLY_POST_ROUTES } from "./ui/routes.ts";

// The Studio projection contract lives with the routes that use it; re-exported
// here so `src/ui.ts` keeps the surface its importers already depend on.
export { projectMemoryForUi, type ProjectedUiMemory } from "./ui/routes.ts";

export interface UiServerOptions {
  port?: number;
  memoryDir: string;
  store: Store;
  token?: string;
}

/** Pure HTML escaping helper for strings without external DOM dependencies. */
export function escapeHtml(str: string): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Issue #520: the Studio is a loopback dashboard that renders *stored memory
 * content* — titles, bodies, tags, wiki pages — and until now it served that
 * content with no content-security policy at all (the marketing site got one in
 * #465). Everything the shell needs is same-origin: one stylesheet, one script,
 * no webfonts, no CDN. Inline styles are the single exception, because the shell
 * and the client both use `style="…"` attributes for layout; scripts get no such
 * exemption, which is why the shell carries no `onclick=` attributes (they name
 * a `data-action` instead and one delegated listener in the asset dispatches).
 */
export const STUDIO_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * Issue #520: every Studio response — page, asset, API, even the 403 and the
 * 404 — carries the same hardening headers. `/api/*` is additionally
 * `Cache-Control: no-store`, so a proxy (or the browser's back/forward cache)
 * cannot hand back a projection the server has since invalidated.
 */
export function applyStudioSecurityHeaders(res: ServerResponse, isApi: boolean): void {
  res.setHeader("Content-Security-Policy", STUDIO_CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (isApi) res.setHeader("Cache-Control", "no-store");
}

/**
 * Issue #520: same-origin test for browser requests to `/api/*`.
 *
 * The comparison is scheme-insensitive and against the request's *own* `Host`
 * header: `Origin: http://localhost:2222` is accepted only when the request was
 * addressed to `localhost:2222`. A page on `evil.example` therefore cannot drive
 * the API even though the server is listening on loopback — the browser sends
 * the attacker's origin, which never equals the Host it connected to. `Origin:
 * null` (a sandboxed frame, or a `file://` page) is not a URL and is refused.
 * No `Origin` at all — curl, a native client, and some same-origin GETs — stays
 * allowed, matching the behaviour of `validateHttpOrigin` for the MCP transport.
 */
export function isSameOriginRequest(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || !host) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return parsed.host.toLowerCase() === host.trim().toLowerCase();
}

/** Full Accept-Encoding negotiation: q-values, `identity`, and `*` fallbacks. */
interface EncodingPreference {
  gzipQ: number;
  identityQ: number;
}

function negotiateEncoding(header: string): EncodingPreference {
  const raw = header.trim();
  // No advertisement means the client did not ask for compression. Serving
  // gzip to a plain curl would hand it bytes it cannot decode.
  if (!raw) return { gzipQ: 0, identityQ: 1 };
  let gzipQ: number | undefined;
  let identityQ: number | undefined;
  let starQ: number | undefined;
  for (const part of raw.split(",")) {
    const [codingRaw, ...params] = part.split(";").map((p) => p.trim());
    const coding = codingRaw.toLowerCase();
    if (coding !== "gzip" && coding !== "identity" && coding !== "*") continue;
    const qParam = params.find((p) => /^q\s*=/i.test(p));
    const parsed = qParam ? Number.parseFloat(qParam.replace(/^q\s*=\s*/i, "")) : 1;
    const q = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0;
    if (coding === "gzip") gzipQ = q;
    else if (coding === "identity") identityQ = q;
    else starQ = q;
  }
  // gzip is acceptable only when listed or covered by `*`; identity is
  // acceptable by default unless explicitly refused.
  return { gzipQ: gzipQ ?? starQ ?? 0, identityQ: identityQ ?? starQ ?? 1 };
}

/**
 * Wave 23 / T-453: serve a prebuilt studio asset with a strong ETag, a 304 fast
 * path, and the gzip buffer that was compressed once at module load.
 */
function sendAsset(
  req: IncomingMessage,
  res: ServerResponse,
  asset: StudioAsset,
  cacheControl = "no-cache",
): void {
  const encoding = negotiateEncoding(String(req.headers["accept-encoding"] ?? ""));
  if (encoding.gzipQ <= 0 && encoding.identityQ <= 0) {
    res.writeHead(406, { "Content-Type": "text/plain" });
    res.end("Not Acceptable: no supported content encoding");
    return;
  }
  const useGzip = encoding.gzipQ > 0 && encoding.gzipQ >= encoding.identityQ;
  const activeEtag = useGzip ? asset.gzipEtag : asset.etag;
  const ifNoneMatch = req.headers["if-none-match"];
  const normalize = (value: string) => value.trim().replace(/^W\//, "");
  const candidates = typeof ifNoneMatch === "string"
    ? ifNoneMatch.split(",").map((v) => v.trim())
    : [];
  if (candidates.some((c) => c === "*" || normalize(c) === normalize(activeEtag))) {
    res.writeHead(304, { ETag: activeEtag, "Cache-Control": cacheControl, Vary: "Accept-Encoding" });
    res.end();
    return;
  }
  if (useGzip) {
    res.writeHead(200, {
      "Content-Type": asset.contentType,
      "Content-Encoding": "gzip",
      "Content-Length": asset.gzip.length,
      ETag: activeEtag,
      "Cache-Control": cacheControl,
      Vary: "Accept-Encoding",
    });
    res.end(req.method === "HEAD" ? undefined : asset.gzip);
    return;
  }
  res.writeHead(200, {
    "Content-Type": asset.contentType,
    "Content-Length": Buffer.byteLength(asset.body, "utf8"),
    ETag: activeEtag,
    "Cache-Control": cacheControl,
    Vary: "Accept-Encoding",
  });
  res.end(req.method === "HEAD" ? undefined : asset.body);
}

export function startUiServer(opts: UiServerOptions): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const rawPort = opts.port !== undefined ? Number(opts.port) : undefined;
    if (rawPort !== undefined && (!Number.isInteger(rawPort) || rawPort < 0 || rawPort > 65535)) {
      return reject(new Error(`Invalid port: ${opts.port}. Port must be an integer between 0 and 65535.`));
    }
    const activeSockets = new Set<Socket>();
    let currentPort = rawPort ?? 2222;

    // Issue #450: every `/api` branch lives in the route table. The router owns
    // the state that outlives a request (T-466 projection cache, global store
    // handle, mesh + agent-hub caches, backup counter); this function owns the
    // server, its lifecycle and static file serving.
    const router = createStudioRouter({
      store: opts.store,
      memoryDir: opts.memoryDir,
      token: opts.token,
    });

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (req.socket && !activeSockets.has(req.socket as Socket)) {
        const sock = req.socket as Socket;
        activeSockets.add(sock);
        sock.once("close", () => activeSockets.delete(sock));
      }
      let url: URL;
      try {
        url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      } catch {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/plain");
        res.end("Bad Request: Invalid URL or Host header");
        return;
      }
      const pathname = url.pathname;

      // Issue #520: hardening headers on every response, not just the HTML —
      // the JSON the dashboard renders is memory content too.
      const isApiPath = pathname === "/api" || pathname.startsWith("/api/");
      applyStudioSecurityHeaders(res, isApiPath);

      // Issue #520: browser requests to `/api/*` must be same-origin. The old
      // gate only looked at the POST method and accepted any
      // `http://localhost:<port>` origin, so a page served from another loopback
      // port — or any page at all, for a GET — could read the store. The gate now
      // runs before dispatch and before the OPTIONS branch, and covers reads.
      // A refusal carries no CORS headers, so it grants nothing to retry with.
      const origin = req.headers.origin;
      const sameOrigin = origin !== undefined && isSameOriginRequest(origin, req.headers.host);

      if (isApiPath && origin !== undefined && !sameOrigin) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Forbidden: Cross-Origin Request Blocked" }));
        return;
      }

      if (sameOrigin) {
        // Same-origin by construction, so this confirms rather than grants: the
        // browser never needed it, and no other origin is ever echoed.
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      }

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // Only real mutations invalidate the projection cache; read-only POSTs
      // (search, why) must not throw the whole projection away.
      if (req.method === "POST" && !READ_ONLY_POST_ROUTES.has(pathname)) router.invalidateProjections();

      // Wave 23 / T-453: modular static assets, cached by ETag and shipped
      // pre-compressed so repeat loads are a 304 or one cached body.
      if (pathname === "/assets/studio.css" && (req.method === "GET" || req.method === "HEAD")) {
        sendAsset(req, res, STUDIO_CSS_ASSET);
        return;
      }

      if (pathname === "/assets/studio.js" && (req.method === "GET" || req.method === "HEAD")) {
        sendAsset(req, res, STUDIO_JS_ASSET);
        return;
      }

      // API routes: exact `METHOD path` lookup in the Studio route table.
      if (await router.dispatch(req, res, url)) return;

      // Default: Serve the studio shell (cached by ETag; assets load separately)
      if (pathname === "/" || pathname === "/index.html") {
        sendAsset(req, res, STUDIO_HTML_ASSET);
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && opts.port === undefined) {
        currentPort++;
        server.listen(currentPort, "127.0.0.1");
      } else {
        reject(err);
      }
    });

    server.on("connection", (socket: Socket) => {
      activeSockets.add(socket);
      socket.on("close", () => activeSockets.delete(socket));
    });

    server.listen(currentPort, "127.0.0.1", () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : currentPort;
      resolve({
        port: actualPort,
        close: () => {
          for (const s of activeSockets) {
            s.destroy();
          }
          activeSockets.clear();
          router.close();
          server.close();
        },
      });
    });
  });
}

export function exportStandaloneHtml(store: Store): string {
  return renderStandaloneHtml(store);
}
