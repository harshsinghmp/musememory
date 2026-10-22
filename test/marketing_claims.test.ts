import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_REGISTRY } from "../src/agents/registry.ts";
import { PROFILE_TOOL_DEFINITIONS } from "../src/orchestrator/profiles.ts";
import { PROVIDER_DEFINITIONS } from "../src/migrator/detect.ts";
import { SECRET_RULES } from "../src/secrets.ts";

/**
 * T-NEW: Published-claim integrity.
 *
 * The website once advertised "80+ coding agents", "45+ credential shapes" and
 * "69 tools across 6 profiles". Reality was 52 agents, 8 credential rule
 * families and 112 tools across 7 profiles — and nothing failed, because every
 * number was hand-typed into prose in five different files.
 *
 * This test closes that hole:
 *   1. `claims.json` must equal a live re-derivation from `src/`.
 *   2. The generated MCP tool matrix must list only real, registered tools.
 *   3. The README and the website must not contain a superseded number.
 *
 * The numbers in prose are still hand-typed (a README cannot import JSON and
 * still render on npmjs.com), so the third rule is what actually guards the
 * prose: any stale figure fails the build.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const claims = JSON.parse(readFileSync(join(ROOT, "claims.json"), "utf8"));
const toolMatrix = JSON.parse(readFileSync(join(ROOT, "docs/mcp-tool-matrix.json"), "utf8"));

function registeredToolNames(): Set<string> {
  const src = readFileSync(join(ROOT, "src/mcp.ts"), "utf8");
  return new Set(
    [...src.matchAll(/name:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]!).filter((n) => n !== "musememory"),
  );
}

describe("Published-claim integrity", () => {
  describe("claims.json is derived from source", () => {
    it("mcpTools equals the number of tools registered in src/mcp.ts", () => {
      expect(claims.mcpTools).toBe(registeredToolNames().size);
    });

    it("mcpProfiles equals the number of task profiles", () => {
      expect(claims.mcpProfiles).toBe(Object.keys(PROFILE_TOOL_DEFINITIONS).length);
    });

    it("agentPlatforms equals the size of the agent registry", () => {
      expect(claims.agentPlatforms).toBe(AGENT_REGISTRY.length);
    });

    it("migratorProviders equals the number of supported import formats", () => {
      expect(claims.migratorProviders).toBe(PROVIDER_DEFINITIONS.length);
    });

    it("credentialRuleFamilies equals the number of Vibeguard secret rules", () => {
      expect(claims.credentialRuleFamilies).toBe(SECRET_RULES.length);
    });

    it("version tracks package.json", () => {
      const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
      expect(claims.version).toBe(pkg.version);
    });

    it("test file count is at least the number of files on disk", () => {
      expect(claims.tests.files).toBeGreaterThan(0);
      expect(claims.tests.count).toBeGreaterThan(0);
    });
  });

  describe("generated MCP tool matrix", () => {
    it("lists exactly the registered tools", () => {
      const registered = registeredToolNames();
      expect(toolMatrix.count).toBe(registered.size);
      expect(new Set(toolMatrix.tools).size).toBe(toolMatrix.tools.length);
    });

    it("contains no tool name that is not registered", () => {
      const registered = registeredToolNames();
      const bogus = toolMatrix.tools.filter((t: string) => !registered.has(t));
      expect(bogus).toEqual([]);
    });

    it("contains no registered tool that is missing from the matrix", () => {
      const listed = new Set<string>(toolMatrix.tools);
      const missing = [...registeredToolNames()].filter((t) => !listed.has(t));
      expect(missing).toEqual([]);
    });
  });

  describe("published prose contains no superseded figures", () => {
    const proseFiles = [
      "README.md",
      "apps/website/src/pages/index.astro",
      "apps/website/src/pages/docs.astro",
      "apps/website/src/pages/compare.astro",
    ];

    // Each entry is a figure that was published and is now wrong, with the
    // value that replaced it. New superseded figures should be added here.
    const superseded: Array<{ pattern: RegExp; because: string }> = [
      { pattern: /80\+\s+(?:AI\s+)?tools\b/i, because: "there are 52 agent platforms, not 80+" },
      { pattern: /80\+\s+platforms/i, because: "there are 52 agent platforms, not 80+" },
      { pattern: /45\+\s+credential/i, because: "there are 8 credential rule families, not 45+" },
      { pattern: /\b69\s+tools\b/i, because: "there are 112 MCP tools, not 69" },
      { pattern: /\b61\s+Tools\b/i, because: "there are 112 MCP tools, not 61" },
      { pattern: /6\s+task[- ]focused\s+profiles/i, because: "there are 7 profiles (core, coding, debugging, review, architecture, maintenance, full)" },
      { pattern: /\b29\s+(?:external\s+)?memory\s+(?:formats?|engines?)/i, because: "there are 30 import formats, not 29" },
      { pattern: /29\s+Engines/i, because: "there are 30 import formats, not 29" },
    ];

    for (const file of proseFiles) {
      it(`${file} has no stale published figure`, () => {
        const path = join(ROOT, file);
        expect(existsSync(path)).toBe(true);
        const text = readFileSync(path, "utf8");
        const hits = superseded
          .filter((s) => s.pattern.test(text))
          .map((s) => s.because);
        expect(hits).toEqual([]);
      });
    }

    it("the README states coverage without publishing a count", () => {
      // The copy rule: no user-facing surface may state how many agents are
      // supported. The claim is "the majority of coding agents".
      const text = readFileSync(join(ROOT, "README.md"), "utf8");
      expect(text).toContain("the majority of coding agents");
      expect(text).not.toMatch(/\b\d+\+?\s+(?:coding\s+)?(?:agents?|platforms?)\b/i);
    });

    it("the README states the verified import-format count", () => {
      const text = readFileSync(join(ROOT, "README.md"), "utf8");
      expect(text).toContain(`${claims.migratorProviders} Engines`);
    });

    it("the website reads its counts from the claims manifest, not from prose", () => {
      // The site interpolates from `claims.json`, so the assertion is that
      // the binding is used — a hardcoded number in the page would drift the
      // moment the manifest is regenerated.
      const docs = readFileSync(join(ROOT, "apps/website/src/pages/docs.astro"), "utf8");
      expect(docs).toContain('import claims from "../../../../claims.json"');
      expect(docs).toContain("${claims.mcpTools} tools total");
      expect(docs).toContain("${claims.mcpProfiles} task-focused profiles");

      const index = readFileSync(join(ROOT, "apps/website/src/pages/index.astro"), "utf8");
      expect(index).toContain('import claims from "../../../../claims.json"');
      expect(index).toContain("claims.migratorProviders");
      expect(index).toContain("claims.mcpTools");
      expect(index).toContain("claims.tests.count");
      expect(index).toContain("claims.latency.recallMillis");
      // The agent count is deliberately NOT published anywhere on the site:
      // the claim is "the majority of coding agents".
      expect(index).not.toContain("claims.agentPlatforms");
      expect(index).not.toContain("claims.credentialRuleFamilies");
    });

    it("the site's version display comes from the manifest, not from prose", () => {
      // The version appears in the hero kicker, the footer, the Open Graph
      // softwareVersion and the comparison note. A release bump that misses
      // one of them leaves the site advertising a version that is not
      // published — so all four read from claims.json.
      const index = readFileSync(join(ROOT, "apps/website/src/pages/index.astro"), "utf8");
      expect(index).toContain("softwareVersion: claims.version");
      expect(index).toContain("v{claims.version}");
      expect(index).not.toContain('softwareVersion: "3.');

      const footer = readFileSync(join(ROOT, "apps/website/src/components/Footer.astro"), "utf8");
      expect(footer).toContain("v{claims.version}");

      const compare = readFileSync(join(ROOT, "apps/website/src/pages/compare.astro"), "utf8");
      expect(compare).toContain("Muse row reflects v{claims.version}");
    });
  });

  describe("agent-facing docs name only real tools", () => {
    // .agents/context/product.md is the file an agent is most likely to read
    // to learn the tool surface. It listed six tool names that do not exist
    // (memory_capture_negative, memory_promote_scope, profile_list,
    // memory_search, memory_propose, memory_conflicts) — a hallucination
    // generator for any agent that trusted it.
    const agentDocs = [".agents/context/product.md", "docs/agent-reference.md"];

    for (const file of agentDocs) {
      it(`${file} references only registered MCP tools`, () => {
        const text = readFileSync(join(ROOT, file), "utf8");
        const registered = registeredToolNames();

        // Only tokens with a tool-shaped prefix are candidates. A doc also
        // names non-tool identifiers with underscores (deleted_at,
        // keep_both, fail_fast, withheld_memories, freshness_notice) and
        // those are legitimate.
        const TOOL_SHAPED = /^(?:muse|memory|graph)_[a-z0-9_]+$/;
        const candidates = new Set(
          [...text.matchAll(/`([a-z][a-z0-9_]*)`/g)]
            .map((m) => m[1]!)
            .filter((c) => TOOL_SHAPED.test(c)),
        );
        const bogus = [...candidates].filter((c) => !registered.has(c));
        expect(bogus).toEqual([]);
      });
    }
  });
});
