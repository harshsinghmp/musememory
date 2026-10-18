import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.ts";
import { startUiServer } from "../src/ui.ts";

describe("T-344: CORS & CSRF Defense Against Origin: null", () => {
  let tmpDir: string;
  let store: ReturnType<typeof openStore>;
  let serverInstance: { port: number; close: () => void } | null = null;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-ui-cors-test-"));
    store = openStore(join(tmpDir, ".memory"));
    serverInstance = await startUiServer({
      port: 0,
      memoryDir: join(tmpDir, ".memory"),
      store,
    });
  });

  afterEach(() => {
    if (serverInstance) {
      serverInstance.close();
      serverInstance = null;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects POST mutations with Origin: null with 403 Forbidden", async () => {
    expect(serverInstance).toBeDefined();
    const port = serverInstance!.port;

    const res = await fetch(`http://127.0.0.1:${port}/api/optimize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "null",
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Forbidden: Cross-Origin Request Blocked");
    expect(res.headers.get("access-control-allow-origin")).not.toBe("null");
  });

  it("does not echo Access-Control-Allow-Origin: null on GET requests", async () => {
    expect(serverInstance).toBeDefined();
    const port = serverInstance!.port;

    const res = await fetch(`http://127.0.0.1:${port}/api/memories`, {
      headers: {
        Origin: "null",
      },
    });

    expect(res.headers.get("access-control-allow-origin")).not.toBe("null");
  });

  it("allows requests from legitimate localhost origin", async () => {
    expect(serverInstance).toBeDefined();
    const port = serverInstance!.port;

    const res = await fetch(`http://127.0.0.1:${port}/api/memories`, {
      headers: {
        Origin: `http://localhost:${port}`,
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(`http://localhost:${port}`);
  });
});
