import { describe, test, expect } from "bun:test";
import { openStore, propose, confirm, supersede, get } from "../src/store.ts";
import { search } from "../src/search.ts";
import { validateStore } from "../src/schema.ts";
import { getGraphStatus } from "../src/graph.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";

describe("mcp tool handlers logic", () => {
  test("get_context and search with filters", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const ctx = search(store, memoryDir, "deploy", { type: "operation", status: "confirmed" });
    expect(ctx.results.length).toBeGreaterThan(0);
    expect(ctx.results[0].entry.id).toBe("m_1700000004000_newdeploy");

    const searchRes = search(store, memoryDir, "deploy", { includeSuperseded: true });
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
});
