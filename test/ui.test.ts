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
});

