import { describe, test, expect } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openStore } from "../src/store.ts";
import { startUiServer } from "../src/ui.ts";
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
    // v2 markers
    expect(html).toContain("timelineSlider");
    expect(html).toContain("clusterFilters");
    expect(html).toContain("simulateStep");
    expect(html).toContain("project(");      // perspective projection
    expect(html).toContain("rotY");          // drag-to-rotate state
    expect(html).toContain("wheel");         // zoom
    expect(html).toContain("TYPE_COLORS");   // color by type
    expect(html).toContain("degree");        // size by degree
    expect(html).toContain("nodeVisible");   // filter gating
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
    expect(html).toContain("No memories yet"); // empty-graph guard message
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

