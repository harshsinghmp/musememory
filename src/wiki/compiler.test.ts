import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose } from "../store.ts";
import { compileWiki, getWikiPage, listWikiPages } from "./compiler.ts";
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
    
    expect(result.pagesCreated.length).toBeGreaterThan(0);
  });

  it("listWikiPages and getWikiPage support L1 detail level", async () => {
    const { listWikiPages, getWikiPage } = await import("./compiler.ts");
    createMemories(6);
    // Compile and write files
    const result = compileWiki(store, memoryDir, { dryRun: false });
    expect(result.pagesCreated.length).toBeGreaterThan(0);

    // List full detail
    const fullPages = listWikiPages(memoryDir, { detailLevel: "full" });
    expect(fullPages.length).toBeGreaterThan(0);
    const conceptFull = fullPages.find((p) => p.type === "concept");
    expect(conceptFull).toBeDefined();
    expect((conceptFull as any).content.length).toBeGreaterThan(0);

    // List L1 detail: content should be empty string
    const l1Pages = listWikiPages(memoryDir, { detailLevel: "l1" });
    expect(l1Pages.length).toBe(fullPages.length);
    const conceptL1 = l1Pages.find((p) => p.type === "concept");
    expect(conceptL1).toBeDefined();
    expect((conceptL1 as any).content).toBe("");

    // Get page L1 detail
    const firstSlug = conceptFull!.slug;
    const pageL1 = getWikiPage(memoryDir, firstSlug, "concept", "l1");
    expect(pageL1).not.toBeNull();
    expect((pageL1 as any).content).toBe("");

    // Get page full detail
    const pageFull = getWikiPage(memoryDir, firstSlug, "concept", "full");
    expect(pageFull).not.toBeNull();
    expect((pageFull as any).content.length).toBeGreaterThan(0);
  });

  it("getWikiPage rejects slugs that escape the wiki directory", () => {
    createMemories(6);
    compileWiki(store, memoryDir, { dryRun: false });

    const outsideFile = join(testDir, "outside.md");
    writeFileSync(outsideFile, "OUTSIDE-WIKI-MARKER");

    // Each branch is pinned with an explicit `type`: without it the concept
    // branch silently returns null and only the entity branch ever throws.
    for (const type of ["concept", "entity"] as const) {
      expect(() => getWikiPage(memoryDir, "../../../../etc/passwd", type)).toThrow(/escap/i);
      expect(() => getWikiPage(memoryDir, "concepts/../../../outside", type)).toThrow(/escap/i);
      expect(() => getWikiPage(memoryDir, "/etc/passwd", type)).toThrow(/relative|escap/i);
      expect(() => getWikiPage(memoryDir, "bad\0slug", type)).toThrow(/NUL/i);
    }
    expect(() => getWikiPage(memoryDir, "../../../../etc/passwd")).toThrow(/escap/i);
    expect(() => getWikiPage(memoryDir, "concepts/../../../outside")).toThrow(/escap/i);

    // Content outside the wiki base was neither returned nor consumed.
    expect(readFileSync(outsideFile, "utf8")).toContain("OUTSIDE-WIKI-MARKER");
  });

  it("getWikiPage still resolves legitimate slugs", () => {
    createMemories(6);
    compileWiki(store, memoryDir, { dryRun: false });

    const concept = listWikiPages(memoryDir, { type: "concept", detailLevel: "l1" })[0];
    expect(concept).toBeDefined();
    expect(getWikiPage(memoryDir, concept.slug, "concept", "l1")).not.toBeNull();

    const entity = listWikiPages(memoryDir, { type: "entity", detailLevel: "l1" })[0];
    if (entity) expect(getWikiPage(memoryDir, entity.slug, "entity", "l1")).not.toBeNull();

    // Reserved slugs are matched before containment, so they keep working.
    expect(getWikiPage(memoryDir, "index", "index")).not.toBeNull();
    expect(getWikiPage(memoryDir, "log", "log")).not.toBeNull();
  });

  it("compileWiki keeps hostile memory text from writing outside the wiki dir", () => {
    const outsideFile = join(testDir, "outside.md");
    writeFileSync(outsideFile, "OUTSIDE-WIKI-MARKER");

    for (let i = 0; i < 6; i++) {
      propose(store, {
        content: `../../../../etc/passwd and concepts/../../../outside mention Payload-${i} React Server Components Next.js memory caching.`,
        project: "test",
        title: `../../../etc/passwd Test Memory ${i}`,
        type: "fix",
        confirmed: true,
        tags: ["react", "nextjs"],
      });
    }

    const beforeCompile = readdirSync(memoryDir);
    compileWiki(store, memoryDir, { dryRun: false });

    // Compiling adds no entry above the wiki dir — nothing escaped.
    expect(readdirSync(memoryDir).sort()).toEqual([...beforeCompile].sort());
    expect(readFileSync(outsideFile, "utf8")).toBe("OUTSIDE-WIKI-MARKER");
    for (const section of ["concepts", "entities"]) {
      for (const f of readdirSync(join(memoryDir, "wiki", section))) {
        expect(f.endsWith(".md")).toBe(true);
        expect(f).not.toContain("/");
        expect(f).not.toContain("..");
      }
    }
  });
});