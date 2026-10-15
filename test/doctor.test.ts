import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { runDoctor } from "../src/doctor.ts";
import { openStore, getStorageLayout } from "../src/store.ts";
import { openDatabase } from "../src/sqlite.ts";
import { LATEST_SCHEMA_VERSION } from "../src/migrate.ts";

describe("musememory doctor diagnostic engine", () => {
  test("runDoctor inspects uninitialized directory and reports status", async () => {
    const tempDir = join(tmpdir(), `muse-doc-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    const report = await runDoctor(tempDir);
    expect(report.storage.initialized).toBe(true);
    expect(report.validation.valid).toBe(true);
    expect(report.runtime.nodeVersion).toBeDefined();
    expect(report.agents.detectedInstalled).toBeGreaterThanOrEqual(0);

    rmSync(tempDir, { recursive: true, force: true });
  });

  test("runDoctor reports store schema version against the code's LATEST_SCHEMA_VERSION (T-368)", async () => {
    const tempDir = join(tmpdir(), `muse-doc-ver-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    // A store opened by this build is stamped to LATEST by openStore's runMigrations().
    const resolved = await runDoctor(tempDir);
    openStore(resolved.storage.path);
    const fresh = await runDoctor(tempDir);
    expect(fresh.schema.storeVersion).toBe(LATEST_SCHEMA_VERSION);
    expect(fresh.schema.codeVersion).toBe(LATEST_SCHEMA_VERSION);
    expect(fresh.schema.upToDate).toBe(true);

    // Simulate a store stamped by an older build: migrations run at doctor startup,
    // so the mismatch has to be read from disk *before* that open, or it is invisible.
    const raw = openDatabase(getStorageLayout(fresh.storage.path).dbPath);
    raw.exec(`PRAGMA user_version = 0`);
    raw.close();

    const stale = await runDoctor(tempDir);
    expect(stale.schema.storeVersion).toBe(0);
    expect(stale.schema.codeVersion).toBe(LATEST_SCHEMA_VERSION);
    expect(stale.schema.upToDate).toBe(false);

    rmSync(tempDir, { recursive: true, force: true });
  });
});
