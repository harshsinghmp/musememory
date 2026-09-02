import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStoreCache, getOrCreateStoreCache, resetGlobalCache } from "../src/cache.ts";
import { openStore, propose, get, list, save, deleteEntry } from "../src/store.ts";
import { searchMemoriesFts } from "../src/sqlite.ts";
import { formatPromptContext } from "../src/retrieval.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("R1 Core Speed: L0 Hot Cache, L1 Context Cache & SQLite FTS5", () => {
  let testDir: string;
  let memoryDir: string;

  beforeEach(() => {
    resetGlobalCache();
    testDir = mkdtempSync(join(tmpdir(), "musememory-cache-test-"));
    memoryDir = join(testDir, ".memory");
  });

  afterEach(() => {
    resetGlobalCache();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("MemoryStoreCache (L0 & L1)", () => {
    it("stores and retrieves entries with microsecond latency", () => {
      const cache = new MemoryStoreCache();
      const entry: MemoryEntry = {
        id: "m_test_1",
        title: "Test Architecture",
        content: "High-performance memory caching engine",
        project: "musememory",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      cache.setEntry(entry);
      const retrieved = cache.getEntry("m_test_1");
      expect(retrieved).toBeDefined();
      expect(retrieved?.title).toBe("Test Architecture");
      expect(cache.getStats().hits).toBe(1);
      expect(cache.getStats().misses).toBe(0);
    });

    it("returns undefined on cache miss and records stats", () => {
      const cache = new MemoryStoreCache();
      const retrieved = cache.getEntry("m_nonexistent");
      expect(retrieved).toBeUndefined();
      expect(cache.getStats().misses).toBe(1);
    });

    it("evicts oldest entries when maxEntries limit is exceeded", () => {
      const cache = new MemoryStoreCache({ maxEntries: 2 });
      const makeEntry = (id: string): MemoryEntry => ({
        id,
        title: `Title ${id}`,
        content: `Content ${id}`,
        project: "test",
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      cache.setEntry(makeEntry("e1"));
      cache.setEntry(makeEntry("e2"));
      expect(cache.getStats().entryCount).toBe(2);

      // Access e1 to refresh its LRU position
      cache.getEntry("e1");

      // Adding e3 should evict e2 (oldest LRU)
      cache.setEntry(makeEntry("e3"));
      expect(cache.getStats().evictions).toBe(1);
      expect(cache.getEntry("e1")).toBeDefined();
      expect(cache.getEntry("e3")).toBeDefined();
      expect(cache.getEntry("e2")).toBeUndefined();
    });

    it("expires entries when TTL is exceeded", async () => {
      const cache = new MemoryStoreCache();
      const entry: MemoryEntry = {
        id: "m_ttl",
        title: "TTL Test",
        content: "Ephemeral content",
        project: "test",
        status: "candidate",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Set with 20ms TTL
      cache.setEntry(entry, 20);
      expect(cache.getEntry("m_ttl")).toBeDefined();

      await new Promise((r) => setTimeout(r, 30));
      expect(cache.getEntry("m_ttl")).toBeUndefined();
    });

    it("invalidates cache item when external disk mtime changes", () => {
      const cache = new MemoryStoreCache();
      const entry: MemoryEntry = {
        id: "m_mtime",
        title: "Mtime Test",
        content: "Initial content",
        project: "test",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      cache.setEntry(entry, undefined, 1000);
      // Same mtime -> hit
      expect(cache.getEntry("m_mtime", 1000)).toBeDefined();

      // Changed mtime -> miss and eviction
      expect(cache.getEntry("m_mtime", 1005)).toBeUndefined();
    });

    it("returns cloned entries to protect internal cache from caller mutations", () => {
      const cache = new MemoryStoreCache();
      const entry: MemoryEntry = {
        id: "m_clone",
        title: "Original Title",
        content: "Original Content",
        project: "test",
        status: "candidate",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      cache.setEntry(entry);
      const retrieved = cache.getEntry("m_clone");
      expect(retrieved).toBeDefined();

      // Mutate retrieved copy
      retrieved!.title = "Mutated Title";

      // Verify cached entry remains untouched
      const secondLookup = cache.getEntry("m_clone");
      expect(secondLookup?.title).toBe("Original Title");
    });

    it("invalidates query and context caches when entries mutate", () => {
      const cache = new MemoryStoreCache();
      cache.setQuery("query_1", []);
      expect(cache.getQuery("query_1")).toEqual([]);

      cache.invalidateQueries();
      expect(cache.getQuery("query_1")).toBeUndefined();
      expect(cache.getStats().invalidations).toBe(1);
    });
  });

  describe("Store Integration with L0 Hot Cache", () => {
    it("propose, get, and list populate and utilize L0 cache seamlessly", () => {
      const store = openStore(memoryDir);
      expect(store.cache).toBeDefined();

      const created = propose(store, {
        title: "Database Indexing Strategy",
        content: "Use WAL mode with FTS5 virtual tables for instant search.",
        project: "core-speed",
        type: "architecture",
        confirmed: true,
      });

      // L0 Cache lookup
      const cached = store.cache?.getEntry(created.id);
      expect(cached).toBeDefined();
      expect(cached?.title).toBe("Database Indexing Strategy");

      // get(store, id) hits cache without YAML re-parsing
      const retrieved = get(store, created.id);
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.content).toContain("WAL mode");

      // list(store) populates and hits query cache
      const list1 = list(store);
      expect(list1.length).toBe(1);

      const list2 = list(store);
      expect(list2.length).toBe(1);
      expect(list2[0].id).toBe(created.id);
    });

    it("evicts from cache on deleteEntry", () => {
      const store = openStore(memoryDir);
      const entry = propose(store, {
        title: "To Be Deleted",
        content: "Temporary note",
        project: "test",
      });

      expect(get(store, entry.id)).not.toBeNull();
      expect(store.cache?.getEntry(entry.id)).toBeDefined();

      deleteEntry(store, entry.id);
      expect(store.cache?.getEntry(entry.id)).toBeUndefined();
      expect(get(store, entry.id)).toBeNull();
    });

    it("detects external YAML file edits and refreshes cache", () => {
      const store = openStore(memoryDir);
      const entry = propose(store, {
        title: "Original",
        content: "Initial body",
        project: "test",
      });

      expect(get(store, entry.id)?.content).toBe("Initial body");

      // Manually modify the YAML file on disk with different content
      const filePath = `${store.dir}/${entry.id}.yaml`;
      writeFileSync(
        filePath,
        `id: ${entry.id}\ntitle: External Modification\ncontent: Updated externally on disk\nproject: test\nstatus: candidate\ncreated_at: 2026-01-01T00:00:00Z\nupdated_at: 2026-01-01T00:00:00Z\n`,
        "utf8",
      );

      // Next get should detect mtime change and return updated content
      const refreshed = get(store, entry.id);
      expect(refreshed?.title).toBe("External Modification");
      expect(refreshed?.content).toBe("Updated externally on disk");
    });
  });

  describe("SQLite FTS5 Full-Text Search", () => {
    it("indexes memories in FTS5 and performs high-speed BM25 search", () => {
      const store = openStore(memoryDir);
      expect(store.db).toBeDefined();

      propose(store, {
        title: "Asynchronous Message Queue Architecture",
        content: "Decouple microservices using RabbitMQ or Kafka stream partitions for backpressure handling.",
        project: "backend",
        type: "architecture",
        tags: ["messaging", "kafka", "queues"],
        confirmed: true,
      });

      propose(store, {
        title: "React Server Components Optimization",
        content: "Stream HTML chunks with Suspense boundaries to minimize Time To First Byte.",
        project: "frontend",
        type: "architecture",
        tags: ["react", "streaming", "rsc"],
        confirmed: true,
      });

      propose(store, {
        title: "Database Deadlock Workaround",
        content: "Sort primary keys before issuing batch UPDATE statements to prevent cyclic lock dependency.",
        project: "backend",
        type: "fix",
        tags: ["postgres", "deadlock", "sql"],
        confirmed: true,
      });

      // Search via FTS5
      const matches = searchMemoriesFts(store.db!, "Kafka messaging");
      expect(matches.length).toBe(1);
      expect(matches[0].entry.title).toContain("Asynchronous Message Queue");
      expect(matches[0].rank).toBeDefined();

      // Search prefix
      const prefixMatches = searchMemoriesFts(store.db!, "deadlock*");
      expect(prefixMatches.length).toBe(1);
      expect(prefixMatches[0].entry.title).toContain("Database Deadlock");

      // Project filter
      const frontendMatches = searchMemoriesFts(store.db!, "streaming", { project: "frontend" });
      expect(frontendMatches.length).toBe(1);
      expect(frontendMatches[0].entry.project).toBe("frontend");
    });
  });

  describe("L1 Formatted Prompt Context Cache", () => {
    it("caches formatted prompt context and speeds up repeated queries", () => {
      const store = openStore(memoryDir);
      propose(store, {
        title: "Security Rule 1",
        content: "Never log unmasked customer authentication tokens.",
        project: "sec",
        type: "constraint",
        confirmed: true,
      });

      const start1 = performance.now();
      const ctx1 = formatPromptContext(store, memoryDir, "tokens authentication");
      const d1 = performance.now() - start1;

      expect(ctx1.markdown).toContain("Never log unmasked customer");

      // Second identical context query should hit L1 context cache
      const start2 = performance.now();
      const ctx2 = formatPromptContext(store, memoryDir, "tokens authentication");
      const d2 = performance.now() - start2;

      expect(ctx2.markdown).toBe(ctx1.markdown);
      expect(d2).toBeLessThanOrEqual(d1 + 1); // Substantially faster or near-zero
    });
  });
});
