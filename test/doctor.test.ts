import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { runDoctor } from "../src/doctor.ts";

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
});
