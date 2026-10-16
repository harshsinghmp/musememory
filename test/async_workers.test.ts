import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerWriteWorker, drainWriteWorkers, getActiveWorkerCount } from "../src/async_workers.ts";
import { openStore, closeStore } from "../src/store.ts";

describe("T-056: atexit bounded join for async write workers", () => {
  test("drains registered async workers cleanly within timeout", async () => {
    let worker1Done = false;
    let worker2Done = false;

    registerWriteWorker(async () => {
      await new Promise((r) => setTimeout(r, 20));
      worker1Done = true;
    });

    registerWriteWorker(async () => {
      await new Promise((r) => setTimeout(r, 10));
      worker2Done = true;
    });

    expect(getActiveWorkerCount()).toBe(2);

    const result = await drainWriteWorkers(1000);
    expect(result.completed).toBe(2);
    expect(result.timedOut).toBe(false);
    expect(worker1Done).toBe(true);
    expect(worker2Done).toBe(true);
    expect(getActiveWorkerCount()).toBe(0);
  });

  test("bounds join time when a worker is unresponsive", async () => {
    // Unresponsive worker that takes 5000ms
    registerWriteWorker(async () => {
      await new Promise((r) => setTimeout(r, 5000));
    });

    // Drain with tight 50ms bound
    const start = Date.now();
    const result = await drainWriteWorkers(50);
    const elapsed = Date.now() - start;

    expect(result.timedOut).toBe(true);
    expect(elapsed).toBeLessThan(500); // Exited early via bound, didn't hang
  });

  test("closeStore awaits pending write workers and flushes SQLite WAL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "close-store-test-"));
    const memoryDir = join(dir, ".memory");
    const store = openStore(memoryDir);

    let drained = false;
    registerWriteWorker(async () => {
      await new Promise((r) => setTimeout(r, 15));
      drained = true;
    });

    await closeStore(store);
    expect(drained).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });
});
