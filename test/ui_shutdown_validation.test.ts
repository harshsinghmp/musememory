import { describe, test, expect } from "bun:test";
import { startUiServer } from "../src/ui.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";
import { openStore, propose, confirm } from "../src/store.ts";
import { connect } from "node:net";

describe("T-360: Web Studio Socket Shutdown & Numeric Parameter Validation", () => {
  test("destroys active keep-alive sockets immediately on server close", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const srv = await startUiServer({ port: 0, memoryDir, store });

    // Open a persistent HTTP connection to simulate a keep-alive client
    const socket = connect({ port: srv.port, host: "127.0.0.1" });
    await new Promise<void>((resolve) => socket.on("connect", resolve));

    // Send HTTP Keep-Alive request
    socket.write("GET /api/current HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n");

    let socketClosed = false;
    socket.on("close", () => {
      socketClosed = true;
    });

    // Wait for response data so socket is active in server's set
    await new Promise<void>((resolve) => socket.once("data", () => resolve()));

    // Close server while socket is still active
    srv.close();

    // Verify socket was terminated
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(socketClosed).toBe(true);

    cleanup(root);
  });

  test("validates and clamps limit in /api/audit", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const srv = await startUiServer({ port: 0, memoryDir, store });

    // Test with invalid non-numeric limit (falls back to 50)
    const resFoo = await fetch(`http://localhost:${srv.port}/api/audit?limit=foo`);
    expect(resFoo.status).toBe(200);
    const dataFoo = await resFoo.json();
    expect(Array.isArray(dataFoo.trail)).toBe(true);

    // Test with negative limit (clamped to 50)
    const resNeg = await fetch(`http://localhost:${srv.port}/api/audit?limit=-10`);
    expect(resNeg.status).toBe(200);

    // Test with oversized limit (clamped to 1000)
    const resOver = await fetch(`http://localhost:${srv.port}/api/audit?limit=99999`);
    expect(resOver.status).toBe(200);

    srv.close();
    cleanup(root);
  });

  test("validates and bounds tokenBudget and limit in /api/search", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const m = propose(store, {
      title: "Test Memory for Search",
      content: "Validation of token budgeting",
      project: "test",
      type: "fix",
    });
    confirm(store, m.id);

    const srv = await startUiServer({ port: 0, memoryDir, store });

    // Passing negative or NaN tokenBudget does not throw
    const res = await fetch(`http://localhost:${srv.port}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "Validation",
        tokenBudget: -500,
        limit: -5,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.search).toBeDefined();
    expect(Array.isArray(data.search.results)).toBe(true);

    srv.close();
    cleanup(root);
  });
});
