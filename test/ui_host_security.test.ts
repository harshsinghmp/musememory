import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.ts";
import { startUiServer } from "../src/ui.ts";

describe("T-343: Malformed Host header handling in startUiServer", () => {
  let tmpDir: string;
  let store: ReturnType<typeof openStore>;
  let serverInstance: { port: number; close: () => void } | null = null;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-ui-host-test-"));
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

  it("returns HTTP 400 when Host header is malformed and does not crash", async () => {
    expect(serverInstance).toBeDefined();
    const port = serverInstance!.port;

    // Send request with an invalid host containing illegal characters
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: {
        Host: "[invalid:ipv6:host",
      },
    });

    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain("Bad Request: Invalid URL or Host header");
  });

  it("serves valid requests normally after receiving a malformed request", async () => {
    expect(serverInstance).toBeDefined();
    const port = serverInstance!.port;

    // 1. Malformed request
    await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { Host: "foo:bar:baz:qux" },
    });

    // 2. Normal request works cleanly
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.overall_grade).toBeDefined();
  });
});
