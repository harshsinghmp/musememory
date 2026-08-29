import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Store } from "./store.ts";
import { list, get, confirm, markStale } from "./store.ts";
import { getCurrent, setCurrent } from "./current.ts";
import { validateStore } from "./schema.ts";
import { exportSnapshot } from "./snapshot.ts";

export interface UiServerOptions {
  port?: number;
  memoryDir: string;
  store: Store;
}

export function startUiServer(opts: UiServerOptions): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    let currentPort = opts.port ?? 3000;

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const pathname = url.pathname;

      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

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
        const lines = getCurrent(opts.memoryDir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ lines }));
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
        server.listen(currentPort);
      } else {
        reject(err);
      }
    });

    server.listen(currentPort, () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : currentPort;
      resolve({
        port: actualPort,
        close: () => server.close(),
      });
    });
  });
}

function parseJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
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
  <title>Muse Memory -- Visual Inspector</title>
  <style>
    :root {
      --bg: #0d1117;
      --panel: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --green: #3fb950;
      --yellow: #d29922;
      --red: #f85149;
      --purple: #bc8cff;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { background: var(--bg); color: var(--text); height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
    
    header { background: var(--panel); border-bottom: 1px solid var(--border); padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; }
    .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 18px; color: #fff; }
    .status-badge { font-size: 12px; background: rgba(63,185,80,0.15); color: var(--green); padding: 4px 10px; border-radius: 12px; border: 1px solid rgba(63,185,80,0.3); }
    
    .layout { display: flex; flex: 1; overflow: hidden; }
    .sidebar { width: 380px; background: var(--panel); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
    .search-box { padding: 12px; border-bottom: 1px solid var(--border); }
    .search-box input { width: 100%; background: #0d1117; border: 1px solid var(--border); padding: 8px 12px; border-radius: 6px; color: #fff; outline: none; font-size: 14px; }
    .search-box input:focus { border-color: var(--accent); }
    
    .filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 12px; }
    .chip { padding: 4px 8px; background: #21262d; border-radius: 4px; cursor: pointer; white-space: nowrap; color: var(--text-muted); }
    .chip.active { background: var(--accent); color: #fff; }
    
    .list { flex: 1; overflow-y: auto; padding: 8px; }
    .card { background: #21262d; border: 1px solid var(--border); border-radius: 6px; padding: 12px; margin-bottom: 8px; cursor: pointer; transition: border-color 0.15s; }
    .card:hover, .card.selected { border-color: var(--accent); }
    .card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
    .card-title { font-size: 14px; font-weight: 600; color: #fff; flex: 1; }
    .card-type { font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: 600; text-transform: uppercase; margin-left: 6px; }
    .type-fix { background: rgba(63,185,80,0.2); color: var(--green); }
    .type-decision { background: rgba(88,166,255,0.2); color: var(--accent); }
    .type-constraint { background: rgba(248,81,73,0.2); color: var(--red); }
    .type-failure { background: rgba(210,153,34,0.2); color: var(--yellow); }
    .type-architecture { background: rgba(188,140,255,0.2); color: var(--purple); }
    .card-snippet { font-size: 12px; color: var(--text-muted); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    
    .main { flex: 1; display: flex; flex-direction: column; position: relative; }
    .graph-controls { background: var(--panel); border-bottom: 1px solid var(--border); padding: 8px 14px; display: flex; flex-direction: column; gap: 6px; }
    .control-row { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--text-muted); flex-wrap: wrap; }
    .control-label { min-width: 60px; text-transform: uppercase; letter-spacing: 0.05em; font-size: 10px; }
    #timelineSlider { flex: 1; max-width: 420px; accent-color: var(--accent); }
    .cluster-check { display: inline-flex; align-items: center; gap: 4px; background: #21262d; border: 1px solid var(--border); border-radius: 4px; padding: 2px 8px; cursor: pointer; user-select: none; }
    .cluster-check input { accent-color: var(--accent); cursor: pointer; }
    .graph-container { flex: 1; position: relative; background: #0d1117; }
    canvas { width: 100%; height: 100%; display: block; }
    
    .detail-pane { width: 420px; background: var(--panel); border-left: 1px solid var(--border); padding: 20px; overflow-y: auto; display: none; }
    .detail-pane.open { display: block; }
    .detail-title { font-size: 18px; font-weight: 700; color: #fff; margin-bottom: 8px; }
    .meta-row { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; font-size: 12px; }
    .meta-tag { background: #21262d; border: 1px solid var(--border); padding: 2px 8px; border-radius: 4px; }
    .content-box { background: #0d1117; border: 1px solid var(--border); padding: 12px; border-radius: 6px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; margin-bottom: 16px; }
    
    .actions { display: flex; gap: 8px; }
    .btn { padding: 6px 12px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid var(--border); outline: none; }
    .btn-green { background: #238636; color: #fff; border-color: rgba(240,246,252,0.1); }
    .btn-yellow { background: #9e6a03; color: #fff; border-color: rgba(240,246,252,0.1); }
  </style>
</head>
<body>
  <header>
    <div class="brand">Muse Memory <span style="font-weight:400; font-size:13px; color:var(--text-muted);">Visual Inspector</span></div>
    <div class="status-badge">[LIVE] Store Active</div>
  </header>
  
  <div class="layout">
    <div class="sidebar">
      <div class="search-box">
        <input type="text" id="searchInput" placeholder="Search memories (fixes, decisions, tags)..." />
      </div>
      <div class="filters" id="filterBar">
        <div class="chip active" data-type="all">All</div>
        <div class="chip" data-type="fix">Fixes</div>
        <div class="chip" data-type="decision">Decisions</div>
        <div class="chip" data-type="constraint">Constraints</div>
        <div class="chip" data-type="failure">Failures</div>
        <div class="chip" data-type="architecture">Architecture</div>
      </div>
      <div class="list" id="memoryList"></div>
    </div>
    
    <div class="main">
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
      </div>
    </div>
    
    <div class="detail-pane" id="detailPane">
      <div class="detail-title" id="dTitle">Select a memory</div>
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

    // ---- Graph state (3D force-directed) ----
    const TYPE_COLORS = { fix: '#3fb950', decision: '#58a6ff', constraint: '#f85149', failure: '#d29922', architecture: '#bc8cff', operation: '#39c5cf', preference: '#f778ba', discovery: '#8b949e', session: '#6e7681' };
    let nodes3d = [];       // { id, title, type, status, x, y, z, degree, visible }
    let edges3d = [];       // [fromIndex, toIndex]
    let rotX = 0.35, rotY = 0, zoom = 1.4;
    let dragging = false, dragMoved = false, lastX = 0, lastY = 0;
    let hiddenClusters = new Set();
    let timelineCutoff = null; // ISO string; null = all
    let simAlpha = 1;

    async function loadData() {
      try {
        if (window.STANDALONE_DATA) {
          allMemories = window.STANDALONE_DATA;
        } else {
          const res = await fetch('/api/memories');
          allMemories = await res.json();
        }
        renderList();
        initGraph();
        buildClusterFilters();
        if (!graphLoopStarted) { graphLoopStarted = true; requestAnimationFrame(tick); }
      } catch (err) {
        console.error('Failed to load memories:', err);
      }
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
        <span class="meta-tag">ID: \${m.id}</span>
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
    }

    async function confirmMem(id) {
      return mutateMemory(id, '/api/confirm');
    }

    async function staleMem(id) {
      return mutateMemory(id, '/api/mark-stale');
    }

    // Transient toast: surfaces mutation success/failure instead of failing silently.
    function flash(msg, isError) {
      let el = document.getElementById('flashMsg');
      if (!el) {
        el = document.createElement('div');
        el.id = 'flashMsg';
        el.style.cssText = 'position:fixed;bottom:16px;right:16px;padding:10px 14px;border-radius:6px;font-size:13px;z-index:99;max-width:360px;display:none;';
        document.body.appendChild(el);
      }
      el.style.background = isError ? '#b62324' : '#238636';
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
          try { msg = (await res.json()).error || msg; } catch { /* empty/invalid body */ }
          throw new Error(msg);
        }
        await loadData();
        const updated = allMemories.find(m => m.id === id);
        if (updated) selectMemory(updated);
        flash(endpoint === '/api/mark-stale' ? 'Marked stale' : 'Confirmed');
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        flash('Action failed: ' + msg, true);
        console.error('Mutation failed:', msg);
      }
    }

    // ===================== Knowledge Graph UI v2 =====================
    // 3D force-directed layout on a 2D canvas: repulsion + springs +
    // centering, perspective projection, drag-to-rotate, wheel-to-zoom,
    // timeline filtering by updated_at and cluster checkboxes.

    let graphLoopStarted = false;

    function nodeVisible(n) {
      if (hiddenClusters.has('project:' + (n.project || 'none'))) return false;
      if (hiddenClusters.has('type:' + n.type)) return false;
      if (timelineCutoff && n.updatedAt < timelineCutoff) return false;
      // Keep the canvas in sync with the sidebar's type chip + search filters.
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
          // Preserve existing positions across reloads; seed new nodes on a ring.
          x: prev ? prev.x : Math.cos(angle) * 260,
          y: prev ? prev.y : (Math.random() - 0.5) * 90,
          z: prev ? prev.z : Math.sin(angle) * 260,
        };
      });
      simAlpha = 1; // re-energize layout after data changes
    }

    function buildQuadtree(nodes) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const n of nodes) {
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
      }
      const size = Math.max(maxX - minX, maxY - minY, 100);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;

      function createQuad(x, y, s) {
        return { x, y, size: s, mass: 0, cx: 0, cy: 0, cz: 0, body: null, children: null };
      }
      const root = createQuad(cx, cy, size);

      function insert(tree, body) {
        if (tree.mass === 0) {
          tree.body = body;
          tree.cx = body.x; tree.cy = body.y; tree.cz = body.z;
          tree.mass = 1;
          return;
        }
        if (!tree.children) {
          const b2 = tree.body;
          tree.body = null;
          const hs = tree.size / 2;
          const qs = tree.size / 4;
          tree.children = [
            createQuad(tree.x - qs, tree.y - qs, hs),
            createQuad(tree.x + qs, tree.y - qs, hs),
            createQuad(tree.x - qs, tree.y + qs, hs),
            createQuad(tree.x + qs, tree.y + qs, hs)
          ];
          if (b2) insertChild(tree, b2);
        }
        tree.cx = (tree.cx * tree.mass + body.x) / (tree.mass + 1);
        tree.cy = (tree.cy * tree.mass + body.y) / (tree.mass + 1);
        tree.cz = (tree.cz * tree.mass + body.z) / (tree.mass + 1);
        tree.mass++;
        insertChild(tree, body);
      }

      function insertChild(tree, body) {
        const idx = (body.x >= tree.x ? 1 : 0) + (body.y >= tree.y ? 2 : 0);
        insert(tree.children[idx], body);
      }

      for (const n of nodes) insert(root, n);
      return root;
    }

    function applyRepulsionBarnesHut(nodes, tree, theta, alpha) {
      for (const a of nodes) computeForce(a, tree);

      function computeForce(a, node) {
        if (node.mass === 0 || node.body === a) return;
        let dx = a.x - node.cx, dy = a.y - node.cy, dz = a.z - node.cz;
        let dist2 = dx * dx + dy * dy + dz * dz + 0.01;
        let dist = Math.sqrt(dist2);
        if (node.children && (node.size / dist) > theta) {
          for (const child of node.children) computeForce(a, child);
        } else {
          const force = (2400 * alpha * node.mass) / dist2;
          dx /= dist; dy /= dist; dz /= dist;
          a.x += dx * force; a.y += dy * force; a.z += dz * force;
        }
      }
    }

    function simulateStep() {
      if (nodes3d.length === 0) return;
      const alpha = simAlpha;
      if (nodes3d.length > 50) {
        const qtree = buildQuadtree(nodes3d);
        applyRepulsionBarnesHut(nodes3d, qtree, 0.6, alpha);
      } else {
        // Pairwise repulsion (O(n^2) for small graphs)
        for (let i = 0; i < nodes3d.length; i++) {
          for (let j = i + 1; j < nodes3d.length; j++) {
            const a = nodes3d[i], b = nodes3d[j];
            let dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
            let dist2 = dx * dx + dy * dy + dz * dz + 0.01;
            const force = (2400 * alpha) / dist2;
            const dist = Math.sqrt(dist2);
            dx /= dist; dy /= dist; dz /= dist;
            a.x += dx * force; a.y += dy * force; a.z += dz * force;
            b.x -= dx * force; b.y -= dy * force; b.z -= dz * force;
          }
        }
      }
      // Springs along graph edges
      for (const [fromId, toId] of edges3d) {
        const a = nodes3d.find(n => n.id === fromId);
        const b = nodes3d.find(n => n.id === toId);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const target = 120;
        const force = ((dist - target) / dist) * 0.02 * alpha;
        a.x += dx * force; a.y += dy * force; a.z += dz * force;
        b.x -= dx * force; b.y -= dy * force; b.z -= dz * force;
      }
      // Gentle pull toward origin so the cloud stays framed
      for (const n of nodes3d) {
        n.x *= (1 - 0.002 * alpha);
        n.y *= (1 - 0.002 * alpha);
        n.z *= (1 - 0.002 * alpha);
      }
      simAlpha = Math.max(0.05, simAlpha * 0.995);
    }

    function project(x, y, z, width, height) {
      // Rotate around Y then X, then perspective-project.
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

      // Edges between visible nodes
      ctx.strokeStyle = '#30363d';
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

      // Nodes: color by type, size by degree
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
        ctx.strokeStyle = selectedMemory && selectedMemory.id === n.id ? '#ffffff' : '#161b22';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (nodes3d.length <= 40 || zoom > 1.4) {
          ctx.fillStyle = '#8b949e';
          ctx.font = '11px sans-serif';
          ctx.fillText(n.title.slice(0, 24), p.sx + radius + 4, p.sy + 4);
        }
      }
    }

    function tick() {
      const canvas = document.getElementById('graphCanvas');
      if (canvas) {
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
      // Keep the label, rebuild checkboxes
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

    // ---- Canvas interactions: drag rotates, wheel zooms, click selects ----
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
        if (dragMoved) return; // it was a rotate, not a click
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

    loadData();
  </script>
</body>
</html>`;

export function exportStandaloneHtml(store: Store): string {
  const memories = list(store);
  const script = `<script>window.STANDALONE_DATA = ${JSON.stringify(memories)};</script>`;
  return EMBEDDED_HTML.replace("</head>", `${script}\n</head>`);
}
