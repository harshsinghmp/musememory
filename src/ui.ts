import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Store } from "./store.ts";
import { list, get, confirm, markStale, supersede, deleteEntry, propose } from "./store.ts";
import { getCurrent, setCurrent, parseCurrentFile, writeCurrentFile, updateSessionHandoff, getSessionHandoff, WorkspaceGovernor } from "./governor.ts";
import { getUserProfile, setUserProfile, initUserProfile, type UserArchetype } from "./user.ts";
import { getAuditTrail } from "./audit.ts";
import { compileWiki, listWikiPages, getWikiPage } from "./wiki/index.ts";
import { RetrievalEngine } from "./retrieval/index.ts";
import { validateStore } from "./schema.ts";
import { exportSnapshot } from "./snapshot.ts";

export interface UiServerOptions {
  port?: number;
  memoryDir: string;
  store: Store;
}

export function startUiServer(opts: UiServerOptions): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    let currentPort = opts.port ?? 2222;

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
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
      const isLocalOrigin = !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || origin === "null";

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

      // API Routes
      if (pathname === "/api/memories" && req.method === "GET") {
        const memories = list(opts.store);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(memories));
        return;
      }

      if (pathname === "/api/stats" && req.method === "GET") {
        const memories = list(opts.store);
        const activeState = WorkspaceGovernor.getActiveState(opts.store, opts.memoryDir);
        const wiki = listWikiPages(opts.memoryDir);
        const trail = getAuditTrail(opts.memoryDir, { limit: 100 });
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
          total: memories.length,
          confirmed: confirmedCount,
          confirmedRatio: memories.length > 0 ? (confirmedCount / memories.length).toFixed(2) : "0.00",
          constraints: activeState.constraints.length,
          wikiPages: wiki.length,
          auditEvents: trail.length,
          links: Math.floor(linksCount / 2),
          typeCounts,
          handoff: activeState.handoff,
        }));
        return;
      }

      if (pathname === "/api/snapshot" && req.method === "GET") {
        const snapshot = exportSnapshot(opts.store);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(snapshot));
        return;
      }

      if (pathname === "/api/validate" && req.method === "GET") {
        const report = validateStore(opts.store);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(report));
        return;
      }

      if (pathname === "/api/current" && req.method === "GET") {
        const state = WorkspaceGovernor.getActiveState(opts.store, opts.memoryDir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ lines: state.constraints, handoff: state.handoff }));
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
        const pageSlug = url.searchParams.get("page");
        if (pageSlug) {
          const page = getWikiPage(opts.memoryDir, pageSlug);
          if (!page) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Wiki page '${pageSlug}' not found` }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(page));
          return;
        }
        const pages = listWikiPages(opts.memoryDir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ pages }));
        return;
      }

      if (pathname === "/api/user-profile" && req.method === "GET") {
        const profile = getUserProfile(opts.memoryDir);
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
        const limit = parseInt(url.searchParams.get("limit") || "50", 10);
        const trail = getAuditTrail(opts.memoryDir, { limit });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ trail }));
        return;
      }

      if (pathname === "/api/search" && req.method === "POST") {
        try {
          const body = await parseJsonBody(req);
          const query = String(body.query || "");
          const tokenBudget = typeof body.tokenBudget === "number" ? body.tokenBudget : undefined;
          const mode = body.mode as any || "auto";
          const resSearch = RetrievalEngine.search(opts.store, opts.memoryDir, query, {
            mode,
            tokenBudget,
            limit: typeof body.limit === "number" ? body.limit : 10,
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

      if (pathname === "/api/export-html" && req.method === "GET") {
        const html = exportStandaloneHtml(opts.store);
        res.setHeader("Content-Disposition", 'attachment; filename="musememory-graph.html"');
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      // Default: Serve Embedded Single-Page Application
      if (pathname === "/" || pathname === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(EMBEDDED_HTML);
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && !opts.port) {
        currentPort++;
        server.listen(currentPort, "127.0.0.1");
      } else {
        reject(err);
      }
    });

    server.listen(currentPort, "127.0.0.1", () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : currentPort;
      resolve({
        port: actualPort,
        close: () => server.close(),
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

const EMBEDDED_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Muse Memory -- Visual Inspector & Cognitive Studio</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #07090e;
      --bg-alt: #0d1117;
      --panel: #111620;
      --panel-hover: #161d2a;
      --panel-border: rgba(255, 255, 255, 0.08);
      --panel-border-glow: rgba(99, 102, 241, 0.35);
      --text: #e2e8f0;
      --text-muted: #8492a6;
      --text-dim: #475569;
      --accent: #6366f1;
      --accent-glow: rgba(99, 102, 241, 0.25);
      --accent-gradient: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
      --green: #10b981;
      --yellow: #f59e0b;
      --red: #ef4444;
      --purple: #a855f7;
      --cyan: #06b6d4;
      --pink: #ec4899;
      --shadow-sm: 0 2px 8px rgba(0,0,0,0.4);
      --shadow-md: 0 8px 24px rgba(0,0,0,0.6);
      --shadow-glow: 0 0 20px rgba(99,102,241,0.2);
      --radius-sm: 6px;
      --radius-md: 10px;
      --radius-lg: 14px;
      --radius-full: 9999px;
      --transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif; }
    code, pre, .mono { font-family: 'JetBrains Mono', monospace; }
    body { background: var(--bg); color: var(--text); height: 100vh; display: flex; flex-direction: column; overflow: hidden; -webkit-font-smoothing: antialiased; }
    
    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: var(--radius-full); }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.22); }
    
    /* Header */
    header { background: rgba(17, 22, 32, 0.85); backdrop-filter: blur(16px); border-bottom: 1px solid var(--panel-border); padding: 10px 20px; display: flex; align-items: center; justify-content: space-between; z-index: 40; }
    .brand-wrap { display: flex; align-items: center; gap: 14px; }
    .brand-logo { width: 32px; height: 32px; border-radius: var(--radius-md); background: var(--accent-gradient); display: flex; align-items: center; justify-content: center; box-shadow: var(--shadow-glow); font-weight: 800; font-size: 16px; color: #fff; }
    .brand-title { font-weight: 700; font-size: 16px; color: #fff; letter-spacing: -0.02em; display: flex; align-items: center; gap: 8px; }
    .brand-tag { font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: var(--radius-full); background: rgba(99,102,241,0.15); color: #818cf8; border: 1px solid rgba(99,102,241,0.25); text-transform: uppercase; letter-spacing: 0.04em; }
    
    /* Navigation Tabs */
    .nav-tabs { display: flex; gap: 4px; background: rgba(0,0,0,0.3); padding: 3px; border-radius: var(--radius-md); border: 1px solid var(--panel-border); }
    .nav-tab { padding: 6px 14px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; color: var(--text-muted); cursor: pointer; transition: var(--transition); display: flex; align-items: center; gap: 6px; border: none; background: transparent; }
    .nav-tab:hover { color: #fff; background: rgba(255,255,255,0.05); }
    .nav-tab.active { color: #fff; background: var(--panel); box-shadow: var(--shadow-sm); border: 1px solid var(--panel-border); }
    
    /* Stats & Quick Actions */
    .header-actions { display: flex; align-items: center; gap: 12px; }
    .status-badge { font-size: 12px; font-weight: 600; background: rgba(16,185,129,0.12); color: var(--green); padding: 5px 12px; border-radius: var(--radius-full); border: 1px solid rgba(16,185,129,0.25); display: flex; align-items: center; gap: 6px; }
    .status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); box-shadow: 0 0 8px var(--green); }
    .btn-icon { background: rgba(255,255,255,0.04); border: 1px solid var(--panel-border); color: var(--text-muted); padding: 6px 12px; border-radius: var(--radius-md); font-size: 12px; font-weight: 600; cursor: pointer; transition: var(--transition); display: inline-flex; align-items: center; gap: 6px; }
    .btn-icon:hover { background: rgba(255,255,255,0.09); color: #fff; border-color: rgba(255,255,255,0.18); }
    .btn-refresh { background: rgba(99, 102, 241, 0.12); border-color: rgba(99, 102, 241, 0.35); color: #a5b4fc; }
    .btn-refresh:hover { background: rgba(99, 102, 241, 0.24); color: #fff; border-color: rgba(99, 102, 241, 0.6); }
    .btn-refresh:disabled { opacity: 0.6; cursor: not-allowed; }
    .refresh-icon.spinning { display: inline-block; animation: spin 0.8s linear infinite; }
    @keyframes spin { 100% { transform: rotate(360deg); } }
    .btn-primary { background: var(--accent-gradient); color: #fff; border: none; padding: 6px 14px; border-radius: var(--radius-md); font-size: 12px; font-weight: 600; cursor: pointer; transition: var(--transition); box-shadow: var(--shadow-glow); }
    .btn-primary:hover { opacity: 0.92; transform: translateY(-1px); }
    
    /* Main Layout */
    .layout { display: flex; flex: 1; overflow: hidden; position: relative; }
    
    /* Sidebar */
    .sidebar { width: 380px; min-width: 340px; background: var(--panel); border-right: 1px solid var(--panel-border); display: flex; flex-direction: column; z-index: 20; }
    .search-box { padding: 12px 16px; border-bottom: 1px solid var(--panel-border); position: relative; }
    .search-input-wrap { position: relative; width: 100%; }
    .search-input-wrap input { width: 100%; background: #090d14; border: 1px solid var(--panel-border); padding: 9px 12px 9px 34px; border-radius: var(--radius-md); color: #fff; outline: none; font-size: 13px; transition: var(--transition); }
    .search-input-wrap input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
    .search-icon { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--text-dim); font-size: 14px; pointer-events: none; }
    
    .filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 16px; border-bottom: 1px solid var(--panel-border); font-size: 12px; background: rgba(0,0,0,0.15); }
    .chip { padding: 4px 10px; background: rgba(255,255,255,0.04); border: 1px solid var(--panel-border); border-radius: var(--radius-full); cursor: pointer; white-space: nowrap; color: var(--text-muted); font-size: 11px; font-weight: 600; transition: var(--transition); }
    .chip:hover { color: #fff; background: rgba(255,255,255,0.08); }
    .chip.active { background: var(--accent); color: #fff; border-color: var(--accent); box-shadow: 0 2px 8px var(--accent-glow); }
    
    .stats-strip { display: flex; justify-content: space-around; padding: 10px 16px; border-bottom: 1px solid var(--panel-border); background: rgba(0,0,0,0.2); font-size: 11px; }
    .stat-item { text-align: center; }
    .stat-val { font-size: 14px; font-weight: 700; color: #fff; }
    .stat-lbl { color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 1px; }
    
    .list { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
    .card { background: rgba(255,255,255,0.025); border: 1px solid var(--panel-border); border-radius: var(--radius-md); padding: 12px 14px; cursor: pointer; transition: var(--transition); position: relative; }
    .card:hover { border-color: rgba(255,255,255,0.18); background: rgba(255,255,255,0.045); transform: translateY(-1px); }
    .card.selected { border-color: var(--accent); background: rgba(99,102,241,0.08); box-shadow: 0 4px 16px rgba(99,102,241,0.15); }
    .card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; gap: 8px; }
    .card-title { font-size: 13px; font-weight: 600; color: #f1f5f9; flex: 1; line-height: 1.35; }
    .card-type { font-size: 10px; padding: 2px 7px; border-radius: var(--radius-full); font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; }
    
    .type-fix { background: rgba(16,185,129,0.15); color: var(--green); border: 1px solid rgba(16,185,129,0.25); }
    .type-decision { background: rgba(99,102,241,0.15); color: #818cf8; border: 1px solid rgba(99,102,241,0.25); }
    .type-constraint { background: rgba(239,68,68,0.15); color: var(--red); border: 1px solid rgba(239,68,68,0.25); }
    .type-failure { background: rgba(245,158,11,0.15); color: var(--yellow); border: 1px solid rgba(245,158,11,0.25); }
    .type-architecture { background: rgba(168,85,247,0.15); color: var(--purple); border: 1px solid rgba(168,85,247,0.25); }
    .type-operation { background: rgba(6,182,212,0.15); color: var(--cyan); border: 1px solid rgba(6,182,212,0.25); }
    .type-preference { background: rgba(236,72,153,0.15); color: var(--pink); border: 1px solid rgba(236,72,153,0.25); }
    .type-discovery { background: rgba(148,163,184,0.15); color: #94a3b8; border: 1px solid rgba(148,163,184,0.25); }
    .type-session { background: rgba(100,116,139,0.15); color: #94a3b8; border: 1px solid rgba(100,116,139,0.25); }
    
    .card-snippet { font-size: 12px; color: var(--text-muted); line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .card-meta { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; font-size: 11px; color: var(--text-dim); }
    .card-tags { display: flex; gap: 4px; flex-wrap: wrap; }
    .card-tag { font-size: 10px; background: rgba(255,255,255,0.03); padding: 1px 5px; border-radius: 3px; }
    
    /* View Panels */
    .view-panel { flex: 1; display: none; flex-direction: column; overflow: hidden; position: relative; }
    .view-panel.active { display: flex; }
    
    /* Graph View */
    .graph-controls { background: rgba(17, 22, 32, 0.7); backdrop-filter: blur(12px); border-bottom: 1px solid var(--panel-border); padding: 10px 18px; display: flex; flex-direction: column; gap: 8px; z-index: 10; }
    .control-row { display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--text-muted); flex-wrap: wrap; }
    .control-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); }
    #timelineSlider { flex: 1; max-width: 320px; accent-color: var(--accent); }
    .cluster-check { display: inline-flex; align-items: center; gap: 5px; background: rgba(255,255,255,0.03); border: 1px solid var(--panel-border); border-radius: var(--radius-sm); padding: 3px 8px; cursor: pointer; user-select: none; font-size: 11px; font-weight: 500; transition: var(--transition); }
    .cluster-check:hover { background: rgba(255,255,255,0.07); }
    .cluster-check input { accent-color: var(--accent); cursor: pointer; }
    .graph-container { flex: 1; position: relative; background: radial-gradient(circle at center, #0f172a 0%, #07090e 100%); }
    canvas { width: 100%; height: 100%; display: block; }
    
    .graph-hud { position: absolute; bottom: 16px; left: 16px; background: rgba(17, 22, 32, 0.85); backdrop-filter: blur(10px); border: 1px solid var(--panel-border); padding: 8px 14px; border-radius: var(--radius-md); font-size: 11px; color: var(--text-muted); pointer-events: none; }
    .graph-hud-key { display: inline-block; background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 3px; font-weight: 600; color: #fff; margin-right: 4px; }
    
    /* Detail Drawer */
    .detail-pane { width: 440px; min-width: 360px; background: var(--panel); border-left: 1px solid var(--panel-border); padding: 24px; overflow-y: auto; display: none; z-index: 30; }
    .detail-pane.open { display: block; }
    .detail-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 12px; }
    .detail-title { font-size: 17px; font-weight: 700; color: #fff; line-height: 1.35; }
    .close-btn { background: transparent; border: none; color: var(--text-dim); font-size: 18px; cursor: pointer; padding: 4px; border-radius: var(--radius-sm); }
    .close-btn:hover { color: #fff; background: rgba(255,255,255,0.08); }
    
    .meta-row { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; font-size: 11px; }
    .meta-tag { background: rgba(255,255,255,0.04); border: 1px solid var(--panel-border); padding: 3px 8px; border-radius: var(--radius-sm); color: var(--text-muted); }
    .content-box { background: #090d14; border: 1px solid var(--panel-border); padding: 14px; border-radius: var(--radius-md); font-size: 13px; line-height: 1.6; white-space: pre-wrap; margin-bottom: 20px; color: #e2e8f0; }
    
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn { padding: 7px 14px; border-radius: var(--radius-md); font-size: 12px; font-weight: 600; cursor: pointer; border: 1px solid var(--panel-border); outline: none; transition: var(--transition); }
    .btn-green { background: rgba(16,185,129,0.15); color: var(--green); border-color: rgba(16,185,129,0.3); }
    .btn-green:hover { background: var(--green); color: #fff; }
    .btn-yellow { background: rgba(245,158,11,0.15); color: var(--yellow); border-color: rgba(245,158,11,0.3); }
    .btn-yellow:hover { background: var(--yellow); color: #fff; }
    .btn-red { background: rgba(239,68,68,0.15); color: var(--red); border-color: rgba(239,68,68,0.3); }
    .btn-red:hover { background: var(--red); color: #fff; }
    
    /* Content Views (Wiki, Constraints, Persona, Retrieval, Audit) */
    .content-view-wrap { padding: 24px 32px; overflow-y: auto; height: 100%; display: flex; flex-direction: column; gap: 24px; max-width: 1100px; margin: 0 auto; width: 100%; }
    .view-card { background: var(--panel); border: 1px solid var(--panel-border); border-radius: var(--radius-lg); padding: 20px 24px; box-shadow: var(--shadow-md); }
    .card-title-lg { font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; }
    
    /* Handoff banner */
    .handoff-box { background: linear-gradient(135deg, rgba(99,102,241,0.1) 0%, rgba(168,85,247,0.05) 100%); border: 1px solid var(--panel-border-glow); border-radius: var(--radius-lg); padding: 18px 22px; }
    .handoff-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-top: 12px; }
    .handoff-cell { font-size: 12px; }
    .handoff-lbl { font-weight: 700; color: var(--text-dim); text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; margin-bottom: 2px; }
    .handoff-val { color: #f1f5f9; font-weight: 600; }
    
    /* Constraints list */
    .constraint-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: rgba(0,0,0,0.25); border: 1px solid var(--panel-border); border-radius: var(--radius-md); margin-bottom: 8px; font-size: 13px; font-family: 'JetBrains Mono', monospace; }
    
    /* Archetype cards */
    .archetype-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .archetype-card { background: rgba(255,255,255,0.02); border: 1px solid var(--panel-border); border-radius: var(--radius-md); padding: 14px; cursor: pointer; transition: var(--transition); text-align: center; }
    .archetype-card:hover { border-color: var(--accent); background: rgba(99,102,241,0.05); transform: translateY(-2px); }
    .archetype-card.active { border-color: var(--accent); background: rgba(99,102,241,0.12); box-shadow: 0 0 16px var(--accent-glow); }
    .archetype-icon { font-size: 24px; margin-bottom: 8px; }
    .archetype-title { font-weight: 700; font-size: 13px; color: #fff; text-transform: capitalize; }
    
    /* Retrieval Sandbox */
    .sandbox-input-grid { display: grid; grid-template-columns: 1fr auto; gap: 12px; margin-bottom: 16px; }
    .code-preview { background: #080c14; border: 1px solid var(--panel-border); border-radius: var(--radius-md); padding: 16px; font-size: 12px; font-family: 'JetBrains Mono', monospace; color: #a5b4fc; max-height: 380px; overflow-y: auto; white-space: pre-wrap; line-height: 1.5; }
    
    /* Audit Table */
    .audit-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .audit-table th { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--panel-border); color: var(--text-dim); font-size: 11px; text-transform: uppercase; }
    .audit-table td { padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.03); color: var(--text-muted); }
    .audit-table tr:hover td { background: rgba(255,255,255,0.02); color: #fff; }
    .op-badge { padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
  </style>
</head>
<body>
  <header>
    <div class="brand-wrap">
      <div class="brand-logo">M</div>
      <div class="brand-title">
        Muse Memory
        <span class="brand-tag">Visual Inspector & Studio</span>
      </div>
    </div>
    
    <div class="nav-tabs">
      <button class="nav-tab active" data-view="graph">🌐 Graph</button>
      <button class="nav-tab" data-view="current">⚡ Invariants & Handoff</button>
      <button class="nav-tab" data-view="wiki">📚 Wiki</button>
      <button class="nav-tab" data-view="persona">👤 Persona</button>
      <button class="nav-tab" data-view="sandbox">🔍 Retrieval Sandbox</button>
      <button class="nav-tab" data-view="audit">📜 Audit</button>
    </div>
    
    <div class="header-actions">
      <button class="btn-icon btn-refresh" id="refreshBtn" onclick="refreshMemories()" title="Refresh and sync active constraints, handoff state, and prior memories">
        <span class="refresh-icon" id="refreshIcon">🔄</span>
        <span id="refreshLabel">Refresh</span>
      </button>
      <div class="status-badge"><div class="status-dot"></div>[LIVE] Active</div>
      <button class="btn-icon" onclick="exportDataHtml()">⬇ Export HTML</button>
    </div>
  </header>
  
  <div class="layout">
    <!-- Sidebar List -->
    <div class="sidebar">
      <div class="search-box">
        <div class="search-input-wrap">
          <span class="search-icon">🔍</span>
          <input type="text" id="searchInput" placeholder="Search memories (Cmd+K / '/')..." />
        </div>
      </div>
      <div class="filters" id="filterBar">
        <div class="chip active" data-type="all">All</div>
        <div class="chip" data-type="fix">Fixes</div>
        <div class="chip" data-type="decision">Decisions</div>
        <div class="chip" data-type="constraint">Constraints</div>
        <div class="chip" data-type="failure">Failures</div>
        <div class="chip" data-type="architecture">Architecture</div>
        <div class="chip" data-type="operation">Operations</div>
      </div>
      <div class="stats-strip" id="statsStrip">
        <div class="stat-item"><div class="stat-val" id="statTotal">0</div><div class="stat-lbl">Memories</div></div>
        <div class="stat-item"><div class="stat-val" id="statConfirmed">0%</div><div class="stat-lbl">Confirmed</div></div>
        <div class="stat-item"><div class="stat-val" id="statConstraints">0</div><div class="stat-lbl">Constraints</div></div>
        <div class="stat-item"><div class="stat-val" id="statLinks">0</div><div class="stat-lbl">Links</div></div>
      </div>
      <div class="list" id="memoryList"></div>
    </div>
    
    <!-- View 1: 3D Force Graph -->
    <div class="view-panel active" id="panel-graph">
      <div class="graph-controls" id="graphControls">
        <div class="control-row">
          <span class="control-label">Timeline</span>
          <input type="range" id="timelineSlider" min="0" max="1000" value="1000" />
          <span class="control-label" id="timelineLabel">all</span>
        </div>
        <div class="control-row" id="clusterFilters"><span class="control-label">Clusters</span></div>
      </div>
      <div class="graph-container">
        <canvas id="graphCanvas"></canvas>
        <div class="graph-hud">
          <span class="graph-hud-key">Drag</span> Rotate 3D &bull;
          <span class="graph-hud-key">Scroll</span> Zoom &bull;
          <span class="graph-hud-key">Click</span> Inspect
        </div>
      </div>
    </div>

    <!-- View 2: Active Constraints & Session Handoff -->
    <div class="view-panel" id="panel-current">
      <div class="content-view-wrap">
        <div class="handoff-box">
          <div class="card-title-lg">
            <span>⚡ In-Flight Session State & Handoff</span>
            <span class="brand-tag" id="handoffStatus">[IDLE]</span>
          </div>
          <div class="handoff-grid">
            <div class="handoff-cell"><div class="handoff-lbl">Active Agent</div><div class="handoff-val" id="handoffAgent">None</div></div>
            <div class="handoff-cell"><div class="handoff-lbl">Session ID</div><div class="handoff-val mono" id="handoffSessionId">--</div></div>
            <div class="handoff-cell"><div class="handoff-lbl">Last Updated</div><div class="handoff-val" id="handoffUpdated">--</div></div>
            <div class="handoff-cell"><div class="handoff-lbl">Active Task</div><div class="handoff-val" id="handoffTask">No active task</div></div>
          </div>
          <div style="margin-top:14px;" id="handoffProgressBox"></div>
        </div>

        <div class="view-card">
          <div class="card-title-lg">
            <span>🛡️ Active Working Invariants & Hard Constraints</span>
            <button class="btn-primary" onclick="quickAddConstraint()">+ Add Constraint</button>
          </div>
          <div id="constraintsList" style="display:flex; flex-direction:column; gap:8px;"></div>
        </div>
      </div>
    </div>

    <!-- View 3: Obsidian Knowledge Wiki -->
    <div class="view-panel" id="panel-wiki">
      <div class="content-view-wrap">
        <div class="view-card">
          <div class="card-title-lg">
            <span>📚 Compiled Knowledge Wiki Pages</span>
            <span class="brand-tag" id="wikiCountBadge">0 Pages</span>
          </div>
          <div id="wikiPagesGrid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:12px;"></div>
        </div>
        <div class="view-card" id="wikiViewerCard" style="display:none;">
          <div class="card-title-lg" id="wikiPageTitle">Wiki Page</div>
          <div class="content-box" id="wikiPageContent"></div>
        </div>
      </div>
    </div>

    <!-- View 4: Persona Studio -->
    <div class="view-panel" id="panel-persona">
      <div class="content-view-wrap">
        <div class="view-card">
          <div class="card-title-lg">👤 Persona & Working Preference Studio (USER.md)</div>
          <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px;">
            Switch active agent archetypes to steer communication tone, coding depth, and design rules across all connected platforms.
          </p>
          <div class="archetype-grid" id="archetypeGrid">
            <div class="archetype-card" data-arch="developer"><div class="archetype-icon">💻</div><div class="archetype-title">Developer</div></div>
            <div class="archetype-card" data-arch="designer"><div class="archetype-icon">🎨</div><div class="archetype-title">Designer</div></div>
            <div class="archetype-card" data-arch="marketer"><div class="archetype-icon">🚀</div><div class="archetype-title">Marketer</div></div>
            <div class="archetype-card" data-arch="casual"><div class="archetype-icon">☕</div><div class="archetype-title">Casual</div></div>
            <div class="archetype-card" data-arch="custom"><div class="archetype-icon">⚙️</div><div class="archetype-title">Custom</div></div>
          </div>
          <div style="margin-top:20px;">
            <div class="card-title-lg">Active USER.md Instructions</div>
            <textarea id="userProfileText" style="width:100%; height:200px; background:#080c14; border:1px solid var(--panel-border); border-radius:var(--radius-md); color:#fff; padding:12px; font-family:'JetBrains Mono', monospace; font-size:12px; line-height:1.5; outline:none;"></textarea>
            <button class="btn-primary" style="margin-top:10px;" onclick="saveUserProfile()">Save Preferences</button>
          </div>
        </div>
      </div>
    </div>

    <!-- View 5: Knapsack Retrieval Sandbox -->
    <div class="view-panel" id="panel-sandbox">
      <div class="content-view-wrap">
        <div class="view-card">
          <div class="card-title-lg">🔍 Real-Time Knapsack Retrieval Sandbox</div>
          <div class="sandbox-input-grid">
            <input type="text" id="sandboxQuery" placeholder="Enter query (e.g., 'auth token refresh invariant', 'cors headers')..." style="background:#080c14; border:1px solid var(--panel-border); border-radius:var(--radius-md); padding:10px 14px; color:#fff; font-size:13px; outline:none;" />
            <button class="btn-primary" onclick="testRetrieval()">Simulate Prompt Context</button>
          </div>
          <div class="control-row" style="margin-bottom:16px;">
            <span class="control-label">Token Budget:</span>
            <input type="range" id="sandboxBudgetSlider" min="500" max="6000" step="250" value="2000" oninput="document.getElementById('sandboxBudgetVal').textContent = this.value + ' tokens'" />
            <span class="control-label mono" id="sandboxBudgetVal">2000 tokens</span>
          </div>
          <div class="card-title-lg" style="margin-top:16px;">
            <span>Simulated Prompt Context Injection</span>
            <button class="btn-icon" onclick="navigator.clipboard.writeText(document.getElementById('promptContextOut').textContent); flash('Copied prompt context!');">📋 Copy</button>
          </div>
          <div class="code-preview" id="promptContextOut">// Enter a query above and click simulate to inspect the rendered context...</div>
        </div>
      </div>
    </div>

    <!-- View 6: Audit Ledger -->
    <div class="view-panel" id="panel-audit">
      <div class="content-view-wrap">
        <div class="view-card">
          <div class="card-title-lg">
            <span>📜 Append-Only Compliance Audit Trail</span>
            <button class="btn-icon" onclick="loadAudit()">🔄 Refresh</button>
          </div>
          <table class="audit-table">
            <thead>
              <tr><th>Timestamp</th><th>Operation</th><th>Entry ID</th><th>Actor</th><th>Details</th></tr>
            </thead>
            <tbody id="auditTableBody"></tbody>
          </table>
        </div>
      </div>
    </div>
    
    <!-- Detail Pane -->
    <div class="detail-pane" id="detailPane">
      <div class="detail-header">
        <div class="detail-title" id="dTitle">Select a memory</div>
        <button class="close-btn" onclick="document.getElementById('detailPane').classList.remove('open')">✕</button>
      </div>
      <div class="meta-row" id="dMeta"></div>
      <div class="content-box" id="dContent"></div>
      <div class="actions" id="dActions"></div>
    </div>
  </div>

  <script>
    let allMemories = [];
    let selectedMemory = null;
    let currentFilter = 'all';
    let searchQuery = '';
    let currentTab = 'graph';

    // ---- Graph state (3D force-directed) ----
    const TYPE_COLORS = {
      fix: '#10b981',
      decision: '#818cf8',
      constraint: '#ef4444',
      failure: '#f59e0b',
      architecture: '#a855f7',
      operation: '#06b6d4',
      preference: '#ec4899',
      discovery: '#94a3b8',
      session: '#64748b'
    };
    let nodes3d = [];
    let edges3d = [];
    let rotX = 0.35, rotY = 0, zoom = 1.4;
    let dragging = false, dragMoved = false, lastX = 0, lastY = 0;
    let hiddenClusters = new Set();
    let timelineCutoff = null;
    let simAlpha = 1;
    let graphLoopStarted = false;

    async function refreshMemories() {
      const icon = document.getElementById('refreshIcon');
      const label = document.getElementById('refreshLabel');
      const btn = document.getElementById('refreshBtn');
      if (icon) icon.classList.add('spinning');
      if (label) label.textContent = 'Syncing...';
      if (btn) btn.disabled = true;

      try {
        const res = await fetch('/api/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ harvest: true }),
        });
        const info = await res.json();
        await loadData();
        const memCount = info.totalMemories ?? allMemories.length;
        const msg = info.harvestedCount > 0
          ? '✓ Refreshed! Synced ' + info.harvestedCount + ' new + ' + memCount + ' total memories & active state.'
          : '✓ Refreshed! Loaded ' + memCount + ' memories & active state.';
        flash(msg);
      } catch (err) {
        flash('Refresh failed: ' + (err && err.message ? err.message : String(err)), true);
      } finally {
        if (icon) icon.classList.remove('spinning');
        if (label) label.textContent = 'Refresh';
        if (btn) btn.disabled = false;
      }
    }

    async function loadData() {
      try {
        if (window.STANDALONE_DATA) {
          allMemories = window.STANDALONE_DATA;
        } else {
          const [memRes] = await Promise.all([
            fetch('/api/memories'),
            fetchStats(),
            fetchCurrentState(),
            fetchWikiPages(),
            fetchUserProfile(),
            loadAudit(),
          ]);
          allMemories = await memRes.json();
        }
        renderList();
        initGraph();
        buildClusterFilters();
        if (!graphLoopStarted) { graphLoopStarted = true; requestAnimationFrame(tick); }
      } catch (err) {
        console.error('Failed to load memories:', err);
      }
    }

    async function fetchStats() {
      try {
        const res = await fetch('/api/stats');
        const s = await res.json();
        document.getElementById('statTotal').textContent = s.total || 0;
        document.getElementById('statConfirmed').textContent = Math.round((parseFloat(s.confirmedRatio) || 0) * 100) + '%';
        document.getElementById('statConstraints').textContent = s.constraints || 0;
        document.getElementById('statLinks').textContent = s.links || 0;
      } catch {}
    }

    async function fetchCurrentState() {
      try {
        const res = await fetch('/api/current');
        const data = await res.json();
        const h = data.handoff;
        if (h) {
          document.getElementById('handoffStatus').textContent = '[' + (h.status || 'IN-PROGRESS') + ']';
          document.getElementById('handoffAgent').textContent = h.agent || 'Unknown';
          document.getElementById('handoffSessionId').textContent = h.sessionId || '--';
          document.getElementById('handoffUpdated').textContent = h.lastUpdated ? new Date(h.lastUpdated).toLocaleTimeString() : '--';
          document.getElementById('handoffTask').textContent = h.task || 'No active task';
          
          let progHtml = '';
          if (h.progress && h.progress.length > 0) {
            progHtml += '<div style="font-weight:700; font-size:11px; color:var(--text-dim); margin-bottom:4px;">PROGRESS CHECKPOINTS:</div>';
            h.progress.forEach(p => { progHtml += '<div style="font-size:12px; color:var(--text); margin-bottom:2px;">• ' + p + '</div>'; });
          }
          document.getElementById('handoffProgressBox').innerHTML = progHtml;
        }
        const cList = document.getElementById('constraintsList');
        cList.innerHTML = '';
        if (data.lines && data.lines.length > 0) {
          data.lines.forEach(c => {
            const row = document.createElement('div');
            row.className = 'constraint-row';
            row.textContent = c;
            cList.appendChild(row);
          });
        } else {
          cList.innerHTML = '<div style="font-size:12px; color:var(--text-dim); padding:8px;">No active constraints registered.</div>';
        }
      } catch {}
    }

    async function fetchWikiPages() {
      try {
        const res = await fetch('/api/wiki');
        const data = await res.json();
        const grid = document.getElementById('wikiPagesGrid');
        grid.innerHTML = '';
        document.getElementById('wikiCountBadge').textContent = (data.pages?.length || 0) + ' Pages';
        (data.pages || []).forEach(p => {
          const card = document.createElement('div');
          card.className = 'archetype-card';
          card.style.textAlign = 'left';
          card.innerHTML = '<div style="font-weight:700; color:#fff; font-size:14px; margin-bottom:4px;">📖 ' + p.title + '</div><div style="font-size:11px; color:var(--text-dim);">' + p.slug + '</div>';
          card.onclick = async () => {
            const pageRes = await fetch('/api/wiki?page=' + encodeURIComponent(p.slug));
            const pageData = await pageRes.json();
            document.getElementById('wikiViewerCard').style.display = 'block';
            document.getElementById('wikiPageTitle').textContent = '📖 ' + pageData.title;
            document.getElementById('wikiPageContent').textContent = pageData.content;
          };
          grid.appendChild(card);
        });
      } catch {}
    }

    async function fetchUserProfile() {
      try {
        const res = await fetch('/api/user-profile');
        const data = await res.json();
        if (data.profile) {
          document.getElementById('userProfileText').value = data.profile.raw || '';
          document.querySelectorAll('.archetype-card').forEach(c => {
            if (c.dataset.arch === data.profile.archetype) c.classList.add('active');
            else c.classList.remove('active');
          });
        }
      } catch {}
    }

    async function saveUserProfile() {
      const content = document.getElementById('userProfileText').value;
      await fetch('/api/user-profile', { method: 'POST', body: JSON.stringify({ content }), headers: { 'Content-Type': 'application/json' } });
      flash('User profile saved successfully!');
    }

    async function loadAudit() {
      try {
        const res = await fetch('/api/audit');
        const data = await res.json();
        const tbody = document.getElementById('auditTableBody');
        tbody.innerHTML = '';
        (data.trail || []).slice(0, 30).forEach(r => {
          const tr = document.createElement('tr');
          const opColor = r.operation === 'confirm' ? 'var(--green)' : r.operation === 'delete' ? 'var(--red)' : 'var(--accent)';
          tr.innerHTML = \`
            <td class="mono" style="font-size:11px;">\${new Date(r.timestamp).toLocaleTimeString()}</td>
            <td><span class="op-badge" style="background:rgba(255,255,255,0.06); color:\${opColor};">\${r.operation}</span></td>
            <td class="mono">\${r.entry_id}</td>
            <td>\${r.actor || 'system'}</td>
            <td style="max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">\${JSON.stringify(r.details || r.reason || '')}</td>
          \`;
          tbody.appendChild(tr);
        });
      } catch {}
    }

    async function testRetrieval() {
      const query = document.getElementById('sandboxQuery').value;
      const budget = parseInt(document.getElementById('sandboxBudgetSlider').value, 10);
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, tokenBudget: budget })
      });
      const data = await res.json();
      document.getElementById('promptContextOut').textContent = data.promptContext?.formatted || JSON.stringify(data, null, 2);
    }

    async function quickAddConstraint() {
      const text = prompt('Enter constraint rule to enforce:');
      if (!text) return;
      await fetch('/api/current', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      fetchCurrentState();
      flash('Constraint added!');
    }

    function renderList() {
      const container = document.getElementById('memoryList');
      container.innerHTML = '';

      const filtered = allMemories.filter(m => {
        if (currentFilter !== 'all' && m.type !== currentFilter) return false;
        if (searchQuery) {
          const text = (m.title + ' ' + m.content + ' ' + (m.tags || []).join(' ')).toLowerCase();
          if (!text.includes(searchQuery.toLowerCase())) return false;
        }
        return true;
      });

      filtered.forEach(m => {
        const card = document.createElement('div');
        card.className = 'card' + (selectedMemory && selectedMemory.id === m.id ? ' selected' : '');
        card.innerHTML = \`
          <div class="card-header">
            <div class="card-title">\${m.title}</div>
            <div class="card-type type-\${m.type || 'discovery'}">\${m.type || 'discovery'}</div>
          </div>
          <div class="card-snippet">\${m.content}</div>
          <div class="card-meta">
            <span class="mono">\${m.id}</span>
            <div class="card-tags">\${(m.tags || []).slice(0, 3).map(t => '<span class="card-tag">#' + t + '</span>').join('')}</div>
          </div>
        \`;
        card.onclick = () => selectMemory(m);
        container.appendChild(card);
      });
    }

    function selectMemory(m) {
      selectedMemory = m;
      renderList();
      const pane = document.getElementById('detailPane');
      pane.classList.add('open');
      document.getElementById('dTitle').textContent = m.title;

      const meta = document.getElementById('dMeta');
      meta.innerHTML = \`
        <span class="meta-tag mono">ID: \${m.id}</span>
        <span class="meta-tag">Status: \${m.status}</span>
        <span class="meta-tag">Salience: \${m.salience || 0.5}</span>
        <span class="meta-tag">Verification: \${m.verification ? m.verification.level : 'unverified'}</span>
        <span class="meta-tag">Links: \${(m.related_memory_ids || []).length}</span>
      \`;

      document.getElementById('dContent').textContent = m.content;

      const actions = document.getElementById('dActions');
      actions.innerHTML = '';
      if (m.status !== 'confirmed') {
        const cBtn = document.createElement('button');
        cBtn.className = 'btn btn-green';
        cBtn.textContent = 'Confirm Memory';
        cBtn.onclick = () => confirmMem(m.id);
        actions.appendChild(cBtn);
      }
      if (m.status === 'active' || m.status === 'confirmed') {
        const sBtn = document.createElement('button');
        sBtn.className = 'btn btn-yellow';
        sBtn.textContent = 'Mark Stale';
        sBtn.onclick = () => staleMem(m.id);
        actions.appendChild(sBtn);
      }
      const dBtn = document.createElement('button');
      dBtn.className = 'btn btn-red';
      dBtn.textContent = 'Delete';
      dBtn.onclick = async () => {
        if (confirm('Delete memory ' + m.id + '?')) {
          await fetch('/api/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: m.id }) });
          loadData();
          pane.classList.remove('open');
          flash('Deleted memory ' + m.id);
        }
      };
      actions.appendChild(dBtn);
    }

    async function confirmMem(id) {
      return mutateMemory(id, '/api/confirm');
    }

    async function staleMem(id) {
      return mutateMemory(id, '/api/mark-stale');
    }

    function flash(msg, isError) {
      let el = document.getElementById('flashMsg');
      if (!el) {
        el = document.createElement('div');
        el.id = 'flashMsg';
        el.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:12px 18px;border-radius:10px;font-size:13px;font-weight:600;z-index:999;max-width:380px;display:none;box-shadow:0 8px 30px rgba(0,0,0,0.6);backdrop-filter:blur(10px);';
        document.body.appendChild(el);
      }
      el.style.background = isError ? 'rgba(239,68,68,0.95)' : 'rgba(16,185,129,0.95)';
      el.style.color = '#fff';
      el.textContent = msg;
      el.style.display = 'block';
      clearTimeout(el._t);
      el._t = setTimeout(() => { el.style.display = 'none'; }, 3500);
    }

    async function mutateMemory(id, endpoint) {
      try {
        const body = endpoint === '/api/mark-stale' ? { id, reason: 'Marked via Web UI' } : { id };
        const res = await fetch(endpoint, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
        if (!res.ok) {
          let msg = \`HTTP \${res.status}\`;
          try { msg = (await res.json()).error || msg; } catch {}
          throw new Error(msg);
        }
        await loadData();
        const updated = allMemories.find(m => m.id === id);
        if (updated) selectMemory(updated);
        flash(endpoint === '/api/mark-stale' ? 'Marked stale' : 'Confirmed');
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        flash('Action failed: ' + msg, true);
      }
    }

    function nodeVisible(n) {
      if (hiddenClusters.has('project:' + (n.project || 'none'))) return false;
      if (hiddenClusters.has('type:' + n.type)) return false;
      if (timelineCutoff && n.updatedAt < timelineCutoff) return false;
      if (currentFilter !== 'all' && n.type !== currentFilter) return false;
      if (searchQuery) {
        const text = (n.title + ' ' + (n.content || '') + ' ' + (n.tags || []).join(' ')).toLowerCase();
        if (!text.includes(searchQuery.toLowerCase())) return false;
      }
      return true;
    }

    function initGraph() {
      const byId = new Map(nodes3d.map(n => [n.id, n]));
      const degreeOf = new Map();
      edges3d = [];
      for (const m of allMemories) {
        for (const rid of (m.related_memory_ids || [])) {
          edges3d.push([m.id, rid]);
          degreeOf.set(m.id, (degreeOf.get(m.id) || 0) + 1);
        }
      }
      nodes3d = allMemories.map((m, i) => {
        const prev = byId.get(m.id);
        const angle = (i / Math.max(1, allMemories.length)) * Math.PI * 2;
        return {
          id: m.id,
          title: m.title,
          type: m.type || 'discovery',
          status: m.status,
          project: m.project,
          content: m.content || '',
          tags: m.tags || [],
          updatedAt: m.updated_at || '',
          degree: degreeOf.get(m.id) || 0,
          x: prev ? prev.x : Math.cos(angle) * 260,
          y: prev ? prev.y : (Math.random() - 0.5) * 90,
          z: prev ? prev.z : Math.sin(angle) * 260,
        };
      });
      simAlpha = 1;
    }

    function simulateStep() {
      if (nodes3d.length === 0 || simAlpha <= 0.04) return;
      const alpha = simAlpha;
      const nodeMap = new Map(nodes3d.map(n => [n.id, n]));
      for (let i = 0; i < nodes3d.length; i++) {
        const a = nodes3d[i];
        for (let j = i + 1; j < nodes3d.length; j++) {
          const b = nodes3d[j];
          let dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
          let dist2 = dx * dx + dy * dy + dz * dz + 0.01;
          const force = (2400 * alpha) / dist2;
          const dist = Math.sqrt(dist2);
          dx /= dist; dy /= dist; dz /= dist;
          a.x += dx * force; a.y += dy * force; a.z += dz * force;
          b.x -= dx * force; b.y -= dy * force; b.z -= dz * force;
        }
      }
      for (const [fromId, toId] of edges3d) {
        const a = nodeMap.get(fromId);
        const b = nodeMap.get(toId);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const target = 120;
        const force = ((dist - target) / dist) * 0.02 * alpha;
        a.x += dx * force; a.y += dy * force; a.z += dz * force;
        b.x -= dx * force; b.y -= dy * force; b.z -= dz * force;
      }
      for (const n of nodes3d) {
        n.x *= (1 - 0.002 * alpha);
        n.y *= (1 - 0.002 * alpha);
        n.z *= (1 - 0.002 * alpha);
      }
      simAlpha = Math.max(0.03, simAlpha * 0.985);
    }

    function project(x, y, z, width, height) {
      const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
      let x1 = x * cosY - z * sinY;
      let z1 = x * sinY + z * cosY;
      const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
      let y1 = y * cosX - z1 * sinX;
      let z2 = y * sinX + z1 * cosX;
      const fov = 600;
      const scale = (fov / (fov + z2 + 400)) * zoom;
      return { sx: width / 2 + x1 * scale, sy: height / 2 + y1 * scale, scale };
    }

    function drawGraph(canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!nodes3d.length) {
        ctx.fillStyle = '#8b949e';
        ctx.font = '14px sans-serif';
        ctx.fillText('No memories yet — capture some first.', canvas.width / 2 - 110, canvas.height / 2);
        return;
      }

      const projected = new Map();
      for (const n of nodes3d) {
        n.visible = nodeVisible(n);
        if (n.visible) projected.set(n, project(n.x, n.y, n.z, canvas.width, canvas.height));
      }

      // Edges with glow
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.25)';
      ctx.lineWidth = 1.2;
      for (const [fromId, toId] of edges3d) {
        const a = nodes3d.find(n => n.id === fromId);
        const b = nodes3d.find(n => n.id === toId);
        if (!a || !b || !a.visible || !b.visible) continue;
        const pa = projected.get(a), pb = projected.get(b);
        if (!pa || !pb) continue;
        ctx.beginPath();
        ctx.moveTo(pa.sx, pa.sy);
        ctx.lineTo(pb.sx, pb.sy);
        ctx.stroke();
      }

      // Nodes
      for (const n of nodes3d) {
        if (!n.visible) continue;
        const p = projected.get(n);
        if (!p) continue;
        const radius = (6 + Math.min(10, n.degree * 2)) * p.scale;
        
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, radius, 0, Math.PI * 2);
        ctx.fillStyle = TYPE_COLORS[n.type] || '#8b949e';
        ctx.globalAlpha = n.status === 'stale' || n.status === 'superseded' ? 0.35 : 1;
        ctx.fill();
        ctx.strokeStyle = selectedMemory && selectedMemory.id === n.id ? '#ffffff' : '#090d14';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.globalAlpha = 1;

        if (nodes3d.length <= 40 || zoom > 1.4) {
          ctx.fillStyle = '#cbd5e1';
          ctx.font = '500 11px Plus Jakarta Sans, sans-serif';
          ctx.fillText(n.title.slice(0, 26), p.sx + radius + 6, p.sy + 4);
        }
      }
    }

    function tick() {
      const canvas = document.getElementById('graphCanvas');
      if (canvas && currentTab === 'graph') {
        const rect = canvas.parentElement.getBoundingClientRect();
        if (rect.width > 0 && (canvas.width !== Math.floor(rect.width) || canvas.height !== Math.floor(rect.height))) {
          canvas.width = Math.floor(rect.width);
          canvas.height = Math.floor(rect.height);
        }
        simulateStep();
        drawGraph(canvas);
      }
      requestAnimationFrame(tick);
    }

    function buildClusterFilters() {
      const container = document.getElementById('clusterFilters');
      container.querySelectorAll('.cluster-check').forEach(el => el.remove());
      const projects = [...new Set(allMemories.map(m => m.project || 'none'))];
      const types = [...new Set(allMemories.map(m => m.type || 'discovery'))];
      const makeCheck = (group, value) => {
        const label = document.createElement('label');
        label.className = 'cluster-check';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = !hiddenClusters.has(group + ':' + value);
        box.onchange = () => {
          if (box.checked) hiddenClusters.delete(group + ':' + value);
          else hiddenClusters.add(group + ':' + value);
        };
        label.appendChild(box);
        label.appendChild(document.createTextNode(value));
        container.appendChild(label);
      };
      projects.forEach(p => makeCheck('project', p));
      types.forEach(t => makeCheck('type', t));
    }

    function setupTimeline() {
      const slider = document.getElementById('timelineSlider');
      const label = document.getElementById('timelineLabel');
      const times = allMemories.map(m => Date.parse(m.updated_at || '')).filter(t => !Number.isNaN(t));
      if (times.length === 0) { slider.disabled = true; label.textContent = 'n/a'; return; }
      slider.disabled = false;
      const min = Math.min(...times), max = Math.max(...times);
      slider.oninput = () => {
        const t = parseInt(slider.value, 10) / 1000;
        if (t >= 1) { timelineCutoff = null; label.textContent = 'all'; }
        else {
          const cutoffMs = min + (max - min) * t;
          timelineCutoff = new Date(cutoffMs).toISOString();
          label.textContent = new Date(cutoffMs).toLocaleDateString();
        }
      };
    }

    function setupCanvasInteractions() {
      const canvas = document.getElementById('graphCanvas');
      canvas.addEventListener('mousedown', (e) => { dragging = true; dragMoved = false; lastX = e.clientX; lastY = e.clientY; });
      window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved = true;
        rotY += dx * 0.005;
        rotX = Math.max(-1.4, Math.min(1.4, rotX + dy * 0.005));
        lastX = e.clientX; lastY = e.clientY;
      });
      window.addEventListener('mouseup', () => { dragging = false; });
      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        zoom = Math.max(0.3, Math.min(4, zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
      }, { passive: false });
      canvas.addEventListener('click', (e) => {
        if (dragMoved) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        let best = null, bestDist = Infinity;
        for (const n of nodes3d) {
          if (!nodeVisible(n)) continue;
          const p = project(n.x, n.y, n.z, canvas.width, canvas.height);
          const d = Math.hypot(p.sx - mx, p.sy - my);
          const hitR = (6 + Math.min(10, n.degree * 2)) * p.scale + 6;
          if (d < hitR && d < bestDist) { best = n; bestDist = d; }
        }
        if (best) {
          const mem = allMemories.find(m => m.id === best.id);
          if (mem) selectMemory(mem);
        }
      });
    }

    function exportDataHtml() {
      window.open('/api/export-html', '_blank');
    }

    // Tabs switching
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        currentTab = tab.dataset.view;
        const panel = document.getElementById('panel-' + currentTab);
        if (panel) panel.classList.add('active');
      });
    });

    // Archetype selection
    document.querySelectorAll('.archetype-card').forEach(card => {
      card.addEventListener('click', async () => {
        const arch = card.dataset.arch;
        if (!arch) return;
        document.querySelectorAll('.archetype-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        await fetch('/api/user-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archetype: arch })
        });
        fetchUserProfile();
        flash('Switched persona archetype to ' + arch);
      });
    });

    setupCanvasInteractions();
    setupTimeline();

    document.getElementById('searchInput').addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderList();
    });

    document.querySelectorAll('#filterBar .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#filterBar .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        currentFilter = chip.dataset.type;
        renderList();
      });
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k' || e.key === '/') {
        if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
          e.preventDefault();
          document.getElementById('searchInput').focus();
        }
      }
      if (e.key === 'Escape') {
        document.getElementById('detailPane').classList.remove('open');
      }
    });

    loadData();
  </script>
</body>
</html>`;

export function exportStandaloneHtml(store: Store): string {
  const memories = list(store);
  const script = `<script>window.STANDALONE_DATA = ${JSON.stringify(memories)};</script>`;
  return EMBEDDED_HTML.replace("</head>", `${script}\n</head>`);
}
