import { describe, test, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateWorkspaceTerrain, writeWorkspaceTerrain } from "../src/vault/index.ts";

const TERRAIN = ["repo.md", "stack.md", "habits.md", "ownership.md", "packages.md", "logs.md"];

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "muse-terrain-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "fixture-workspace",
      version: "1.2.3",
      private: true,
      author: "Fixture Owner <owner@example.com>",
      contributors: ["Second Person <second@example.com>"],
      dependencies: { zod: "^3.0.0" },
      devDependencies: { "bun-types": "^1.0.0" },
      scripts: { test: "bun test", lint: "tsc --noEmit" },
      engines: { bun: ">=1.0.0" },
      workspaces: ["packages/*"],
    }),
    "utf8",
  );
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n", "utf8");
  mkdirSync(join(root, "packages", "core"), { recursive: true });
  writeFileSync(
    join(root, "packages", "core", "package.json"),
    JSON.stringify({ name: "@fixture/core", version: "0.1.0" }),
    "utf8",
  );
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "index.ts"), "export const x = 1;\n", "utf8");
  mkdirSync(join(root, "test"), { recursive: true });
  writeFileSync(join(root, "test", "sample.test.ts"), "// fixture\n", "utf8");
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, ".github", "workflows", "ci.yml"), "name: CI\n", "utf8");
  writeFileSync(join(root, "CODEOWNERS"), "* @fixture-owner\n", "utf8");
  writeFileSync(join(root, "AGENTS.md"), "# Fixture contract\n", "utf8");
  writeFileSync(join(root, ".gitignore"), "node_modules\n", "utf8");
  writeFileSync(join(root, "bun.lock"), "", "utf8");
  return root;
}

describe("T-457: workspace terrain generator", () => {
  test("emits the six deterministic maps", () => {
    const root = fixture();
    try {
      const first = generateWorkspaceTerrain(root);
      expect(first.files.map((f) => f.name)).toEqual(TERRAIN);

      const byName = Object.fromEntries(first.files.map((f) => [f.name, f.content]));
      expect(byName["repo.md"]).toContain("fixture-workspace");
      expect(byName["repo.md"]).toContain("`src/`");
      expect(byName["repo.md"]).toContain("| `.ts` |");
      expect(byName["stack.md"]).toContain("`zod`");
      expect(byName["stack.md"]).toContain("bun >=1.0.0");
      expect(byName["stack.md"]).toContain("`test`");
      expect(byName["habits.md"]).toContain("`ci.yml`");
      expect(byName["habits.md"]).toContain("`AGENTS.md`");
      expect(byName["habits.md"]).toContain("Test files: 1");
      expect(byName["ownership.md"]).toContain("Fixture Owner");
      expect(byName["ownership.md"]).toContain("* @fixture-owner");
      expect(byName["packages.md"]).toContain("@fixture/core");
      expect(byName["logs.md"]).toContain("No git history available.");

      // Same checkout, same bytes — no timestamps or unsorted keys.
      const second = generateWorkspaceTerrain(root);
      expect(second.files).toEqual(first.files);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("writes all six maps to the requested directory", () => {
    const root = fixture();
    const outDir = join(root, ".memory", "terrain");
    try {
      const result = writeWorkspaceTerrain(root, outDir);
      expect(result.files.length).toBe(6);
      for (const name of TERRAIN) {
        const path = join(outDir, name);
        expect(existsSync(path)).toBe(true);
        expect(readFileSync(path, "utf8").length).toBeGreaterThan(0);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
