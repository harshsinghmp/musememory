import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, propose, confirm, type Store } from "../src/store.ts";
import {
  queryContext,
  formatPromptContext,
  extractWikilinks,
  expandFusedWikilinks,
  type ContextQueryOptions,
} from "../src/retrieval.ts";
import { RetrievalEngine } from "../src/retrieval/engine.ts";

describe("T-098: progressive wikilink expansion after fusion", () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-wikilink-test-"));
    mkdirSync(join(tmpDir, ".memory"), { recursive: true });
    store = openStore(join(tmpDir, ".memory"));
  });

  afterEach(() => {
    if (store.db) {
      store.db.close();
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("extractWikilinks", () => {
    it("extracts wikilinks with simple, aliased, and anchored targets", () => {
      const text = `
        Check [[memory_alpha]] and also [[memory_beta|Beta Label]].
        Refer to [[concept-auth#section]] and duplicate [[memory_alpha]].
        Do not match [single brackets] or [[invalid|]].
      `;
      const links = extractWikilinks(text);
      expect(links).toContain("memory_alpha");
      expect(links).toContain("memory_beta");
      expect(links).toContain("concept-auth");
      expect(links.length).toBe(3);
    });

    it("returns empty array when text has no wikilinks", () => {
      expect(extractWikilinks("plain text without links")).toEqual([]);
      expect(extractWikilinks("")).toEqual([]);
    });
  });

  describe("expandFusedWikilinks after fusion", () => {
    it("progressively expands linked_memory_ids write-time edges", () => {
      const targetMem = confirm(
        store,
        propose(store, {
          title: "Target Database Configuration",
          content: "Postgres pool connection tuning and max connections = 20.",
          project: "test-proj",
          type: "architecture",
        }).id,
      )!;

      const sourceMem = confirm(
        store,
        propose(store, {
          title: "API Service Postgres Connection Pool",
          content: "Use the shared database pool for API requests.",
          project: "test-proj",
          type: "decision",
          linked_memory_ids: [targetMem.id],
        }).id,
      )!;

      // Search for API service
      const res = queryContext(store, "API Service Postgres Connection", {
        project: "test-proj",
        expand_wikilinks: true,
        limit: 1,
      });

      expect(res.results.length).toBe(1);
      expect(res.results[0].entry.id).toBe(sourceMem.id);

      // Verify expanded wikilinks
      expect(res.expanded_count).toBe(1);
      expect(res.expanded_wikilinks).toBeDefined();
      expect(res.expanded_wikilinks?.length).toBe(1);
      expect(res.expanded_wikilinks![0].target).toBe(targetMem.id);
      expect(res.expanded_wikilinks![0].sourceId).toBe(sourceMem.id);
      expect(res.expanded_wikilinks![0].entry?.id).toBe(targetMem.id);
      expect(res.expanded_wikilinks![0].hop).toBe(1);
    });

    it("progressively expands inline [[target]] wikilinks in memory content", () => {
      const authRule = confirm(
        store,
        propose(store, {
          title: "JWT Token Validation Rule",
          content: "Always check expiry and audience claim on incoming JWTs.",
          project: "test-proj",
          type: "constraint",
        }).id,
      )!;

      const handlerDecision = confirm(
        store,
        propose(store, {
          title: "HTTP Route Authentication Middleware",
          content: `All secure routes must invoke [[${authRule.id}]] before processing payload.`,
          project: "test-proj",
          type: "architecture",
        }).id,
      )!;

      const res = queryContext(store, "HTTP Route Authentication Middleware", {
        project: "test-proj",
        expand_wikilinks: true,
        limit: 1,
      });

      expect(res.results[0].entry.id).toBe(handlerDecision.id);
      expect(res.expanded_count).toBe(1);
      expect(res.expanded_wikilinks![0].target).toBe(authRule.id);
      expect(res.expanded_wikilinks![0].entry?.id).toBe(authRule.id);
    });

    it("resolves wikilinks to compiled wiki concept pages when memory id not found", () => {
      // Create a compiled wiki concept page
      const wikiConceptsDir = join(tmpDir, ".memory", "wiki", "concepts");
      mkdirSync(wikiConceptsDir, { recursive: true });
      writeFileSync(
        join(wikiConceptsDir, "distributed-locking.md"),
        `---\ntitle: Distributed Locking\nslug: distributed-locking\ntype: concept\nsummary: Redlock algorithm for distributed coordination.\n---\n# Distributed Locking\nContent`,
        "utf8",
      );

      confirm(
        store,
        propose(store, {
          title: "Worker Job Scheduling Guard",
          content: "Worker jobs acquire a lock via [[distributed-locking]] to avoid concurrency bugs.",
          project: "test-proj",
          type: "decision",
        }).id,
      );

      const res = queryContext(store, "Worker Job Scheduling Guard", {
        project: "test-proj",
        expand_wikilinks: true,
      });

      expect(res.results.length).toBe(1);
      expect(res.expanded_count).toBe(1);
      expect(res.expanded_wikilinks![0].wikiPage).toBeDefined();
      expect(res.expanded_wikilinks![0].wikiPage?.slug).toBe("distributed-locking");
      expect(res.expanded_wikilinks![0].wikiPage?.title).toBe("Distributed Locking");
      expect(res.expanded_wikilinks![0].wikiPage?.summary).toBe("Redlock algorithm for distributed coordination.");
    });

    it("respects tokenBudget and stops expanding when budget is exceeded", () => {
      const linkedMem = confirm(
        store,
        propose(store, {
          title: "Heavy Document Reference",
          content: "A".repeat(500), // ~125 tokens
          project: "test-proj",
          type: "discovery",
        }).id,
      )!;

      confirm(
        store,
        propose(store, {
          title: "Small Primary Memory",
          content: `Small primary entry linking to [[${linkedMem.id}]].`,
          project: "test-proj",
          type: "decision",
        }).id,
      );

      // Token budget that allows primary memory (~45 tokens) but not linkedMem (~165 tokens)
      const res = queryContext(store, "Small Primary Memory", {
        project: "test-proj",
        expand_wikilinks: true,
        tokenBudget: 80,
        limit: 1,
      });

      expect(res.results.length).toBe(1);
      // Either compact representation or budget stops full expansion
      if (res.expanded_count && res.expanded_count > 0) {
        expect(res.totalTokensUsed).toBeLessThanOrEqual(80);
      } else {
        expect(res.expanded_count ?? 0).toBe(0);
      }
    });

    it("prevents circular references and does not duplicate primary results", () => {
      const memA = confirm(
        store,
        propose(store, {
          title: "Memory Alpha",
          content: "Alpha references Beta.",
          project: "test-proj",
          type: "discovery",
        }).id,
      )!;

      const memB = confirm(
        store,
        propose(store, {
          title: "Memory Beta",
          content: `Beta references [[${memA.id}]].`,
          project: "test-proj",
          type: "discovery",
          linked_memory_ids: [memA.id],
        }).id,
      )!;

      // Query that matches both Alpha and Beta as primary results
      const res = queryContext(store, "Memory Alpha Beta", {
        project: "test-proj",
        expand_wikilinks: true,
        limit: 5,
      });

      // Since both are in primary results, wikilink expansion should not re-expand them
      const expandedIds = res.expanded_wikilinks?.map((w) => w.target) ?? [];
      expect(expandedIds).not.toContain(memA.id);
      expect(expandedIds).not.toContain(memB.id);
    });

    it("does not expand superseded memories when includeSuperseded is false", () => {
      const oldMem = confirm(
        store,
        propose(store, {
          title: "Old Architecture",
          content: "Legacy monolith architecture.",
          project: "test-proj",
          type: "architecture",
        }).id,
      )!;

      // Mark oldMem superseded
      confirm(
        store,
        propose(store, {
          title: "New Modular Architecture",
          content: "Modular micro-kernel architecture.",
          project: "test-proj",
          type: "architecture",
          supersedes: oldMem.id,
        }).id,
      );

      confirm(
        store,
        propose(store, {
          title: "Migration Notes",
          content: `Notes referencing deprecated [[${oldMem.id}]].`,
          project: "test-proj",
          type: "discovery",
        }).id,
      );

      const res = queryContext(store, "Migration Notes", {
        project: "test-proj",
        expand_wikilinks: true,
        includeSuperseded: false,
        limit: 1,
      });

      const expandedTargets = res.expanded_wikilinks?.map((w) => w.target) ?? [];
      expect(expandedTargets).not.toContain(oldMem.id);
    });

    it("supports multi-hop expansion up to max_wikilink_hops", () => {
      const memC = confirm(
        store,
        propose(store, {
          title: "Leaf Node C",
          content: "Deep leaf node data.",
          project: "test-proj",
          type: "discovery",
        }).id,
      )!;

      const memB = confirm(
        store,
        propose(store, {
          title: "Intermediate Node B",
          content: `Node B links to [[${memC.id}]].`,
          project: "test-proj",
          type: "discovery",
          linked_memory_ids: [memC.id],
        }).id,
      )!;

      confirm(
        store,
        propose(store, {
          title: "Root Node A",
          content: `Node A links to [[${memB.id}]].`,
          project: "test-proj",
          type: "decision",
          linked_memory_ids: [memB.id],
        }).id,
      );

      const res1Hop = queryContext(store, "Root Node A", {
        project: "test-proj",
        expand_wikilinks: true,
        max_wikilink_hops: 1,
        limit: 1,
      });
      expect(res1Hop.expanded_wikilinks?.map((w) => w.target)).toContain(memB.id);
      expect(res1Hop.expanded_wikilinks?.map((w) => w.target)).not.toContain(memC.id);

      const res2Hop = queryContext(store, "Root Node A", {
        project: "test-proj",
        expand_wikilinks: true,
        max_wikilink_hops: 2,
        limit: 1,
      });
      expect(res2Hop.expanded_wikilinks?.map((w) => w.target)).toContain(memB.id);
      expect(res2Hop.expanded_wikilinks?.map((w) => w.target)).toContain(memC.id);
      expect(res2Hop.expanded_wikilinks?.find((w) => w.target === memC.id)?.hop).toBe(2);
    });

    it("formats progressively expanded wikilinks in formatPromptContext markdown", () => {
      const doc = confirm(
        store,
        propose(store, {
          title: "Distributed Cache Topology",
          content: "Use cluster-wide cache invalidation bus.",
          project: "test-proj",
          type: "architecture",
        }).id,
      )!;

      confirm(
        store,
        propose(store, {
          title: "Cache Service Client",
          content: `Connects to cache following [[${doc.id}]].`,
          project: "test-proj",
          type: "decision",
        }).id,
      );

      const ctx = formatPromptContext(store, tmpDir, "Cache Service Client", {
        project: "test-proj",
        expand_wikilinks: true,
        limit: 1,
      });

      expect(ctx.markdown).toContain("### Progressively Expanded Wiki Links & Related Memories");
      expect(ctx.markdown).toContain(`[[${doc.id}]]`);
      expect(ctx.markdown).toContain("Distributed Cache Topology");
      expect(ctx.expanded_count).toBe(1);
    });

    it("surfaces expanded_wikilinks and expanded_count in RetrievalEngine.search", () => {
      const linked = confirm(
        store,
        propose(store, {
          title: "Security Cipher Standards",
          content: "Use AES-256-GCM for encrypted secrets.",
          project: "test-proj",
          type: "constraint",
        }).id,
      )!;

      confirm(
        store,
        propose(store, {
          title: "Encryption Helper Service",
          content: `Implements encryption adhering to [[${linked.id}]].`,
          project: "test-proj",
          type: "decision",
        }).id,
      );

      const res = RetrievalEngine.search(store, tmpDir, "Encryption Helper Service", {
        project: "test-proj",
        expand_wikilinks: true,
        limit: 1,
      });

      expect(res.expanded_count).toBe(1);
      expect(res.expanded_wikilinks).toBeDefined();
      expect(res.expanded_wikilinks![0].target).toBe(linked.id);
    });
  });
});
