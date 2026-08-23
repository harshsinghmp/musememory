import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Store } from "./store.ts";
import { list, get, confirm, markStale, supersede, link, save, nowIso } from "./store.ts";
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
    
    .filters { display: flex; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border); overflow-x: auto; font-size: 12px; }
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

    async function loadData() {
      try {
        const res = await fetch('/api/memories');
        allMemories = await res.json();
        renderList();
        renderGraph();
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
      await fetch('/api/confirm', { method: 'POST', body: JSON.stringify({ id }), headers: { 'Content-Type': 'application/json' } });
      await loadData();
      const updated = allMemories.find(m => m.id === id);
      if (updated) selectMemory(updated);
    }

    async function staleMem(id) {
      await fetch('/api/mark-stale', { method: 'POST', body: JSON.stringify({ id, reason: 'Marked via Web UI' }), headers: { 'Content-Type': 'application/json' } });
      await loadData();
      const updated = allMemories.find(m => m.id === id);
      if (updated) selectMemory(updated);
    }

    // Canvas Force Graph
    function renderGraph() {
      const canvas = document.getElementById('graphCanvas');
      const ctx = canvas.getContext('2d');
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;

      const nodes = allMemories.map((m, i) => ({
        id: m.id,
        title: m.title,
        type: m.type || 'discovery',
        status: m.status,
        x: (canvas.width / 2) + Math.cos(i) * 160 + (Math.random() - 0.5) * 40,
        y: (canvas.height / 2) + Math.sin(i) * 140 + (Math.random() - 0.5) * 40,
        radius: m.status === 'confirmed' ? 9 : 7
      }));

      function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw relations
        ctx.strokeStyle = '#30363d';
        ctx.lineWidth = 1.5;
        allMemories.forEach(m => {
          const from = nodes.find(n => n.id === m.id);
          (m.related_memory_ids || []).forEach(rid => {
            const to = nodes.find(n => n.id === rid);
            if (from && to) {
              ctx.beginPath();
              ctx.moveTo(from.x, from.y);
              ctx.lineTo(to.x, to.y);
              ctx.stroke();
            }
          });
        });

        // Draw nodes
        nodes.forEach(n => {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
          ctx.fillStyle = n.type === 'fix' ? '#3fb950' : n.type === 'decision' ? '#58a6ff' : n.type === 'constraint' ? '#f85149' : '#bc8cff';
          ctx.fill();
          ctx.strokeStyle = selectedMemory && selectedMemory.id === n.id ? '#ffffff' : '#161b22';
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.fillStyle = '#8b949e';
          ctx.font = '11px sans-serif';
          ctx.fillText(n.title.slice(0, 20), n.x + 12, n.y + 4);
        });
      }
      draw();
    }

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

    window.addEventListener('resize', renderGraph);
    loadData();
  </script>
</body>
</html>`;
