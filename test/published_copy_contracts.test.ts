import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Published-copy contracts.
 *
 * Two rules that are easy to state and easy to break:
 *
 * 1. THE COPY RULE. No user-facing surface may state a count of supported
 *    agents. The claim is "the majority of coding agents" — a number would
 *    both age badly and invite a precision the registry cannot promise.
 *    The precise count stays in `claims.json`, where it is a fact about the
 *    code rather than a promise about the market.
 *
 * 2. ONE LATENCY SOURCE. The published latency bounds live once, in
 *    `claims.json`. The hero stats and the latency chart both read them, so
 *    the page cannot quote two different numbers for the same path.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const claims = JSON.parse(readFileSync(join(ROOT, "claims.json"), "utf8"));

/** Surfaces a visitor or a social scraper actually sees. */
const USER_FACING = [
  "README.md",
  "apps/website/src/pages/index.astro",
  "apps/website/src/pages/docs.astro",
  "apps/website/src/pages/compare.astro",
  "apps/website/src/components/Footer.astro",
  "apps/website/src/components/Nav.astro",
  "apps/website/scripts/build-brand-assets.ts",
  "apps/website/scripts/build-llms-txt.ts",
  "apps/website/showreel/index.html",
];

/**
 * A count of agents, written out: `52 agents`, `52 coding agents`,
 * `52+ platforms`, `80+ agents`. The number may be any digits.
 */
const AGENT_COUNT = /\b\d+\+?\s+(?:coding\s+|AI\s+|supported\s+)?(?:agents?|platforms?)\b|\b(?:agents?|platforms?)\s*[:=]?\s*\d+\b/gi;

describe("Published-copy contracts", () => {
  describe("the copy rule: no count of supported agents", () => {
    for (const file of USER_FACING) {
      it(`${file} states coverage without a number`, () => {
        const path = join(ROOT, file);
        expect(existsSync(path)).toBe(true);
        const text = readFileSync(path, "utf8");

        // Comments and code identifiers are allowed to mention the real
        // number; only rendered copy is constrained. Strip comments and
        // string-concatenation noise before scanning.
        const prose = text
          .replace(/\/\*[\s\S]*?\*\//g, " ")
          .replace(/(^|[^:])\/\/.*$/gm, "$1 ")
          .replace(/`[^`]*`/g, (m) => (m.includes("${") ? " " : m));

        const hits = prose.match(AGENT_COUNT) ?? [];
        expect(hits).toEqual([]);
      });
    }

    it("the website makes the majority claim explicitly", () => {
      const index = readFileSync(join(ROOT, "apps/website/src/pages/index.astro"), "utf8");
      expect(index).toContain("the majority of coding agents");
    });

    it("the architecture diagram says majority, not a count", () => {
      const diagram = readFileSync(
        join(ROOT, "apps/website/src/components/figures/ArchitectureDiagram.astro"),
        "utf8",
      );
      expect(diagram).toContain("the majority of");
      expect(diagram).not.toMatch(AGENT_COUNT);
    });

    it("the showreel script says majority, not a count", () => {
      const composition = readFileSync(join(ROOT, "apps/website/showreel/index.html"), "utf8");
      expect(composition).not.toMatch(AGENT_COUNT);
    });
  });

  describe("one latency source", () => {
    it("claims.json publishes the latency bounds once", () => {
      expect(claims.latency).toBeDefined();
      expect(claims.latency.hotCacheMicros).toBe(50);
      expect(claims.latency.recallMillis).toBe(2);
      expect(claims.latency.semanticMillis).toBe(4);
      expect(claims.latency.networkMillis).toBe(300);
    });

    it("the latency chart reads the bounds from the manifest", () => {
      const chart = readFileSync(
        join(ROOT, "apps/website/src/components/figures/LatencyChart.astro"),
        "utf8",
      );
      for (const key of ["hotCacheMicros", "recallMillis", "semanticMillis", "networkMillis"]) {
        expect(chart).toContain(`claims.latency.${key}`);
      }
    });

    it("the hero stats read the bounds from the manifest", () => {
      const index = readFileSync(join(ROOT, "apps/website/src/pages/index.astro"), "utf8");
      expect(index).toContain("claims.latency.recallMillis");
      expect(index).toContain("claims.latency.hotCacheMicros");
    });

    it("no surface hardcodes a latency bound that the manifest owns", () => {
      const index = readFileSync(join(ROOT, "apps/website/src/pages/index.astro"), "utf8");
      // The literal "sub-2ms" would be a second source for the same claim.
      expect(index).not.toContain('"sub-2ms"');
      expect(index).not.toContain('"<50µs"');
    });
  });

  describe("the showreel is a new composition", () => {
    it("lives at its own path and no longer references the retired one", () => {
      expect(existsSync(join(ROOT, "apps/website/showreel/index.html"))).toBe(true);
      expect(existsSync(join(ROOT, "apps/website/showreel-hf"))).toBe(false);

      for (const file of [
        "apps/website/scripts/build-showreel.ts",
        "apps/website/scripts/build-brand-assets.ts",
        ".github/workflows/pages.yml",
      ]) {
        const text = readFileSync(join(ROOT, file), "utf8");
        expect(text).not.toContain("showreel-hf");
      }
    });

    it("uses the shared font assets, not a private copy", () => {
      const brand = readFileSync(join(ROOT, "apps/website/scripts/build-brand-assets.ts"), "utf8");
      expect(brand).toContain("../src/assets/fonts");
      expect(existsSync(join(ROOT, "apps/website/src/assets/fonts/inter-var.woff2"))).toBe(true);
    });
  });
});
