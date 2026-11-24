import { describe, test, expect, afterEach, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCachedStore } from "../src/mcp.ts";
import { openStore } from "../src/store.ts";

/**
 * #432: every MCP request carrying a `dir` used to call `openStore` again and
 * nothing ever closed the result — two file descriptors per request. At the fd
 * limit `openDatabase` throws EMFILE, `openStore` swallows it, and every tool
 * silently degrades to YAML-only while reporting success. These tests pin the
 * cache that fixes that, and the loud log that stops the degradation hiding.
 */
describe("#432: MCP stores are cached per memory directory", () => {
  const created: string[] = [];

  function tempMemoryDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "muse-store-cache-"));
    created.push(dir);
    return join(dir, ".memory");
  }

  afterEach(() => {
    for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  test("two lookups with the same memoryDir return the same Store instance", () => {
    const memoryDir = tempMemoryDir();
    const first = getCachedStore(memoryDir);
    const second = getCachedStore(memoryDir);
    expect(second).toBe(first);
  });

  test("50 lookups do not grow the process fd count", () => {
    if (process.platform !== "linux") return; // /proc/self/fd is Linux-only
    const memoryDir = tempMemoryDir();
    // Warm the cache first: the one open the cache is allowed to do is not the
    // leak under test, the 50 lookups after it are.
    getCachedStore(memoryDir);
    const countFds = () => readdirSync("/proc/self/fd").length;
    countFds(); // burn the transient fd that reading the directory itself needs
    const before = countFds();
    for (let i = 0; i < 50; i++) getCachedStore(memoryDir);
    const after = countFds();
    // Uncached, this used to be +100 (a SQLite handle plus its WAL per call).
    expect(after - before).toBeLessThanOrEqual(2);
  });

  test("different directories return different stores", () => {
    const a = tempMemoryDir();
    const b = tempMemoryDir();
    expect(getCachedStore(a)).not.toBe(getCachedStore(b));
    expect(getCachedStore(a)).toBe(getCachedStore(a));
    expect(getCachedStore(b)).toBe(getCachedStore(b));
  });

  test("a failed SQLite open says so — once per database path", () => {
    const memoryDir = tempMemoryDir();
    // `openDatabase` creates the parent dir but cannot open a *directory* as the
    // database file, which is exactly the "SQLite is unavailable" shape a
    // degraded store falls back from.
    mkdirSync(join(memoryDir, "memory.db"), { recursive: true });

    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const store = openStore(memoryDir);
      expect(store.db).toBeUndefined();
      openStore(memoryDir);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const message = String(errorSpy.mock.calls[0]?.[0] ?? "");
      expect(message).toContain("DEGRADED YAML-ONLY mode");
      expect(message).toContain(join(memoryDir, "memory.db"));
      expect(message).toContain("Reason:");
    } finally {
      errorSpy.mockRestore();
    }
  });
});
