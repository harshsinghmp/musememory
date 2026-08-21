import { describe, test, expect } from "bun:test";
import { openStore, propose } from "../src/store.ts";
import { startUiServer } from "../src/ui.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";

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
});
