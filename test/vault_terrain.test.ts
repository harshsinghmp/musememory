import { describe, test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateWorkspaceTerrain } from "../src/vault/index.ts";
import { scanSecrets } from "../src/secrets.ts";
import { estimateTokens } from "../src/compress.ts";

const SECRET = "sk-live-abcdefghijklmnopqrstuvwx";
const MAPS = ["repo.md", "stack.md", "habits.md", "ownership.md", "packages.md", "logs.md"];

function fixture(): { root: string; raw: string[] } {
  const root = mkdtempSync(join(tmpdir(), "muse-terrain-bench-"));
  const raw: string[] = [];

  const pkg = JSON.stringify({
    name: "bench-workspace",
    version: "1.0.0",
    author: "Bench Owner <bench@example.com>",
    scripts: {
      test: "bun test",
      deploy: `API_KEY=${SECRET} bun run deploy`,
    },
    dependencies: { zod: "^3.0.0" },
    devDependencies: { typescript: "^5.0.0" },
  });
  writeFileSync(join(root, "package.json"), pkg, "utf8");
  raw.push(pkg);

  const agents = "# Bench contract\n\nUse bun. Run tests before commits.\n";
  writeFileSync(join(root, "AGENTS.md"), agents, "utf8");
  raw.push(agents);

  mkdirSync(join(root, "src"), { recursive: true });
  for (let i = 0; i < 40; i++) {
    const body = `// module ${i}\nexport function handler${i}(input: string): string {\n  const normalized = input.trim().toLowerCase();\n  return normalized + "-${i}";\n}\n\nexport const META_${i} = { index: ${i}, owner: "bench" };\n`;
    writeFileSync(join(root, "src", `module_${i}.ts`), body, "utf8");
    raw.push(body);
  }

  const leaky = `export const token = "${SECRET}";\n`;
  writeFileSync(join(root, "src", "leaky.ts"), leaky, "utf8");
  raw.push(leaky);

  return { root, raw };
}

describe("T-459: terrain token efficiency and secret safety", () => {
  test("maps are deterministic and far smaller than the raw corpus", () => {
    const { root, raw } = fixture();
    try {
      const first = generateWorkspaceTerrain(root);
      const second = generateWorkspaceTerrain(root);
      expect(first.files.map((f) => f.name)).toEqual(MAPS);
      expect(second.files).toEqual(first.files);

      const terrainTokens = first.files.reduce((sum, file) => sum + estimateTokens(file.content), 0);
      const rawTokens = raw.reduce((sum, text) => sum + estimateTokens(text), 0);

      expect(rawTokens).toBeGreaterThan(1000);
      expect(terrainTokens).toBeGreaterThan(0);
      // The point of the vault is orientation at a fraction of the token cost.
      expect(terrainTokens).toBeLessThan(rawTokens * 0.5);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("no map leaks a credential-shaped string", () => {
    const { root } = fixture();
    try {
      const terrain = generateWorkspaceTerrain(root);
      for (const file of terrain.files) {
        expect(scanSecrets(file.content)).toEqual([]);
        expect(file.content).not.toContain(SECRET);
      }
      const stack = terrain.files.find((file) => file.name === "stack.md");
      expect(stack?.content).toContain("[REDACTED_SECRET]");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
