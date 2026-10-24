import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { setupFixtureRoot, cleanup } from "./helpers.ts";

const BIN = join(import.meta.dir, "..", "bin", "memory.ts");

function run(root: string, args: string[]): { stdout: string; stderr: string; code: number } {
  const res = spawnSync("bun", [BIN, ...args], { cwd: root, encoding: "utf8" });
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", code: res.status ?? -1 };
}

describe("T-320: memory conflicts CLI", () => {
  test("lists open conflicts and previews potential ones without mutating", () => {
    const { root } = setupFixtureRoot();

    try {
      // Two genuinely contradictory memories.
      const a = run(root, [
        "propose",
        "The wiki recompile gate is enabled",
        "--project",
        "core",
        "--title",
        "Wiki recompile gate",
      ]);
      expect(a.code).toBe(0);
      const idA = a.stdout.match(/created (m_\d+_\w+)/)?.[1];
      expect(idA).toBeDefined();

      const b = run(root, [
        "propose",
        "The wiki recompile gate is disabled",
        "--project",
        "core",
        "--title",
        "Wiki recompile gate",
      ]);
      const idB = b.stdout.match(/created (m_\d+_\w+)/)?.[1];
      expect(idB).toBeDefined();

      run(root, ["confirm", idA!]);
      run(root, ["confirm", idB!]);

      // Dry run reports the pair that would be flagged.
      const dry = run(root, ["conflicts", "--dry-run", "--project", "core"]);
      expect(dry.code).toBe(0);
      expect(dry.stdout).toContain("Potential pairs:");
      expect(dry.stdout).toContain("Opposing configuration polarity");

      // The scan is read-only: nothing was flagged.
      const listed = run(root, ["conflicts", "--project", "core", "--json"]);
      expect(listed.code).toBe(0);
      const payload = JSON.parse(listed.stdout);
      expect(payload.open).toHaveLength(0);
    } finally {
      cleanup(root);
    }
  });
});
