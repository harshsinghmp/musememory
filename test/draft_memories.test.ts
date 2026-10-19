import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openStore,
  closeStore,
  propose,
  confirm,
  type Store,
} from "../src/store.ts";
import {
  isDraftMemory,
  ensureDraftTitle,
  stripDraftTitle,
  promoteDraft,
} from "../src/drafts.ts";
import { queryContext } from "../src/retrieval.ts";
import { resolveMuseContext } from "../src/orchestrator/context.ts";

describe("T-128: [DRAFT] marking with separate confident-answer key", () => {
  let tempDir: string;
  let store: Store;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "muse-draft-test-"));
    store = openStore(tempDir);
  });

  afterEach(() => {
    closeStore(store);
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Draft detection and title helpers", () => {
    it("isDraftMemory detects entries with draft: true or [DRAFT] title prefix", () => {
      expect(isDraftMemory({ draft: true, title: "Feature idea" })).toBe(true);
      expect(isDraftMemory({ draft: false, title: "[DRAFT] Feature idea" })).toBe(true);
      expect(isDraftMemory({ title: "[DRAFT] Something" })).toBe(true);
      expect(isDraftMemory({ title: "Normal memory" })).toBe(false);
      expect(isDraftMemory({ draft: false, title: "Normal memory" })).toBe(false);
      expect(isDraftMemory(null)).toBe(false);
      expect(isDraftMemory(undefined)).toBe(false);
    });

    it("ensureDraftTitle prefixes non-prefixed titles and normalizes existing ones", () => {
      expect(ensureDraftTitle("API Rate Limiting")).toBe("[DRAFT] API Rate Limiting");
      expect(ensureDraftTitle("[DRAFT] API Rate Limiting")).toBe("[DRAFT] API Rate Limiting");
      expect(ensureDraftTitle("[draft] lowercase prefix")).toBe("[DRAFT] lowercase prefix");
    });

    it("stripDraftTitle cleanly removes draft prefixes", () => {
      expect(stripDraftTitle("[DRAFT] API Rate Limiting")).toBe("API Rate Limiting");
      expect(stripDraftTitle("[draft]   Whitespace variant  ")).toBe("Whitespace variant");
      expect(stripDraftTitle("Already clean title")).toBe("Already clean title");
    });
  });

  describe("propose with draft options", () => {
    it("marks entry as draft and prefixes title when draft: true is passed", () => {
      const entry = propose(store, {
        project: "test-app",
        title: "Provisional Redis Caching Strategy",
        content: "Draft proposal to introduce Redis 7 cache tier for session lookups.",
        type: "architecture",
        draft: true,
      });

      expect(entry.draft).toBe(true);
      expect(entry.title).toBe("[DRAFT] Provisional Redis Caching Strategy");
      expect(isDraftMemory(entry)).toBe(true);
    });

    it("automatically sets draft: true when title starts with [DRAFT]", () => {
      const entry = propose(store, {
        project: "test-app",
        title: "[DRAFT] Unverified migration step",
        content: "Experimental migration step for zero-downtime PostgreSQL schema reload.",
        type: "operation",
      });

      expect(entry.draft).toBe(true);
      expect(entry.title).toBe("[DRAFT] Unverified migration step");
      expect(isDraftMemory(entry)).toBe(true);
    });
  });

  describe("promoteDraft and confirm lifecycle", () => {
    it("promotes draft memory by clearing draft flag and stripping title prefix", () => {
      const draft = propose(store, {
        project: "test-app",
        title: "Experimental Token Bucket",
        content: "Draft token bucket rate limiter implementation design.",
        type: "architecture",
        draft: true,
      });

      expect(draft.draft).toBe(true);
      expect(draft.title).toContain("[DRAFT]");

      const promoted = promoteDraft(store, draft.id);
      expect(promoted).not.toBeNull();
      expect(promoted!.draft).toBe(false);
      expect(promoted!.title).toBe("Experimental Token Bucket");
      expect(isDraftMemory(promoted)).toBe(false);
    });

    it("confirm() automatically promotes draft memories to clean non-draft", () => {
      const draft = propose(store, {
        project: "test-app",
        title: "Tentative Auth Flow",
        content: "Preliminary OAuth2 PKCE callback handling outline.",
        type: "decision",
        draft: true,
      });

      expect(draft.draft).toBe(true);
      expect(draft.title).toContain("[DRAFT]");

      const confirmed = confirm(store, draft.id);
      expect(confirmed).not.toBeNull();
      expect(confirmed!.status).toBe("confirmed");
      expect(confirmed!.draft).toBe(false);
      expect(confirmed!.title).toBe("Tentative Auth Flow");
      expect(isDraftMemory(confirmed)).toBe(false);
    });
  });

  describe("Retrieval isolation: separate confident-answer key", () => {
    it("segregates draft memories from confident answers and flags no_confident_match when only drafts match", () => {
      // Create only draft memories matching the query
      propose(store, {
        project: "test-app",
        title: "Kafka Consumer Concurrency",
        content: "Draft outline on partitioning Kafka consumers with backpressure.",
        type: "architecture",
        draft: true,
      });

      const res = queryContext(store, "Kafka Consumer Concurrency", {
        project: "test-app",
      });

      expect(res.results.length).toBeGreaterThan(0);
      // Confident answers MUST exclude drafts
      expect(res.confident_answers).toBeDefined();
      expect(res.confident_answers!.length).toBe(0);
      // Drafts are isolated in draft_answers
      expect(res.draft_answers).toBeDefined();
      expect(res.draft_answers!.length).toBeGreaterThan(0);
      expect(res.draft_answers![0].entry.title).toContain("[DRAFT]");
      // Because no non-drafts matched confidently, no_confident_match is true
      expect(res.mode).toBe("no_confident_match");
      expect(res.no_confident_match).toBe(true);
    });

    it("populates confident_answers with non-drafts while keeping draft_answers separate", () => {
      // 1 confirmed non-draft memory
      const confirmed = propose(store, {
        project: "test-app",
        title: "Postgres Connection Pool",
        content: "Production postgres connection pool max 20 connections with keepalive.",
        type: "architecture",
        confirmed: true,
      });

      // 1 draft memory
      propose(store, {
        project: "test-app",
        title: "Postgres Read Replica Routing",
        content: "Draft sketch for routing readonly queries to postgres replica.",
        type: "architecture",
        draft: true,
      });

      const res = queryContext(store, "Postgres connection replica", {
        project: "test-app",
      });

      expect(res.results.length).toBe(2);
      expect(res.confident_answers).toBeDefined();
      expect(res.confident_answers!.length).toBe(1);
      expect(res.confident_answers![0].entry.id).toBe(confirmed.id);

      expect(res.draft_answers).toBeDefined();
      expect(res.draft_answers!.length).toBe(1);
      expect(res.draft_answers![0].entry.title).toContain("[DRAFT]");

      expect(res.mode).toBe("confident_match");
      expect(res.no_confident_match).toBe(false);
    });
  });

  describe("resolveMuseContext integration", () => {
    it("orchestrator isolates confident_answers and draft_answers in FusedContextResult", async () => {
      propose(store, {
        project: "test-app",
        title: "gRPC Microservices Gateway",
        content: "Draft plan to route edge requests through Envoy proxy to gRPC backends.",
        type: "architecture",
        draft: true,
      });

      const result = await resolveMuseContext(store, tempDir, {
        query: "gRPC Microservices Gateway",
        project: "test-app",
      });

      expect(result.relevant_memories.length).toBeGreaterThan(0);
      expect(result.confident_answers).toBeDefined();
      expect(result.confident_answers!.length).toBe(0);
      expect(result.draft_answers).toBeDefined();
      expect(result.draft_answers!.length).toBeGreaterThan(0);
      expect(result.mode).toBe("no_confident_match");
      expect(result.no_confident_match).toBe(true);
    });
  });
});
