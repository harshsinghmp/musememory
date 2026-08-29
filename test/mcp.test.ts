import { describe, test, expect } from "bun:test";
import { openStore, propose, confirm, supersede, get } from "../src/store.ts";
import { queryContext } from "../src/retrieval.ts";
import { validateStore } from "../src/schema.ts";
import { getGraphStatus } from "../src/graph.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";

describe("mcp tool handlers logic", () => {
  test("get_context and search with filters", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const ctx = queryContext(store, "deploy", { type: "operation", status: "confirmed" });
    expect(ctx.results.length).toBeGreaterThan(0);
    expect(ctx.results[0].entry.id).toBe("m_1700000004000_newdeploy");

    const searchRes = queryContext(store, "deploy", { includeSuperseded: true });
    expect(searchRes.results.some((r) => r.entry.status === "superseded")).toBe(true);
    cleanup(root);
  });

  test("propose and confirm via store", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const created = propose(store, { content: "New insight", project: "aria", type: "discovery" });
    expect(created.status).toBe("candidate");
    expect(created.type).toBe("discovery");

    const confirmed = confirm(store, created.id);
    expect(confirmed).not.toBeNull();
    expect(confirmed!.status).toBe("confirmed");
    expect(confirmed!.verification?.level).toBe("user-confirmed");
    cleanup(root);
  });

  test("supersede via store", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const oldEntry = propose(store, { content: "Old insight", project: "aria", confirmed: true });
    const newEntry = propose(store, { content: "New insight", project: "aria", confirmed: true });

    const superseded = supersede(store, oldEntry.id, newEntry.id);
    expect(superseded).not.toBeNull();
    expect(superseded!.status).toBe("superseded");
    expect(get(store, newEntry.id)!.supersedes).toEqual([oldEntry.id]);
    cleanup(root);
  });

  test("memory_validate and graph_status handlers", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const val = validateStore(store);
    expect(val.isValid).toBe(true);

    const graph = getGraphStatus(root);
    expect(graph.provider).toBe("none");
    expect(graph.available).toBe(false);
    cleanup(root);
  });

  test("memory_detect_providers and memory_migrate handlers", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const { detectProviders, runMigration } = await import("../src/migrator/index.ts");

    const detected = detectProviders(root);
    expect(Array.isArray(detected)).toBe(true);

    const report = await runMigration(store, memoryDir, { dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(Array.isArray(report.providers)).toBe(true);
    cleanup(root);
  });

  test("memory_detect_agents and memory_connect handlers", async () => {
    const { root } = setupFixtureRoot();
    const { detectAgents } = await import("../src/agents/detect.ts");
    const { connectAgent } = await import("../src/connect.ts");

    const agents = detectAgents();
    expect(Array.isArray(agents)).toBe(true);
    expect(agents.length).toBeGreaterThan(40);

    const reports = connectAgent("claude-code", root, { dryRun: true });
    expect(Array.isArray(reports)).toBe(true);
    expect(reports[0].agent).toBe("claude-code");
    cleanup(root);
  });

  test("formatPromptContext structures USER.md, constraints, and proactive reflection directive", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const { formatPromptContext } = await import("../src/retrieval.ts");
    const { setUserProfile } = await import("../src/user.ts");
    const { setCurrent } = await import("../src/current.ts");

    setUserProfile(memoryDir, "# Developer Persona\n- Strict TypeScript\n- Direct answers");
    setCurrent(memoryDir, "Always verify build before committing.", "core");

    const formatted = formatPromptContext(store, memoryDir, "deploy", { project: "aria" });
    expect(formatted.markdown).toContain("### User Profile & Preferences (USER.md)");
    expect(formatted.markdown).toContain("Strict TypeScript");
    expect(formatted.markdown).toContain("### Active Working Constraints (CURRENT.md)");
    expect(formatted.markdown).toContain("Always verify build before committing.");
    expect(formatted.markdown).toContain("Memory Directive: When learning durable facts");

    cleanup(root);
  });

  test("wiki, entities, pageindex, and settings handlers logic", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const { compileWiki, listWikiPages, getWikiPage } = await import("../src/wiki/index.ts");
    const { extractEntitiesFromMemories, saveEntities, loadEntities, findEntity } = await import("../src/entities/index.ts");
    const { buildPageIndex, searchPageIndex, deletePageIndex } = await import("../src/pageindex/index.ts");
    const { getSettings, setSettings, getProjectSettings, setProjectSettings } = await import("../src/settings.ts");

    // 1. Wiki
    const wikiRes = compileWiki(store, memoryDir, { dryRun: true });
    expect(Array.isArray(wikiRes.pagesCreated)).toBe(true);

    // 2. Entities
    const mems = (await import("../src/store.ts")).list(store);
    const entRes = extractEntitiesFromMemories(mems);
    expect(Array.isArray(entRes.entities)).toBe(true);

    // 3. PageIndex
    const doc = buildPageIndex("# Arch\n## Subtopic\nDetails here", { project: "test", memoryDir, dryRun: true });
    const pSearch = searchPageIndex(doc, { query: "Subtopic" });
    expect(pSearch.results.length).toBeGreaterThan(0);

    // 4. Settings
    const s = getSettings(memoryDir);
    expect(s.retrieval.defaultMode).toBe("hybrid");
    setSettings(memoryDir, { ui: { ...s.ui, theme: "dark" } });
    expect(getSettings(memoryDir).ui.theme).toBe("dark");

    cleanup(root);
  });

  test("constraint proposing auto-syncs to CURRENT.md and memory_current reads/writes", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const { getCurrent, setCurrent } = await import("../src/current.ts");

    // Proposing a constraint automatically updates CURRENT.md
    const constraintEntry = propose(store, {
      content: "All API responses must be gzip encoded",
      project: "gateway",
      type: "constraint",
      confirmed: true,
    });
    expect(constraintEntry.type).toBe("constraint");

    const lines = getCurrent(memoryDir);
    expect(lines.some((l) => l.includes("All API responses must be gzip encoded"))).toBe(true);

    // Direct setCurrent append
    setCurrent(memoryDir, "Use strict semantic versioning", "gateway");
    const updatedLines = getCurrent(memoryDir);
    expect(updatedLines.some((l) => l.includes("Use strict semantic versioning"))).toBe(true);

    cleanup(root);
  });

  test("ensureProjectAgentInstructions writes and updates AGENTS.md with Muse Memory directive", async () => {
    const { ensureProjectAgentInstructions, MUSE_MEMORY_DIRECTIVE } = await import("../src/cli/ecosystem.ts");
    const { mkdtempSync, rmSync, readFileSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const testDir = mkdtempSync(join(tmpdir(), "muse-inst-test-"));

    // 1. Fresh directory: creates AGENTS.md
    ensureProjectAgentInstructions(testDir);
    const created = readFileSync(join(testDir, "AGENTS.md"), "utf8");
    expect(created).toContain("<!-- musememory:start -->");
    expect(created).toContain("get_context");

    // 2. Existing AGENTS.md with legacy agentmemory: replaces it cleanly
    writeFileSync(
      join(testDir, "AGENTS.md"),
      "# System Rules\n\n<!-- agentmemory:start -->\nOld agentmemory instructions\n<!-- agentmemory:end -->\n\n## Other rules",
      "utf8",
    );
    ensureProjectAgentInstructions(testDir);
    const replaced = readFileSync(join(testDir, "AGENTS.md"), "utf8");
    expect(replaced).not.toContain("agentmemory:start");
    expect(replaced).toContain("<!-- musememory:start -->");
    expect(replaced).toContain("## Other rules");

    rmSync(testDir, { recursive: true, force: true });
  });
});
