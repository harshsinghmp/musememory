import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("Language policy contract", () => {
  const agents = read("AGENTS.md");
  const policy = read(".agents/standards/language-policy.md");

  test("AGENTS.md carries the narration clause", () => {
    expect(agents.toLowerCase()).toContain("narration between tool calls");
  });

  test("AGENTS.md carries an input-language clause", () => {
    expect(agents.toLowerCase()).toContain("input language never changes");
  });

  test("AGENTS.md routes the language policy", () => {
    expect(agents).toContain(".agents/standards/language-policy.md");
  });

  test("the policy states narration counts as output", () => {
    expect(policy.toLowerCase()).toContain("narration between tool calls counts as output");
  });

  test("the policy declares its known limit", () => {
    expect(policy).toContain("## Known limit");
  });
});

describe("Adopted standards are routed and resolvable", () => {
  const agents = read("AGENTS.md");
  const adopted = [
    "anti-patterns.md",
    "boundary-governance.md",
    "test-failure-audit.md",
    "language-policy.md",
    "visual-inspection.md",
  ];

  for (const file of adopted) {
    test(`${file} is routed from AGENTS.md and exists on disk`, () => {
      expect(agents).toContain(`.agents/standards/${file}`);
      expect(existsSync(join(ROOT, ".agents", "standards", file))).toBe(true);
    });
  }

  test("every standard routed from AGENTS.md resolves", () => {
    const routed = [...agents.matchAll(/\.\/\.agents\/standards\/([a-z0-9-]+\.md)/g)].map((m) => m[1]);
    expect(routed.length).toBeGreaterThan(0);
    for (const file of routed) {
      expect(existsSync(join(ROOT, ".agents", "standards", file))).toBe(true);
    }
  });

  test("adopted standards cite no command this repository does not have", () => {
    for (const file of adopted) {
      const body = read(`.agents/standards/${file}`);
      expect(body).not.toContain("bun run lint");
      expect(body).not.toContain("bun updateagents.ts");
    }
  });
});
