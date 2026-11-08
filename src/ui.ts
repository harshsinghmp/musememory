import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import type { Socket } from "node:net";
import type { Store } from "./store.ts";
import type { MemoryEntry } from "./types.ts";
import { list, confirm, markStale, supersede, deleteEntry, propose, openStore } from "./store.ts";
import { getGlobalMemoryDir } from "./root.ts";
import {
  STUDIO_HTML_ASSET,
  STUDIO_CSS_ASSET,
  STUDIO_JS_ASSET,
  renderStandaloneHtml,
  type StudioAsset,
} from "./ui_assets.ts";
import { setCurrent, updateSessionHandoff, WorkspaceGovernor } from "./governor.ts";
import { getUserProfile, setUserProfile, initUserProfile, type UserArchetype } from "./user.ts";
import { getAuditTrail } from "./audit.ts";
import { listWikiPages, getWikiPage } from "./wiki/index.ts";
import { RetrievalEngine } from "./retrieval/index.ts";
import { validateStore } from "./schema.ts";
import { exportSnapshot } from "./snapshot.ts";
import { getStorageLayout } from "./store.ts";
import { evaluateProjectHealth, resolveProjectName, formatAvailable } from "./health/index.ts";
import { listAdrs, detectDocumentationCodeDrift } from "./adrs/index.ts";
import {
  explainWhyCodeIsTheWayItIs,
  clusterRecurringBugsAndFriction,
  analyzeTechnicalDebt,
} from "./cognition/index.ts";
import {
  getSyncStatus,
  syncWithSharedPool,
  broadcastKnowledge,
} from "./sync/index.ts";
import {
  discoverWorkspaceMesh,
  resolveMeshMemories,
  auditMeshContracts,
  addMeshLink,
} from "./mesh/index.ts";

export interface UiServerOptions {
  port?: number;
  memoryDir: string;
  store: Store;
  token?: string;
}

/** Explicit projection contract for UI read routes (T-400). */
export interface ProjectedUiMemory {
  id: string;
  title: string;
  content: string;
  type: string;
  status: string;
  project?: string;
  tags: string[];
  salience?: number;
  verification?: {
    level?: string;
    method?: string;
    verified_at?: string;
  };
  related_memory_ids?: string[];
  created_at: string;
  updated_at?: string;
  /** Scope origin added only by the cross-project mesh view (T-452). */
  origin_project?: string;
}

/** Project raw MemoryEntry into safe UI allowlist schema (T-400). */
export function projectMemoryForUi(entry: MemoryEntry): ProjectedUiMemory {
  return {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    type: entry.type || "discovery",
    status: entry.status,
    project: entry.project,
    tags: Array.isArray(entry.tags) ? [...entry.tags] : [],
    salience: typeof entry.salience === "number" ? entry.salience : 0.5,
    verification: entry.verification
      ? {
          level: entry.verification.level,
          method: entry.verification.method,
          verified_at: entry.verification.verified_at,
        }
      : undefined,
    related_memory_ids: Array.isArray(entry.related_memory_ids) ? [...entry.related_memory_ids] : [],
    created_at: entry.created_at,
    updated_at: entry.updated_at,
  };
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

    // T-452: the studio reads memories/stats from one of three scopes. The
    // project store is the caller's; the global store is opened lazily and
    // only when ~/.memory already exists (a read must not create it).
    type StudioScope = "project" | "global" | "mesh";
    let globalStoreCache: { dir: string; store: Store } | undefined;
    const parseScope = (u: URL): StudioScope => {
      const raw = u.searchParams.get("scope");
      return raw === "global" || raw === "mesh" ? raw : "project";
    };
    const openGlobalStore = (): Store | undefined => {
      const dir = getGlobalMemoryDir();
      if (!existsSync(dir)) return undefined;
      const layout = getStorageLayout(dir);
      // A read must not mint a store. Both the YAML mirror and the SQLite file
      // have to already exist, and opening must not re-sync CURRENT.md or the wiki.
      if (!existsSync(layout.memoriesDir) || !existsSync(layout.dbPath)) return undefined;
      if (!globalStoreCache || globalStoreCache.dir !== dir) {
        globalStoreCache = {
          dir,
          store: openStore(dir, { skipSyncConstraints: true, skipAutoWiki: true }),
        };
      }
      return globalStoreCache.store;
    };
    let topologyCache: { key: string; at: number; topology: ReturnType<typeof discoverWorkspaceMesh> } | undefined;
    const meshTopology = (): ReturnType<typeof discoverWorkspaceMesh> => {
      const workspaceRoot = opts.store.layout?.root || getStorageLayout(opts.memoryDir).root;
      const key = `${workspaceRoot}|${opts.memoryDir}`;
      const now = Date.now();
      if (!topologyCache || topologyCache.key !== key || now - topologyCache.at > 2000) {
        topologyCache = { key, at: now, topology: discoverWorkspaceMesh(workspaceRoot, opts.memoryDir) };
      }
      return topologyCache.topology;
    };
    const invalidateMeshTopology = (): void => {
      topologyCache = undefined;
    };
    const meshMemories = (limit: number): Array<{ entry: MemoryEntry; origin: string }> => {
      return resolveMeshMemories(opts.store, meshTopology(), { query: "", limit }).map((r) => ({
        entry: r.memory,
        origin: r.originProject,
      }));
    };
    // Reads that have a meaningful global counterpart (CURRENT.md, wiki, persona,
    // audit) follow the scope too. Writes stay project-scoped by design; the
    // client shows a banner whenever the viewed scope is not the project store.
    const scopedView = (scope: StudioScope): { store: Store; memoryDir: string } | undefined => {
      if (scope === "global") {
        const globalStore = openGlobalStore();
        return globalStore ? { store: globalStore, memoryDir: getGlobalMemoryDir() } : undefined;
      }
      return { store: opts.store, memoryDir: opts.memoryDir };
    };

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

      // API Routes
      if (pathname === "/api/memories" && req.method === "GET") {
        const scope = parseScope(url);
        let projected: ProjectedUiMemory[];
        if (scope === "mesh") {
          projected = meshMemories(200).map((r) => ({
            ...projectMemoryForUi(r.entry),
            origin_project: r.origin,
          }));
        } else if (scope === "global") {
          const globalStore = openGlobalStore();
          projected = globalStore ? list(globalStore).map(projectMemoryForUi) : [];
        } else {
          projected = list(opts.store).map(projectMemoryForUi);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(projected));
        return;
      }

      if (pathname === "/api/stats" && req.method === "GET") {
        const scope = parseScope(url);
        const metaStore = scope === "global" ? openGlobalStore() : opts.store;
        const metaDir = scope === "global" ? getGlobalMemoryDir() : opts.memoryDir;
        const memories: MemoryEntry[] = scope === "mesh"
          ? meshMemories(200).map((r) => r.entry)
          : metaStore ? list(metaStore) : [];
        const activeState = metaStore ? WorkspaceGovernor.getActiveState(metaStore, metaDir) : undefined;
        const wiki = metaStore ? listWikiPages(metaDir) : [];
        const trail = metaStore ? getAuditTrail(metaDir, { limit: 100 }) : [];
        const typeCounts: Record<string, number> = {};
        let confirmedCount = 0;
        let linksCount = 0;

        for (const m of memories) {
          typeCounts[m.type || "discovery"] = (typeCounts[m.type || "discovery"] || 0) + 1;
          if (m.status === "confirmed") confirmedCount++;
          linksCount += (m.related_memory_ids || []).length;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          scope,
          available: scope !== "global" || Boolean(metaStore),
          total: memories.length,
          confirmed: confirmedCount,
          confirmedRatio: memories.length > 0 ? (confirmedCount / memories.length).toFixed(2) : "0.00",
          constraints: activeState ? activeState.constraints.length : 0,
          wikiPages: wiki.length,
          auditEvents: trail.length,
          links: Math.floor(linksCount / 2),
          typeCounts,
          handoff: activeState ? activeState.handoff : null,
        }));
        return;
      }

      if (pathname === "/api/snapshot" && req.method === "GET") {
        const snapshot = exportSnapshot(opts.store);
        const projectedSnapshot = {
          ...snapshot,
          entries: snapshot.entries.map(projectMemoryForUi),
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(projectedSnapshot));
        return;
      }

      if (pathname === "/api/validate" && req.method === "GET") {
        const report = validateStore(opts.store);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(report));
        return;
      }

      if (pathname === "/api/current" && req.method === "GET") {
        const view = scopedView(parseScope(url));
        const state = view ? WorkspaceGovernor.getActiveState(view.store, view.memoryDir) : undefined;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ lines: state ? state.constraints : [], handoff: state ? state.handoff : null }));
        return;
      }

      if (pathname === "/api/current" && req.method === "POST") {
        try {
          const body = await parseJsonBody(req);
          if (body.text) {
            const lines = setCurrent(opts.memoryDir, String(body.text), String(body.project || "default"));
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ lines }));
            return;
          }
          if (body.handoff) {
            const updated = updateSessionHandoff(opts.memoryDir, body.handoff as any);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(updated));
            return;
          }
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid current request" }));
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        }
        return;
      }

      if (pathname === "/api/wiki" && req.method === "GET") {
        const view = scopedView(parseScope(url));
        const pageSlug = url.searchParams.get("page");
        if (pageSlug) {
          const page = view ? getWikiPage(view.memoryDir, pageSlug) : undefined;
          if (!page) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Wiki page '${pageSlug}' not found` }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(page));
          return;
        }
        const pages = view ? listWikiPages(view.memoryDir) : [];
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ pages }));
        return;
      }

      if (pathname === "/api/user-profile" && req.method === "GET") {
        const view = scopedView(parseScope(url));
        const profile = view ? getUserProfile(view.memoryDir) : null;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ profile }));
        return;
      }

      if (pathname === "/api/user-profile" && req.method === "POST") {
        try {
          const body = await parseJsonBody(req);
          const archetype = body.archetype as UserArchetype | undefined;
          if (archetype) {
            initUserProfile(opts.memoryDir, archetype);
          } else if (body.content) {
            setUserProfile(opts.memoryDir, String(body.content));
          }
          const updated = getUserProfile(opts.memoryDir);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ profile: updated }));
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        }
        return;
      }

      if (pathname === "/api/audit" && req.method === "GET") {
        const rawLimit = parseInt(url.searchParams.get("limit") || "50", 10);
        const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(1000, rawLimit) : 50;
        const view = scopedView(parseScope(url));
        const trail = view ? getAuditTrail(view.memoryDir, { limit }) : [];
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ trail }));
        return;
      }

      if (pathname === "/api/search" && req.method === "POST") {
        try {
          const body = await parseJsonBody(req);
          const query = String(body.query || "");
          const tokenBudget = typeof body.tokenBudget === "number" && Number.isFinite(body.tokenBudget) && body.tokenBudget > 0
            ? Math.min(100000, Math.floor(body.tokenBudget))
            : undefined;
          const rawLimit = typeof body.limit === "number" ? body.limit : 10;
          const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(500, rawLimit) : 10;
          const mode = body.mode as any || "auto";
          const resSearch = RetrievalEngine.search(opts.store, opts.memoryDir, query, {
            mode,
            tokenBudget,
            limit,
            type: body.type ? String(body.type) : undefined,
            status: body.status ? String(body.status) : undefined,
          });
          const promptCtx = RetrievalEngine.formatPromptContext(opts.store, opts.memoryDir, query, {
            tokenBudget,
            depth: body.depth as any || "L2",
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ search: resSearch, promptContext: promptCtx }));
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        }
        return;
      }

      if (pathname === "/api/propose" && req.method === "POST") {
        try {
          const body = await parseJsonBody(req);
          const entry = propose(opts.store, {
            content: String(body.content || ""),
            project: String(body.project || "default"),
            title: body.title ? String(body.title) : undefined,
            tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
            type: body.type as any,
            confirmed: body.confirmed === true,
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(entry));
        } catch (err: unknown) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        }
        return;
      }

      if (pathname === "/api/confirm" && req.method === "POST") {
        try {
          const body = await parseJsonBody(req);
          const entry = confirm(opts.store, String(body.id));
          if (!entry) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Could not confirm ${body.id}` }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(entry));
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        }
        return;
      }

      if (pathname === "/api/mark-stale" && req.method === "POST") {
        try {
          const body = await parseJsonBody(req);
          const entry = markStale(opts.store, String(body.id), body.reason ? String(body.reason) : undefined);
          if (!entry) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Could not mark ${body.id} stale` }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(entry));
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        }
        return;
      }

      if (pathname === "/api/supersede" && req.method === "POST") {
        try {
          const body = await parseJsonBody(req);
          const entry = supersede(opts.store, String(body.oldId), String(body.newId));
          if (!entry) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Could not supersede ${body.oldId} with ${body.newId}` }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(entry));
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        }
        return;
      }

      if (pathname === "/api/delete" && req.method === "POST") {
        try {
          const body = await parseJsonBody(req);
          const ok = deleteEntry(opts.store, String(body.id), body.reason ? String(body.reason) : "Web UI delete", "web_user");
          if (!ok) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Could not delete ${body.id}` }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, id: body.id }));
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        }
        return;
      }

      if (pathname === "/api/refresh" && req.method === "POST") {
        try {
          const body = await parseJsonBody(req);
          let harvestedCount = 0;
          if (body.harvest === true) {
            try {
              const { harvestAllAgentTranscripts } = await import("./harvester.ts");
              const h = harvestAllAgentTranscripts(opts.store, { memoryDir: opts.memoryDir });
              harvestedCount = h.memoriesImported;
            } catch {}
          }
          const memories = list(opts.store);
          const activeState = WorkspaceGovernor.getActiveState(opts.store, opts.memoryDir);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: true,
            totalMemories: memories.length,
            activeConstraints: activeState.constraints.length,
            harvestedCount,
            timestamp: new Date().toISOString(),
          }));
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        }
        return;
      }

      if (pathname === "/api/optimize" && req.method === "POST") {
        try {
          const body = await parseJsonBody(req);
          const dryRun = body.dryRun !== false; // Default to dryRun: true (T-004)

          // Localhost / Token Gate (T-004)
          const expectedToken = opts.token || process.env.MUSE_UI_TOKEN;
          const remoteIp = req.socket?.remoteAddress;
          const isLoopback = remoteIp === "127.0.0.1" || remoteIp === "::1" || remoteIp === "::ffff:127.0.0.1";
          const headerToken = req.headers["x-muse-token"];
          const authHeader = typeof req.headers.authorization === "string" ? req.headers.authorization : undefined;
          const bearerToken = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader;
          const providedToken = (typeof headerToken === "string" ? headerToken : undefined) || bearerToken;

          if (expectedToken) {
            if (providedToken !== expectedToken) {
              res.writeHead(403, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Forbidden: Invalid or missing authentication token" }));
              return;
            }
          } else if (!isLoopback && !dryRun) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Forbidden: Non-dryRun optimization requires localhost origin or configured token" }));
            return;
          }

          const { optimizeStore } = await import("./optimize.ts");
          const report = optimizeStore(opts.store, {
            memoryDir: opts.memoryDir,
            project: body.project ? String(body.project) : undefined,
            dryRun,
            force: body.force !== false,
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, report }));
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        }
        return;
      }

      if (pathname === "/api/optimize/status" && req.method === "GET") {
        try {
          const { readOptimizationMetadata, shouldAutoOptimize } = await import("./optimize.ts");
          const meta = readOptimizationMetadata(opts.memoryDir);
          const autoCheck = shouldAutoOptimize(opts.memoryDir);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: true,
            meta,
            shouldAutoOptimize: autoCheck.shouldRun,
            autoOptimizeReason: autoCheck.reason,
          }));
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        }
        return;
      }

      const workspaceRoot = opts.store.layout?.root || getStorageLayout(opts.memoryDir).root;

      // R15: Project Health Gate Endpoint
      if (pathname === "/api/health" && req.method === "GET") {
        try {
          // T-321: optional project scope filter.
          // T-406: the requested name resolves case-insensitively to the
          // canonical store spelling; an unknown project answers 404 with
          // what IS available instead of a silent 200-empty report.
          const requestedProject = url.searchParams.get("project")?.trim() || undefined;
          const canonicalProject = resolveProjectName(opts.store, requestedProject);
          if (requestedProject && canonicalProject === undefined) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: `no memories for project "${requestedProject}" — available: ${formatAvailable(opts.store)}`,
              }),
            );
            return;
          }
          const report = evaluateProjectHealth(opts.store, workspaceRoot, {
            project: canonicalProject,
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(report));
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }

      // R15: Architecture Decision Records Endpoint
      if (pathname === "/api/adrs" && req.method === "GET") {
        try {
          const adrs = listAdrs(opts.store);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(adrs));
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }

      // R15: Code ↔ Documentation Drift Endpoint
      if (pathname === "/api/drift" && req.method === "GET") {
        try {
          // T-321: optional project scope filter.
          // T-406 fan-out: the requested name resolves case-insensitively to
          // the canonical store spelling; an unknown project answers 404 with
          // what IS available instead of a silent 200-empty report.
          const requestedProject = url.searchParams.get("project")?.trim() || undefined;
          const canonicalProject = resolveProjectName(opts.store, requestedProject);
          if (requestedProject && canonicalProject === undefined) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: `no memories for project "${requestedProject}" — available: ${formatAvailable(opts.store)}`,
              }),
            );
            return;
          }
          const drift = detectDocumentationCodeDrift(opts.store, workspaceRoot, {
            project: canonicalProject,
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(drift));
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }

      // R15: Cognition "Why" Reasoner Endpoint
      if (pathname === "/api/cognition/why" && req.method === "POST") {
        try {
          const body = await parseJsonBody(req);
          const query = typeof body.query === "string" ? body.query : (typeof body.symbol_or_path === "string" ? body.symbol_or_path : "");
          const explanation = explainWhyCodeIsTheWayItIs(opts.store, {
            target: query,
            filePath: typeof body.file_path === "string" ? body.file_path : undefined,
            symbolName: typeof body.symbol_name === "string" ? body.symbol_name : undefined,
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(explanation));
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }

      // R15: Cognition Recurring Bug Clusters Endpoint
      if (pathname === "/api/cognition/clusters" && req.method === "GET") {
        try {
          // T-321: optional project scope filter.
          // T-406 fan-out: the requested name resolves case-insensitively to
          // the canonical store spelling; an unknown project answers 404 with
          // what IS available instead of a silent 200-empty report.
          const requestedProject = url.searchParams.get("project")?.trim() || undefined;
          const canonicalProject = resolveProjectName(opts.store, requestedProject);
          if (requestedProject && canonicalProject === undefined) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: `no memories for project "${requestedProject}" — available: ${formatAvailable(opts.store)}`,
              }),
            );
            return;
          }
          const clusters = clusterRecurringBugsAndFriction(opts.store, {
            project: canonicalProject,
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ total_clusters: clusters.length, clusters }));
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }

      // R15: Cognition Technical Debt Endpoint
      if (pathname === "/api/cognition/debt" && req.method === "GET") {
        try {
          // T-321: optional project scope filter.
          // T-406 fan-out: the requested name resolves case-insensitively to
          // the canonical store spelling; an unknown project answers 404 with
          // what IS available instead of a silent 200-empty report.
          const requestedProject = url.searchParams.get("project")?.trim() || undefined;
          const canonicalProject = resolveProjectName(opts.store, requestedProject);
          if (requestedProject && canonicalProject === undefined) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: `no memories for project "${requestedProject}" — available: ${formatAvailable(opts.store)}`,
              }),
            );
            return;
          }
          const debt = analyzeTechnicalDebt(opts.store, workspaceRoot, {
            project: canonicalProject,
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(debt));
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }

      // R15: P2P Sync Status Endpoint
      if (pathname === "/api/sync/status" && req.method === "GET") {
        try {
          const status = getSyncStatus(opts.store, workspaceRoot);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(status));
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }

      // R15: P2P Sync Pool Endpoint
      if (pathname === "/api/sync/pool" && req.method === "POST") {
        try {
          const body = await parseJsonBody(req);
          const poolDir = typeof body.pool_dir === "string" ? body.pool_dir : undefined;
          const agentId = typeof body.agent_id === "string" ? body.agent_id : undefined;
          const report = syncWithSharedPool(opts.store, workspaceRoot, poolDir, agentId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(report));
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }

      // R15: P2P Broadcast Endpoint
      if (pathname === "/api/sync/broadcast" && req.method === "POST") {
        try {
          const body = await parseJsonBody(req);
          const agentId = typeof body.agent_id === "string" ? body.agent_id : undefined;
          const project = typeof body.project === "string" ? body.project : undefined;
          const packet = broadcastKnowledge(opts.store, workspaceRoot, { agentId, project });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(packet));
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }

      // R16: Mesh Topology Status Endpoint
      if (pathname === "/api/mesh/status" && req.method === "GET") {
        try {
          const topology = meshTopology();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(topology));
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }

      // R16: Mesh Cross-Project Query Endpoint
      if (pathname === "/api/mesh/query" && req.method === "GET") {
        try {
          const q = url.searchParams.get("q") || "";
          const topology = meshTopology();
          const results = resolveMeshMemories(opts.store, topology, { query: q });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(results));
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }

      // R16: Mesh Contract Audit Endpoint
      if (pathname === "/api/mesh/audit" && req.method === "GET") {
        try {
          const topology = meshTopology();
          const audit = auditMeshContracts(topology, opts.store);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(audit));
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }

      // R16: Mesh Link Endpoint
      if (pathname === "/api/mesh/link" && req.method === "POST") {
        try {
          const body = await parseJsonBody(req);
          const targetPath = typeof body.path === "string" ? body.path : "";
          if (!targetPath) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing required 'path' field" }));
            return;
          }
          addMeshLink(opts.memoryDir, targetPath);
          invalidateMeshTopology();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, linked: targetPath }));
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }

      if (pathname === "/api/export-html" && req.method === "GET") {
        const html = exportStandaloneHtml(opts.store);
        res.setHeader("Content-Disposition", 'attachment; filename="musememory-graph.html"');
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

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
          try {
            globalStoreCache?.store.db?.close();
          } catch {}
          server.close();
        },
      });
    });
  });
}

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB payload limit

function parseJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    let byteLength = 0;
    req.on("data", (chunk: Buffer | string) => {
      byteLength += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
      if (byteLength > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error("Payload too large: request body exceeds 1MB limit"));
        return;
      }
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

export function exportStandaloneHtml(store: Store): string {
  return renderStandaloneHtml(store);
}
