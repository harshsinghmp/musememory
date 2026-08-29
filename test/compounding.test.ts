import { describe, test, expect } from "bun:test";
import { openStore, propose } from "../src/store.ts";
import { compileKnowledge, clusterByTokenOverlap, dominantTopicTokens, tokenBag, cosineSimilarity } from "../src/compounding/index.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("Unified Knowledge Compounding Engine", () => {
  test("shared clustering core clusters items by token overlap accurately", () => {
    const items = [
      { id: "1", text: "React state management with Redux" },
      { id: "2", text: "React UI components and Redux toolkit" },
      { id: "3", text: "PostgreSQL database migrations and index optimization" },
      { id: "4", text: "PostgreSQL connection pooling and database tuning" },
    ];

    const clusters = clusterByTokenOverlap(
      items,
      (item) => tokenBag(item.text),
      0.3,
    );

    expect(clusters.length).toBe(2);
    expect(clusters[0].map((i) => i.id).sort()).toEqual(["1", "2"]);
    expect(clusters[1].map((i) => i.id).sort()).toEqual(["3", "4"]);
  });

  test("dominantTopicTokens picks top descriptive non-stopwords", () => {
    const titles = [
      "Postgres connection timeout bug",
      "Postgres connection pool exhaustion",
      "Postgres idle client cleanup",
    ];
    const dominant = dominantTopicTokens(titles, 2);
    expect(dominant).toContain("postgres");
    expect(dominant).toContain("connection");
  });

  test("compileKnowledge generates both Obsidian wiki and JSON entity graph in one pass", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    propose(store, {
      title: "React Query caching policy",
      content: "Use React Query for client state caching @alice reviewed the pull request.",
      project: "frontend",
      type: "architecture",
      confirmed: true,
    });

    propose(store, {
      title: "React suspense fallback",
      content: "Always wrap React async components in Suspense with Skeleton loading.",
      project: "frontend",
      type: "architecture",
      confirmed: true,
    });

    propose(store, {
      title: "React hydration error workaround",
      content: "Fix React SSR hydration error by disabling ssr for local storage hook.",
      project: "frontend",
      type: "fix",
      confirmed: true,
    });

    const report = compileKnowledge(store, memoryDir, { minClusterSize: 2 });
    expect(report.wiki.pagesCreated.length).toBeGreaterThanOrEqual(1);
    expect(report.entities.entities.length).toBeGreaterThanOrEqual(1);

    // Verify Obsidian wiki files were written
    expect(existsSync(join(memoryDir, "wiki", "index.md"))).toBe(true);

    // Verify entity JSON graph was written
    expect(existsSync(join(memoryDir, "entities.json"))).toBe(true);
    const entitiesJson = JSON.parse(readFileSync(join(memoryDir, "entities.json"), "utf8"));
    expect(entitiesJson.some((e: any) => e.name.toLowerCase() === "react")).toBe(true);

    cleanup(root);
  });

  test("compileKnowledge isolates entity extraction when project filter is provided", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    propose(store, {
      title: "Alpha database schema",
      content: "Alpha project uses PostgreSQL for structured persistence.",
      project: "alpha",
      type: "architecture",
      confirmed: true,
    });

    propose(store, {
      title: "Beta cache architecture",
      content: "Beta project uses Redis for distributed caching.",
      project: "beta",
      type: "architecture",
      confirmed: true,
    });

    const report = compileKnowledge(store, memoryDir, { project: "alpha" });
    expect(report.entities.entities.some((e) => e.name.toLowerCase().includes("alpha") || e.name.toLowerCase().includes("postgresql"))).toBe(true);
    expect(report.entities.entities.some((e) => e.name.toLowerCase().includes("redis"))).toBe(false);

    cleanup(root);
  });
});
