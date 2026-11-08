import { describe, test, expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openStore, save } from "../src/store.ts";
import { startUiServer, exportStandaloneHtml } from "../src/ui.ts";
import { setupFixtureRoot, cleanup, makeTempRoot } from "./helpers.ts";

describe("embedded web UI server", () => {
  test("serves embedded HTML and JSON API endpoints", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const srv = await startUiServer({
      port: 0, // OS assigns open random port
      memoryDir,
      store,
    });

    expect(srv.port).toBeGreaterThan(0);

    // 1. Check HTML index
    const htmlRes = await fetch(`http://localhost:${srv.port}/`);
    expect(htmlRes.status).toBe(200);
    const htmlText = await htmlRes.text();
    expect(htmlText).toContain("Muse Memory");
    expect(htmlText).toContain("Visual Inspector");

    // 2. Check /api/memories
    const memRes = await fetch(`http://localhost:${srv.port}/api/memories`);
    expect(memRes.status).toBe(200);
    const mems = await memRes.json();
    expect(Array.isArray(mems)).toBe(true);
    expect(mems.length).toBeGreaterThan(0);

    // 3. Check /api/snapshot
    const snapRes = await fetch(`http://localhost:${srv.port}/api/snapshot`);
    expect(snapRes.status).toBe(200);
    const snap = await snapRes.json();
    expect(snap.total).toBe(mems.length);

    srv.close();
    cleanup(root);
  });

  test("v2: serves 3D force-directed canvas graph with timeline and cluster filters", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const srv = await startUiServer({ port: 0, memoryDir, store });

    const html = await (await fetch(`http://localhost:${srv.port}/`)).text();
    // v2 markup markers stay in the shell; behaviour markers moved to the JS asset (T-453).
    expect(html).toContain("timelineSlider");
    expect(html).toContain("clusterFilters");
    const js = await (await fetch(`http://localhost:${srv.port}/assets/studio.js`)).text();
    expect(js).toContain("simulateStep");
    expect(js).toContain("project(");      // perspective projection
    expect(js).toContain("rotY");          // drag-to-rotate state
    expect(js).toContain("wheel");         // zoom
    expect(js).toContain("TYPE_COLORS");   // color by type
    expect(js).toContain("degree");        // size by degree
    expect(js).toContain("nodeVisible");   // filter gating
    // data endpoint shape unchanged (array of raw entries)
    const mems = await (await fetch(`http://localhost:${srv.port}/api/memories`)).json();
    expect(Array.isArray(mems)).toBe(true);
    expect(mems[0]).toHaveProperty("id");
    expect(mems[0]).toHaveProperty("title");

    srv.close();
    cleanup(root);
  });

  test("v2: defensive on empty stores (page still serves, API returns [])", async () => {
    const root = makeTempRoot();
    const memoryDir = join(root, ".memory");
    mkdirSync(memoryDir, { recursive: true });
    const store = openStore(memoryDir);
    const srv = await startUiServer({ port: 0, memoryDir, store });

    const html = await (await fetch(`http://localhost:${srv.port}/`)).text();
    expect(html).toContain("panel-graph");
    const js = await (await fetch(`http://localhost:${srv.port}/assets/studio.js`)).text();
    expect(js).toContain("No memories yet"); // empty-graph guard message
    const mems = await (await fetch(`http://localhost:${srv.port}/api/memories`)).json();
    expect(Array.isArray(mems)).toBe(true);
    expect(mems.length).toBe(0);

    srv.close();
    cleanup(root);
  });

  test("serves Refresh button and /api/refresh endpoint", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const srv = await startUiServer({ port: 0, memoryDir, store });

    // Check HTML contains Refresh button
    const html = await (await fetch(`http://localhost:${srv.port}/`)).text();
    expect(html).toContain('id="refreshBtn"');
    expect(html).toContain("refreshMemories()");

    // Test POST /api/refresh
    const refreshRes = await fetch(`http://localhost:${srv.port}/api/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ harvest: false }),
    });
    expect(refreshRes.status).toBe(200);
    const data = await refreshRes.json();
    expect(data.success).toBe(true);
    expect(data.totalMemories).toBeGreaterThan(0);
    expect(data).toHaveProperty("activeConstraints");

    srv.close();
    cleanup(root);
  });

  test("R15: serves full Web Observability Studio with 5-pillar health, ADRs, cognition why, and P2P sync", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const srv = await startUiServer({ port: 0, memoryDir, store });

    // 1. Check Studio HTML structure and tabs
    const html = await (await fetch(`http://localhost:${srv.port}/`)).text();
    expect(html).toContain('data-view="health"');
    expect(html).toContain('data-view="adrs"');
    expect(html).toContain('data-view="cognition"');
    expect(html).toContain('data-view="sync"');
    expect(html).toContain('id="panel-health"');
    expect(html).toContain('id="panel-adrs"');
    expect(html).toContain('id="panel-cognition"');
    expect(html).toContain('id="panel-sync"');
    expect(html).toContain('id="healthGrade"');
    expect(html).toContain('id="healthChecklistBody"');

    // 2. Test GET /api/health
    const healthRes = await fetch(`http://localhost:${srv.port}/api/health`);
    expect(healthRes.status).toBe(200);
    const health = await healthRes.json();
    expect(health).toHaveProperty("overall_grade");
    expect(health).toHaveProperty("overall_score");
    expect(health).toHaveProperty("gate_status");
    expect(health).toHaveProperty("pillars");
    expect(health).toHaveProperty("actionable_checklist");

    // 3. Test GET /api/adrs
    const adrsRes = await fetch(`http://localhost:${srv.port}/api/adrs`);
    expect(adrsRes.status).toBe(200);
    const adrs = await adrsRes.json();
    expect(Array.isArray(adrs)).toBe(true);

    // 4. Test GET /api/drift
    const driftRes = await fetch(`http://localhost:${srv.port}/api/drift`);
    expect(driftRes.status).toBe(200);
    const drift = await driftRes.json();
    expect(drift).toHaveProperty("alignment_score");
    expect(drift).toHaveProperty("items");

    // 5. Test POST /api/cognition/why
    const whyRes = await fetch(`http://localhost:${srv.port}/api/cognition/why`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "openStore" }),
    });
    expect(whyRes.status).toBe(200);
    const why = await whyRes.json();
    expect(why).toHaveProperty("target", "openStore");
    expect(why).toHaveProperty("core_rationale");

    // 6. Test GET /api/cognition/clusters & /api/cognition/debt
    const clustersRes = await fetch(`http://localhost:${srv.port}/api/cognition/clusters`);
    expect(clustersRes.status).toBe(200);
    const clusters = await clustersRes.json();
    expect(clusters).toHaveProperty("total_clusters");

    const debtRes = await fetch(`http://localhost:${srv.port}/api/cognition/debt`);
    expect(debtRes.status).toBe(200);
    const debt = await debtRes.json();
    expect(debt).toHaveProperty("total_debt_items");
    expect(debt).toHaveProperty("debt_score");

    // 7. Test GET /api/sync/status & POST /api/sync/broadcast
    const syncStatusRes = await fetch(`http://localhost:${srv.port}/api/sync/status`);
    expect(syncStatusRes.status).toBe(200);
    const syncStatus = await syncStatusRes.json();
    expect(syncStatus).toHaveProperty("local_agent_id");
    expect(syncStatus).toHaveProperty("total_peers");

    const broadcastRes = await fetch(`http://localhost:${srv.port}/api/sync/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: "agent_studio_test" }),
    });
    expect(broadcastRes.status).toBe(200);
    const packet = await broadcastRes.json();
    expect(packet.protocol_version).toBe("2.0.0");
    expect(packet.sender_id).toBe("agent_studio_test");

    // 8. Test R16 Mesh endpoints and markup
    expect(html).toContain('data-view="mesh"');
    expect(html).toContain('id="panel-mesh"');
    expect(html).toContain('id="meshNodesGrid"');

    const meshStatusRes = await fetch(`http://localhost:${srv.port}/api/mesh/status`);
    expect(meshStatusRes.status).toBe(200);
    const meshStatus = await meshStatusRes.json();
    expect(meshStatus).toHaveProperty("rootPath");
    expect(meshStatus).toHaveProperty("nodes");

    const meshQueryRes = await fetch(`http://localhost:${srv.port}/api/mesh/query?q=test`);
    expect(meshQueryRes.status).toBe(200);
    const meshQueryData = await meshQueryRes.json();
    expect(Array.isArray(meshQueryData)).toBe(true);

    const meshAuditRes = await fetch(`http://localhost:${srv.port}/api/mesh/audit`);
    expect(meshAuditRes.status).toBe(200);
    const meshAudit = await meshAuditRes.json();
    expect(meshAudit).toHaveProperty("total_contracts_checked");

    // 9. Test Optimize Button and Endpoints
    expect(html).toContain('id="optimizeBtn"');
    expect(html).toContain("optimizeStoreDashboard()");

    const optRes = await fetch(`http://localhost:${srv.port}/api/optimize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true, dryRun: true }),
    });
    expect(optRes.status).toBe(200);
    const optData = await optRes.json();
    expect(optData.success).toBe(true);
    expect(optData.report).toHaveProperty("totalPruned");

    const optStatusRes = await fetch(`http://localhost:${srv.port}/api/optimize/status`);
    expect(optStatusRes.status).toBe(200);
    const optStatus = await optStatusRes.json();
    expect(optStatus.success).toBe(true);
    expect(optStatus).toHaveProperty("shouldAutoOptimize");

    srv.close();
    cleanup(root);
  });
});

describe("Wave 23: studio shell, dual-scope switcher, cached assets", () => {
  test("T-451: serves a 76px numbered left rail with warm-dark typography", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const srv = await startUiServer({ port: 0, memoryDir, store });
    try {
      const html = await (await fetch(`http://localhost:${srv.port}/`)).text();
      expect(html).toContain('class="rail"');
      for (const n of ["01", "02", "03", "04", "05", "06"]) {
        expect(html).toContain(`<span class="rail-num">${n}</span>`);
      }
      for (const view of ["graph", "health", "wiki", "cognition", "current", "about"]) {
        expect(html).toContain(`data-view="${view}"`);
      }
      // The six numbered sections do not orphan the pre-existing views.
      for (const view of ["adrs", "sync", "mesh", "persona", "sandbox", "audit"]) {
        expect(html).toContain(`data-view="${view}"`);
      }
      // Rail uses words + numbers, never emoji glyphs.
      const rail = html.slice(html.indexOf('class="rail"'), html.indexOf("</nav>"));
      expect(rail).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);

      const css = await (await fetch(`http://localhost:${srv.port}/assets/studio.css`)).text();
      expect(css).toContain("width: 76px");
      expect(css).toContain("margin-left: 76px");
      expect(css).toContain("Archivo Black");
      expect(css).toContain("#0c0a09");
      expect(css).toContain("@media (max-width: 640px)");
      expect(css).toContain("min-height: 44px");
      expect(css).toContain("overflow-x: auto");
      // Clickable filters/cards must be real buttons with pressed state.
      expect(html).toContain('<button type="button" class="chip');
      expect(html).toContain('aria-pressed="true">All</button>');
      expect(html).toContain('<button type="button" class="archetype-card"');
      expect(html).toContain('<span class="archetype-icon">');
      // Buttons may not close a span with a div end tag.
      expect(html).not.toMatch(/<span class="archetype-icon">[^<]*<\/div>/);
    } finally {
      srv.close();
      cleanup(root);
    }
  });

  test("T-452: project, global and mesh scopes resolve independently", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const globalRoot = makeTempRoot();
    const globalDir = join(globalRoot, ".memory");
    const previous = process.env.MUSEMEMORY_GLOBAL_DIR;
    process.env.MUSEMEMORY_GLOBAL_DIR = globalDir;
    let srv: Awaited<ReturnType<typeof startUiServer>> | undefined;
    try {
      const globalStore = openStore(globalDir);
      save(globalStore, {
        id: "m_1700000099999_global",
        title: "global scope marker",
        content: "only present in the global store",
        project: "global",
        status: "confirmed",
        type: "discovery",
        created_at: "2026-08-12T10:00:00Z",
        updated_at: "2026-08-12T10:00:00Z",
      });
      globalStore.db?.close();
      writeFileSync(join(globalDir, "CURRENT.md"), "# Global Constraints\n- global-only-rule\n");

      srv = await startUiServer({ port: 0, memoryDir, store });
      const base = `http://localhost:${srv.port}`;

      const html = await (await fetch(`${base}/`)).text();
      for (const scope of ["project", "global", "mesh"]) {
        expect(html).toContain(`data-scope="${scope}"`);
      }
      expect(html).toContain('id="scopeSwitch"');
      expect(html).toContain('id="scopeBanner"');

      // A server that resolves ?scope= is only useful if the client sends it.
      const js = await (await fetch(`${base}/assets/studio.js`)).text();
      for (const route of ["/api/current", "/api/wiki", "/api/user-profile", "/api/audit"]) {
        expect(js).toContain(`fetch(apiUrl('${route}')`);
      }
      expect(js).toContain("apiUrl('/api/wiki?page='");
      expect(js).toContain("origin_project");
      expect(js).toContain("Health, ADRs, Cognition, Sync and Mesh stay project-scoped");
      expect(js).toContain("first 200 entries");
      // Writes stay project-scoped and the UI must say so / enforce it.
      expect(js).toContain("requireProjectScope");
      expect(js).toContain("document.body.dataset.scope");
      expect(js).toContain("typeof profile === 'string'");
      expect(js).toContain("scopeGeneration");
      expect((js.match(/requestGen !== scopeGeneration/g) || []).length).toBeGreaterThanOrEqual(5);

      const project = await (await fetch(`${base}/api/memories`)).json();
      const global = await (await fetch(`${base}/api/memories?scope=global`)).json();
      const mesh = await (await fetch(`${base}/api/memories?scope=mesh`)).json();
      expect(Array.isArray(project)).toBe(true);
      expect(Array.isArray(global)).toBe(true);
      expect(Array.isArray(mesh)).toBe(true);
      expect(global.some((m: { id: string }) => m.id === "m_1700000099999_global")).toBe(true);
      expect(project.some((m: { id: string }) => m.id === "m_1700000099999_global")).toBe(false);

      const stats = await (await fetch(`${base}/api/stats?scope=global`)).json();
      expect(stats.scope).toBe("global");
      expect(stats.available).toBe(true);
      expect(stats.total).toBeGreaterThan(0);

      // Panels with a global counterpart follow the scope; the project view does not.
      const globalCurrent = await (await fetch(`${base}/api/current?scope=global`)).json();
      const projectCurrent = await (await fetch(`${base}/api/current`)).json();
      expect(globalCurrent.lines.join("\n")).toContain("global-only-rule");
      expect(projectCurrent.lines.join("\n")).not.toContain("global-only-rule");
    } finally {
      srv?.close();
      if (previous === undefined) delete process.env.MUSEMEMORY_GLOBAL_DIR;
      else process.env.MUSEMEMORY_GLOBAL_DIR = previous;
      cleanup(root);
      cleanup(globalRoot);
    }
  });

  test("T-452: a missing global store stays empty and is not created by a read", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const globalRoot = makeTempRoot();
    const absentDir = join(globalRoot, "absent", ".memory");
    const previous = process.env.MUSEMEMORY_GLOBAL_DIR;
    process.env.MUSEMEMORY_GLOBAL_DIR = absentDir;
    const srv = await startUiServer({ port: 0, memoryDir, store });
    try {
      const global = await (await fetch(`http://localhost:${srv.port}/api/memories?scope=global`)).json();
      expect(global).toEqual([]);
      const stats = await (await fetch(`http://localhost:${srv.port}/api/stats?scope=global`)).json();
      expect(stats.scope).toBe("global");
      expect(stats.available).toBe(false);
      expect(existsSync(absentDir)).toBe(false);
    } finally {
      srv.close();
      if (previous === undefined) delete process.env.MUSEMEMORY_GLOBAL_DIR;
      else process.env.MUSEMEMORY_GLOBAL_DIR = previous;
      cleanup(root);
      cleanup(globalRoot);
    }
  });

  test("T-452: linking a mesh store invalidates the cached topology", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const linkedRoot = makeTempRoot();

    const srv = await startUiServer({ port: 0, memoryDir, store });
    try {
      const base = `http://localhost:${srv.port}`;

      // Populate the 2s topology cache before the linked store exists.
      const before = await (await fetch(`${base}/api/memories?scope=mesh`)).json();
      expect(before.some((m: { id: string }) => m.id === "m_1700000077777_linked")).toBe(false);

      const linkedMemory = join(linkedRoot, ".memory");
      const linkedStore = openStore(linkedMemory);
      save(linkedStore, {
        id: "m_1700000077777_linked",
        title: "linked mesh marker",
        content: "only present after linking the store",
        project: "linked",
        status: "confirmed",
        type: "discovery",
        created_at: "2026-08-12T10:00:00Z",
        updated_at: "2026-08-12T10:00:00Z",
      });
      linkedStore.db?.close();

      const linkRes = await fetch(`${base}/api/mesh/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: linkedRoot }),
      });
      expect(linkRes.status).toBe(200);

      // The next read must not serve the pre-link cache.
      const after = await (await fetch(`${base}/api/memories?scope=mesh`)).json();
      expect(after.some((m: { id: string }) => m.id === "m_1700000077777_linked")).toBe(true);
    } finally {
      srv.close();
      cleanup(root);
      cleanup(linkedRoot);
    }
  });

  test("T-452: reading an existing global store does not re-sync it", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const globalRoot = makeTempRoot();
    const globalDir = join(globalRoot, ".memory");
    const previous = process.env.MUSEMEMORY_GLOBAL_DIR;
    process.env.MUSEMEMORY_GLOBAL_DIR = globalDir;
    let srv: Awaited<ReturnType<typeof startUiServer>> | undefined;
    try {
      const globalStore = openStore(globalDir);
      save(globalStore, {
        id: "m_1700000088888_global",
        title: "existing global entry",
        content: "already present before the read",
        project: "global",
        status: "confirmed",
        type: "discovery",
        created_at: "2026-08-12T10:00:00Z",
        updated_at: "2026-08-12T10:00:00Z",
      });
      globalStore.db?.close();

      writeFileSync(join(globalDir, "CURRENT.md"), "# Global Constraints\n- immutable-rule\n");
      const currentBefore = readFileSync(join(globalDir, "CURRENT.md"), "utf8");
      const wikiDir = join(globalDir, "wiki");
      const wikiBefore = existsSync(wikiDir)
        ? (readdirSync(wikiDir, { recursive: true }) as string[]).sort()
        : [];

      srv = await startUiServer({ port: 0, memoryDir, store });
      const memories = await (await fetch(`http://localhost:${srv.port}/api/memories?scope=global`)).json();
      expect(memories.some((m: { id: string }) => m.id === "m_1700000088888_global")).toBe(true);

      // The read must not rewrite CURRENT.md or compile the wiki.
      expect(readFileSync(join(globalDir, "CURRENT.md"), "utf8")).toBe(currentBefore);
      const wikiAfter = existsSync(wikiDir)
        ? (readdirSync(wikiDir, { recursive: true }) as string[]).sort()
        : [];
      expect(wikiAfter).toEqual(wikiBefore);
    } finally {
      srv?.close();
      if (previous === undefined) delete process.env.MUSEMEMORY_GLOBAL_DIR;
      else process.env.MUSEMEMORY_GLOBAL_DIR = previous;
      cleanup(root);
      cleanup(globalRoot);
    }
  });

  test("T-453: shell and assets are served with ETag, gzip and a 304 fast path", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const srv = await startUiServer({ port: 0, memoryDir, store });
    try {
      const base = `http://localhost:${srv.port}`;

      const cssRes = await fetch(`${base}/assets/studio.css`, { headers: { "Accept-Encoding": "identity" } });
      expect(cssRes.status).toBe(200);
      expect(cssRes.headers.get("content-type")).toContain("text/css");
      expect(cssRes.headers.get("cache-control")).toContain("no-cache");
      const cssEtag = cssRes.headers.get("etag");
      expect(cssEtag).toBeTruthy();
      expect(await cssRes.text()).toContain(".rail");

      const jsRes = await fetch(`${base}/assets/studio.js`, { headers: { "Accept-Encoding": "gzip" } });
      expect(jsRes.status).toBe(200);
      expect(jsRes.headers.get("content-encoding")).toBe("gzip");
      expect(jsRes.headers.get("vary")).toContain("Accept-Encoding");
      expect(await jsRes.text()).toContain("simulateStep");
      const jsIdentity = await fetch(`${base}/assets/studio.js`, { headers: { "Accept-Encoding": "identity" } });
      expect(jsIdentity.headers.get("etag")).not.toBe(jsRes.headers.get("etag"));

      const notModified = await fetch(`${base}/assets/studio.css`, {
        // Validators are per-representation, so pin the encoding being revalidated.
        headers: { "If-None-Match": cssEtag as string, "Accept-Encoding": "identity" },
      });
      expect(notModified.status).toBe(304);
      expect(await notModified.text()).toBe("");

      const wildcard = await fetch(`${base}/assets/studio.css`, { headers: { "If-None-Match": "*" } });
      expect(wildcard.status).toBe(304);

      // Monitoring/prefetch probes use HEAD; it must not 404.
      const headRes = await fetch(`${base}/assets/studio.css`, { method: "HEAD" });
      expect(headRes.status).toBe(200);
      expect(headRes.headers.get("etag")).toBeTruthy();
      expect(await headRes.text()).toBe("");

      // q=0 means the client refused gzip — do not send it.
      const refused = await fetch(`${base}/assets/studio.js`, { headers: { "Accept-Encoding": "gzip;q=0" } });
      expect(refused.headers.get("content-encoding")).toBeNull();
      expect(await refused.text()).toContain("simulateStep");

      const gzipOnly = await fetch(`${base}/assets/studio.js`, { headers: { "Accept-Encoding": "identity;q=0, gzip" } });
      expect(gzipOnly.headers.get("content-encoding")).toBe("gzip");
      const unacceptable = await fetch(`${base}/assets/studio.js`, { headers: { "Accept-Encoding": "identity;q=0" } });
      expect(unacceptable.status).toBe(406);

      const htmlRes = await fetch(`${base}/`);
      expect(htmlRes.status).toBe(200);
      expect(htmlRes.headers.get("etag")).toBeTruthy();
      const html = await htmlRes.text();
      expect(html).toContain('href="/assets/studio.css"');
      expect(html).toContain('src="/assets/studio.js"');
      // The shell must not carry the old inline monolith.
      expect(html).not.toContain("TYPE_COLORS");
      expect(html.length).toBeLessThan(80_000);
    } finally {
      srv.close();
      cleanup(root);
    }
  });
});

describe("Wave 23 PR 2: T-454 graph/list toggle", () => {
  test("serves an instant toggle, a sortable table and a 100ms table filter", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const srv = await startUiServer({ port: 0, memoryDir, store });
    try {
      const base = `http://localhost:${srv.port}`;
      const html = await (await fetch(`${base}/`)).text();
      const js = await (await fetch(`${base}/assets/studio.js`)).text();
      const css = await (await fetch(`${base}/assets/studio.css`)).text();

      expect(html).toContain('data-studio-view="graph"');
      expect(html).toContain('data-studio-view="list"');
      expect(html).toContain('id="studioListView"');
      expect(html).toContain('id="studioTableBody"');
      for (const key of ["title", "type", "status", "project", "created_at"]) {
        expect(html).toContain(`data-sort="${key}"`);
      }

      expect(js).toContain("function setStudioView");
      expect(js).toContain("function renderStudioTable");
      expect(js).toContain("studioListSearch");
      expect(js).toContain("listQuery = value; renderStudioTable(); }, 100)");
      expect(js).toContain("aria-sort");

      expect(css).toContain(".studio-view-switch");
      expect(css).toContain(".studio-table");
      expect(css).toContain(".studio-list-view");
    } finally {
      srv.close();
      cleanup(root);
    }
  });
});

describe("Wave 23 PR 2: T-455 kinetic settling", () => {
  test("stops the rAF loop at settle energy and wakes on input", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const srv = await startUiServer({ port: 0, memoryDir, store });
    try {
      const base = `http://localhost:${srv.port}`;
      const html = await (await fetch(`${base}/`)).text();
      const js = await (await fetch(`${base}/assets/studio.js`)).text();

      // Ring-seeded, deterministic layout.
      expect(js).toContain("Math.sin(angle * 2) * 45");
      expect(js).not.toContain("(Math.random() - 0.5) * 90");

      // Energy-settling loop.
      expect(js).toContain("const SETTLE_ENERGY = 0.05");
      expect(js).toContain("graphEnergy = energy / nodes3d.length");
      expect(js).toContain("if (!dragging && graphEnergy < SETTLE_ENERGY)");
      expect(js).toContain("graphLoopStarted = false;");
      expect(js).toContain("function wakeGraph");

      // Pointer capture + wake on the controls.
      expect(js).toContain("setPointerCapture");
      expect(js).toContain("wakeGraph()");
      expect(html).toContain('id="graphCanvas"');
    } finally {
      srv.close();
      cleanup(root);
    }
  });
});

describe("Wave 23 PR 2: T-456 activity heatmap", () => {
  test("serves 52 weeks of mutations and agent session cards", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    save(store, {
      id: "m_1700000066666_session",
      title: "Session s_test start",
      content: "started",
      project: "t456",
      status: "confirmed",
      type: "session",
      session_id: "s_test",
      tags: ["session", "timeline"],
      created_at: "2026-08-12T10:00:00Z",
      updated_at: "2026-08-12T10:00:00Z",
    });
    const srv = await startUiServer({ port: 0, memoryDir, store });
    try {
      const base = `http://localhost:${srv.port}`;
      const html = await (await fetch(`${base}/`)).text();
      const js = await (await fetch(`${base}/assets/studio.js`)).text();
      const css = await (await fetch(`${base}/assets/studio.css`)).text();

      expect(html).toContain('data-view="activity"');
      expect(html).toContain('id="panel-activity"');
      expect(html).toContain('id="activityHeatmap"');
      expect(html).toContain('id="activitySessions"');
      expect(js).toContain("function fetchActivity");
      expect(js).toContain("function renderActivity");
      expect(js).toContain("apiUrl('/api/activity')");
      expect(css).toContain(".hm-cell");
      expect(css).toContain(".session-card");

      const activity = await (await fetch(`${base}/api/activity`)).json();
      expect(activity.scope).toBe("project");
      expect(activity.available).toBe(true);
      expect(activity.days.length).toBe(371);
      expect(Array.isArray(activity.sessions)).toBe(true);
      expect(activity.sessions.some((x: { session_id: string }) => x.session_id === "s_test")).toBe(true);
      expect(activity.sessions[0]).toHaveProperty("messages");
      expect(activity.sessions[0]).toHaveProperty("status");

      const globalRoot = makeTempRoot();
      const previous = process.env.MUSEMEMORY_GLOBAL_DIR;
      process.env.MUSEMEMORY_GLOBAL_DIR = join(globalRoot, "absent", ".memory");
      try {
        const globalActivity = await (await fetch(`${base}/api/activity?scope=global`)).json();
        expect(globalActivity.available).toBe(false);
        expect(globalActivity.days).toEqual([]);
      } finally {
        if (previous === undefined) delete process.env.MUSEMEMORY_GLOBAL_DIR;
        else process.env.MUSEMEMORY_GLOBAL_DIR = previous;
        cleanup(globalRoot);
      }
    } finally {
      srv.close();
      cleanup(root);
    }
  });
});

describe("Wave 23 PR 3: T-458 terrain vault UI", () => {
  test("serves the split-pane, lists six maps and reindexes them", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const srv = await startUiServer({ port: 0, memoryDir, store });
    try {
      const base = `http://localhost:${srv.port}`;
      const html = await (await fetch(`${base}/`)).text();
      const js = await (await fetch(`${base}/assets/studio.js`)).text();
      const css = await (await fetch(`${base}/assets/studio.css`)).text();

      expect(html).toContain('data-view="terrain"');
      expect(html).toContain('id="panel-terrain"');
      expect(html).toContain('id="terrainTree"');
      expect(html).toContain('id="terrainContent"');
      expect(html).toContain('id="terrainScanline"');
      expect(html).toContain("reindexTerrain()");
      expect(js).toContain("function fetchTerrain");
      expect(js).toContain("function renderTerrainMarkdown");
      expect(js).toContain("terrainScanline");
      expect(js).toContain("}, 900)");
      expect(css).toContain(".terrain-split");
      expect(css).toContain(".gen-badge");
      expect(css).toContain("@keyframes terrain-scan");

      const before = await (await fetch(`${base}/api/terrain`)).json();
      expect(before.files.map((f: { name: string }) => f.name)).toEqual([
        "repo.md", "stack.md", "habits.md", "ownership.md", "packages.md", "logs.md",
      ]);
      expect(before.available).toBe(false);

      const reindex = await fetch(`${base}/api/terrain/reindex`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      expect(reindex.status).toBe(200);
      const reindexed = await reindex.json();
      expect(reindexed.success).toBe(true);
      expect(reindexed.files.length).toBe(6);

      const after = await (await fetch(`${base}/api/terrain`)).json();
      expect(after.available).toBe(true);
      expect(after.files.every((f: { generated: boolean }) => f.generated)).toBe(true);
      const repoMap = after.files.find((f: { name: string }) => f.name === "repo.md");
      expect(repoMap.content).toContain("Repository Terrain");
    } finally {
      srv.close();
      cleanup(root);
    }
  });
});

describe("standalone HTML export", () => {
  function embeddedPayload(html: string): unknown {
    const m = html.match(/window\.STANDALONE_DATA = ([\s\S]*?);<\/script>/);
    if (!m) throw new Error("STANDALONE_DATA script block not found");
    return JSON.parse(m[1]);
  }

  function storeWith(content: string) {
    const root = makeTempRoot();
    const memoryDir = join(root, ".memory");
    mkdirSync(join(memoryDir, "memories"), { recursive: true });
    const store = openStore(memoryDir);
    save(store, {
      id: "m_1700000009500_xss",
      title: "xss payload",
      content,
      project: "t342",
      status: "confirmed",
      type: "discovery",
      created_at: "2026-08-12T10:00:00Z",
      updated_at: "2026-08-12T10:00:00Z",
    });
    return { root, memoryDir, store };
  }

  test("T-342: escapes </script> in memory content so the payload stays inert", () => {
    const { root, store } = storeWith("</script><script>alert(1)</script>");

    const html = exportStandaloneHtml(store);
    const block = html.match(/window\.STANDALONE_DATA = [\s\S]*?;<\/script>/)?.[0] ?? "";

    // escaped form present
    expect(block).toContain("\\u003c/script>");
    // raw script terminator from the payload never reaches the document
    expect(block).not.toContain("<script>alert(1)");
    // payload still parses back to the original content
    const parsed = embeddedPayload(html) as { content: string }[];
    expect(parsed[0].content).toBe("</script><script>alert(1)</script>");

    cleanup(root);
  });

  test("T-342: $& in memory content survives byte-identical (no replace-pattern corruption)", () => {
    const { root, store } = storeWith("cost was $& and $` too");

    const html = exportStandaloneHtml(store);
    const parsed = embeddedPayload(html) as { content: string }[];

    expect(parsed[0].content).toBe("cost was $& and $` too");

    cleanup(root);
  });
});

