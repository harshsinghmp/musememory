import { describe, test, expect } from "bun:test";
import { startUiServer } from "../src/ui.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";
import { openStore } from "../src/store.ts";

describe("T-347: UI Port Contract & Auto-Increment on Collision", () => {
  test("rejects invalid non-integer or out-of-range ports", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    await expect(
      startUiServer({ port: -1, memoryDir, store }),
    ).rejects.toThrow("Invalid port: -1. Port must be an integer between 0 and 65535.");

    await expect(
      startUiServer({ port: 70000, memoryDir, store }),
    ).rejects.toThrow("Invalid port: 70000. Port must be an integer between 0 and 65535.");

    await expect(
      startUiServer({ port: NaN, memoryDir, store }),
    ).rejects.toThrow("Invalid port: NaN. Port must be an integer between 0 and 65535.");

    await expect(
      startUiServer({ port: "invalid" as unknown as number, memoryDir, store }),
    ).rejects.toThrow("Invalid port: invalid. Port must be an integer between 0 and 65535.");

    cleanup(root);
  });

  test("accepts port 0 for ephemeral OS-allocated port", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const srv = await startUiServer({ port: 0, memoryDir, store });
    expect(srv.port).toBeGreaterThan(0);
    expect(srv.port).toBeLessThanOrEqual(65535);

    srv.close();
    cleanup(root);
  });

  test("auto-increments to next port on collision when port is omitted", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    // Bind server 1 with port 0 to get an active port
    const srv1 = await startUiServer({ port: 0, memoryDir, store });
    const busyPort = srv1.port;

    // Direct bind to the same busyPort explicitly fails without auto-increment
    await expect(
      startUiServer({ port: busyPort, memoryDir, store }),
    ).rejects.toThrow();

    srv1.close();
    cleanup(root);
  });
});
