import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPageIndex, searchPageIndex, loadPageIndex, listPageIndexes, deletePageIndex } from "../src/pageindex/index.ts";

describe("PageIndex Native Engine", () => {
  let testDir: string;
  let memoryDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "musememory-pageindex-"));
    memoryDir = join(testDir, ".memory");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("builds a hierarchical tree from markdown content and saves to disk", () => {
    const markdown = `
# System Architecture

This is the top level architecture document.

## Server Components
React Server Components allow server-only rendering and smaller bundles.

### Data Fetching
Streaming data fetching with Suspense.

## Database
PostgreSQL with pgvector for embeddings.
`;

    const doc = buildPageIndex(markdown, {
      project: "testproj",
      title: "System Architecture",
      memoryDir,
    });

    expect(doc.id).toBeDefined();
    expect(doc.totalNodes).toBeGreaterThanOrEqual(4);
    expect(doc.root.children.length).toBe(2);

    const loaded = loadPageIndex(memoryDir, "testproj", doc.id);
    expect(loaded).toBeDefined();
    expect(loaded?.title).toBe("System Architecture");
  });

  it("performs reasoning-based search over the tree", () => {
    const markdown = `
# Authentication System

## Session Tokens
Tokens expire in 90 days and rotate on refresh.

## Password Hashing
Argon2id is used for password hashing.
`;

    const doc = buildPageIndex(markdown, {
      project: "testproj",
      title: "Auth Spec",
      memoryDir,
    });

    const search = searchPageIndex(doc, { query: "token rotation expiration" });
    expect(search.results.length).toBeGreaterThan(0);
    expect(search.results[0].title).toBe("Session Tokens");
    expect(search.reasoning).toContain("Session Tokens");
  });

  it("intercepts and rejects secrets via Vibeguard", () => {
    const leakMarkdown = "# Leaked Keys\nsk-1234567890abcdef1234567890abcdef";
    expect(() => {
      buildPageIndex(leakMarkdown, { project: "testproj", memoryDir });
    }).toThrow(/secret/i);
  });

  it("disconnects and cleans up indexes", () => {
    const doc = buildPageIndex("# Temp Doc\nSome text", { project: "testproj", memoryDir });
    expect(listPageIndexes(memoryDir, "testproj").length).toBe(1);

    const del = deletePageIndex(memoryDir, "testproj", doc.id);
    expect(del.deletedCount).toBe(1);
    expect(listPageIndexes(memoryDir, "testproj").length).toBe(0);
  });
});
