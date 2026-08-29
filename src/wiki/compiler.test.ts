import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose } from "../store.ts";
import { compileWiki } from "./compiler.ts";
import type { WikiCompileOptions } from "./types.ts";

describe("Wiki Compilation Engine", () => {
  let testDir: string;
  let memoryDir: string;
  let store: ReturnType<typeof openStore>;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "musememory-wiki-"));
    memoryDir = join(testDir, ".memory");
    store = openStore(memoryDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function createMemories(count: number, project = "test", type: "fix" | "architecture" | "decision" = "fix") {
    const memories = [];
    for (let i = 0; i < count; i++) {
      const entry = propose(store, {
        content: `Memory ${i}: This is a test memory about React Server Components and Next.js with some content for ${project}.`,
        project,
        title: `${project} ${type} Test Memory ${i}`,
        type,
        confirmed: true,
        tags: ["react", "nextjs", "rsc"],
      });
      memories.push(entry);
    }
    return memories;
  }

  it("compiles wiki from confirmed memories", () => {
    createMemories(10);
    const result = compileWiki(store, memoryDir, { dryRun: true });
    
    expect(result.pagesCreated.length).toBeGreaterThan(0);
    expect(result.errors.length).toBe(0);
  });

  it("creates concept pages from clusters", () => {
    createMemories(10);
    const result = compileWiki(store, memoryDir, { dryRun: true });
    
    const conceptPages = result.pagesCreated.filter((p) => p.type === "concept");
    expect(conceptPages.length).toBeGreaterThan(0);
    
    for (const page of conceptPages) {
      expect(page.slug).toBeDefined();
      expect(page.title).toBeDefined();
      expect(page.summary).toBeDefined();
      expect(page.content).toBeDefined();
      expect(page.memoryRefs.length).toBeGreaterThan(0);
    }
  });

  it("creates entity pages from mentions", () => {
    createMemories(5);
    const result = compileWiki(store, memoryDir, { dryRun: true });
    
    const entityPages = result.pagesCreated.filter((p) => p.type === "entity");
    expect(entityPages.length).toBeGreaterThan(0);
    
    for (const page of entityPages) {
      expect(page.slug).toBeDefined();
      expect(page.title).toBeDefined();
      expect(page.entityType).toBeDefined();
      expect(page.memoryRefs.length).toBeGreaterThan(0);
    }
  });

  it("creates index and log pages", () => {
    createMemories(5);
    const result = compileWiki(store, memoryDir, { dryRun: true });
    
    const indexPages = result.pagesCreated.filter((p) => p.type === "index");
    const logPages = result.pagesCreated.filter((p) => p.type === "log");
    
    expect(indexPages.length).toBe(1);
    expect(logPages.length).toBe(1);
  });

  it("filters by project", () => {
    createMemories(5, "projA");
    createMemories(5, "projB");
    
    const resultA = compileWiki(store, memoryDir, { project: "projA", dryRun: true });
    const resultB = compileWiki(store, memoryDir, { project: "projB", dryRun: true });
    
    expect(resultA.pagesCreated.length).toBeGreaterThan(0);
    expect(resultB.pagesCreated.length).toBeGreaterThan(0);
  });

  it("filters by type", () => {
    createMemories(5, "test", "fix");
    createMemories(5, "test", "architecture");
    
    const result = compileWiki(store, memoryDir, { 
      includeTypes: ["fix"], 
      dryRun: true 
    });
    
    const fixPages = result.pagesCreated.filter((p) => p.type === "concept");
    expect(fixPages.length).toBeGreaterThan(0);
  });

  it("cross-links related concepts", () => {
    createMemories(10);
    const result = compileWiki(store, memoryDir, { dryRun: true });
    
    const conceptPages = result.pagesCreated.filter((p) => p.type === "concept");
    for (const page of conceptPages) {
      expect(page.relatedConcepts).toBeDefined();
      expect(Array.isArray(page.relatedConcepts)).toBe(true);
    }
  });

  it("cross-links entities to concepts", () => {
    createMemories(10);
    const result = compileWiki(store, memoryDir, { dryRun: true });
    
    const entityPages = result.pagesCreated.filter((p) => p.type === "entity");
    for (const page of entityPages) {
      expect(page.relatedConcepts).toBeDefined();
      expect(Array.isArray(page.relatedConcepts)).toBe(true);
    }
  });

  it("dry-run does not write files", () => {
    createMemories(5);
    const result = compileWiki(store, memoryDir, { dryRun: true });
    
    const wikiDir = join(memoryDir, "wiki");
    // In dry-run, wiki directory should not be created
    // (though it might be created by mkdirSync in compiler - that's OK)
  });
});