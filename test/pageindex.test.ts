import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { buildPageIndex, searchPageIndex, loadPageIndex, listPageIndexes, deletePageIndex } from "../src/pageindex/index.ts";
import { resolveExternal, resolveWithin } from "../src/paths.ts";

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

  it("loadPageIndex returns null instead of reading outside the pageindex base", () => {
    const doc = buildPageIndex("# Hostile Doc\nSome text", { project: "testproj", memoryDir });
    expect(loadPageIndex(memoryDir, "testproj", doc.id)).not.toBeNull();

    expect(loadPageIndex(memoryDir, "../../etc", "passwd")).toBeNull();
    expect(loadPageIndex(memoryDir, "testproj", "../../../etc/passwd")).toBeNull();
  });

  it("deletePageIndex refuses to delete a directory outside the pageindex base", () => {
    buildPageIndex("# Hostile Doc\nSome text", { project: "testproj", memoryDir });

    const evil = join(tmpdir(), "evil");
    rmSync(evil, { recursive: true, force: true });
    mkdirSync(evil, { recursive: true });
    writeFileSync(join(evil, "precious.txt"), "precious");

    try {
      const traversal = relative(join(memoryDir, "pageindex"), evil);
      expect(() => deletePageIndex(memoryDir, traversal)).toThrow(/escap/i);
      expect(existsSync(join(evil, "precious.txt"))).toBe(true);
    } finally {
      rmSync(evil, { recursive: true, force: true });
    }
  });

  it("deletePageIndex rejects '..' but still deletes a real pageindex base", () => {
    buildPageIndex("# Temp Doc\nSome text", { project: "testproj", memoryDir });

    expect(() => deletePageIndex(memoryDir, "..")).toThrow(/escap/i);
    expect(listPageIndexes(memoryDir, "testproj").length).toBe(1);

    expect(deletePageIndex(memoryDir).deletedCount).toBe(1);
    expect(listPageIndexes(memoryDir).length).toBe(0);
  });
});

describe("Path containment primitives", () => {
  it("rejects NUL bytes in base, segment and external paths", () => {
    expect(() => resolveWithin("/tmp/pi\0base", "a.md")).toThrow();
    expect(() => resolveWithin("/tmp/pi-base", "a\0.md")).toThrow();
    expect(() => resolveExternal("/tmp/pi-base/a\0.md")).toThrow();
  });

  it("rejects absolute segments inside the base but not for external paths", () => {
    expect(() => resolveWithin("/tmp/pi-base", "/etc/passwd")).toThrow();
    expect(resolveExternal("/etc/passwd")).toBe("/etc/passwd");
  });

  it("rejects traversal, including sibling prefixes of the base", () => {
    expect(() => resolveWithin("/tmp/pi-base", "..")).toThrow();
    expect(() => resolveWithin("/tmp/pi-base", "a", "..", "..", "b")).toThrow();
    expect(() => resolveWithin("/tmp/pi-base", "../pi-base-evil/x.md")).toThrow();
    expect(resolveWithin("/tmp/pi-base", "a", "b.md")).toBe("/tmp/pi-base/a/b.md");
  });

  it("treats a trailing separator on the base as the same directory", () => {
    expect(resolveWithin("/tmp/pi-base/", "a.md")).toBe("/tmp/pi-base/a.md");
    expect(() => resolveWithin("/tmp/pi-base/", "../pi-base-evil")).toThrow();
  });

  it("resolves a non-existent leaf without touching the filesystem", () => {
    const leaf = "/tmp/pi-base/missing/deep/x.json";
    expect(resolveWithin("/tmp/pi-base", "missing/deep/x.json")).toBe(leaf);
    expect(existsSync(leaf)).toBe(false);
  });

  it("normalizes external paths", () => {
    expect(resolveExternal("/tmp/a/../b/./c")).toBe("/tmp/b/c");
  });
});
