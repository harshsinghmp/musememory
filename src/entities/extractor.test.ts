import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose } from "../store.ts";
import { extractEntitiesFromMemories, saveEntities, loadEntities, findEntity, findRelatedEntities } from "./extractor.ts";

describe("Entity Extraction Engine", () => {
  let testDir: string;
  let memoryDir: string;
  let store: ReturnType<typeof openStore>;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "musememory-entities-"));
    memoryDir = join(testDir, ".memory");
    store = openStore(memoryDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("extracts named persons, products, orgs, and files from memories", () => {
    const mem1 = propose(store, {
      title: "Next.js migration and @harsh PR",
      content: "Reviewed by @harsh for Vercel deployment with React Server Components in src/retrieval.ts",
      project: "testproj",
      confirmed: true,
    });
    const mem2 = propose(store, {
      title: "TypeScript setup with Next.js",
      content: "Configured package.json and TypeScript for Vercel builds reported by @harsh",
      project: "testproj",
      confirmed: true,
    });

    const result = extractEntitiesFromMemories([mem1, mem2]);
    expect(result.entities.length).toBeGreaterThan(0);

    const person = result.entities.find((e) => e.type === "person" && e.name === "harsh");
    expect(person).toBeDefined();
    expect(person?.memoryRefs.length).toBe(2);

    const product = result.entities.find((e) => e.name.toLowerCase() === "next.js" || e.name.toLowerCase() === "react");
    expect(product).toBeDefined();

    const file = result.entities.find((e) => e.type === "file");
    expect(file).toBeDefined();
  });

  it("computes co-occurrence strength between entities", () => {
    const mem1 = propose(store, {
      title: "React on Vercel",
      content: "Working on Next.js and Vercel hosting with @harsh",
      project: "testproj",
      confirmed: true,
    });
    const mem2 = propose(store, {
      title: "Next.js updates",
      content: "Vercel edge functions using Next.js with @harsh",
      project: "testproj",
      confirmed: true,
    });

    const result = extractEntitiesFromMemories([mem1, mem2]);
    const harsh = result.entities.find((e) => e.id === "harsh");
    expect(harsh).toBeDefined();
    expect(harsh?.relatedEntities.length).toBeGreaterThan(0);
  });

  it("saves, loads, and finds entities and related entities", () => {
    const mem1 = propose(store, {
      title: "Docker deployment for PostgreSQL",
      content: "Setting up Docker containers with PostgreSQL database in src/db.ts",
      project: "testproj",
      confirmed: true,
    });

    const result = extractEntitiesFromMemories([mem1]);
    saveEntities(memoryDir, result.entities);

    const loaded = loadEntities(memoryDir);
    expect(loaded.length).toBe(result.entities.length);

    const found = findEntity(memoryDir, "docker");
    expect(found).toBeDefined();
    expect(found?.type).toBe("product");
  });
});
