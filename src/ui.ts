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

      // Security Headers
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self' 'unsafe-inline' data: https://fonts.googleapis.com https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:;",
      );

      // CORS & CSRF Defense: allow localhost / 127.0.0.1 origins
      const origin = req.headers.origin;
      const isLocalOrigin = !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

      if (origin && isLocalOrigin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
      } else if (!origin) {
        res.setHeader("Access-Control-Allow-Origin", `http://localhost:${currentPort}`);
      }

      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      // Reject cross-origin state mutations from untrusted origins
      if (req.method === "POST" && !isLocalOrigin) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Forbidden: Cross-Origin Request Blocked" }));
        return;
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
