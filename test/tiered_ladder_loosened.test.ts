import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openStore, propose } from "../src/store.ts";
import {
  queryContext,
  formatPromptContext,
  executeRetrievalLadder,
  formatLoosenedBadge,
  labelEntryLadderRung,
} from "../src/retrieval.ts";
import { formatCompactContextPack } from "../src/orchestrator/context.ts";
import type { FusedContextResult } from "../src/orchestrator/types.ts";

describe("T-135: Tiered Retrieval Ladder & Loosened Match Labeling", () => {
  let tempDir: string;
  let store: any;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "muse-ladder-test-"));
    store = openStore(tempDir);
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("labels entry ladder rung and formats loosened badges correctly", () => {
    const dummyEntry: any = {
      id: "mem_1",
      title: "Sample Architectural Decision",
      content: "Details about database sharding and replica distribution across zones.",
      project: "core",
      status: "confirmed",
      type: "decision",
    };

    const scored1: any = { entry: dummyEntry, score: 0.85 };
    labelEntryLadderRung(scored1, 1);
    expect(scored1.ladder_rung).toBe(1);
    expect(scored1.is_loosened).toBe(false);
    expect(scored1.loosened_reason).toBeUndefined();
    expect(formatLoosenedBadge(scored1)).toBe("");

    const scored2: any = { entry: dummyEntry, score: 0.55 };
    labelEntryLadderRung(scored2, 2);
    expect(scored2.ladder_rung).toBe(2);
    expect(scored2.is_loosened).toBe(false);
    expect(scored2.loosened_reason).toBeUndefined();
    expect(formatLoosenedBadge(scored2)).toBe("");

    const scored3: any = { entry: dummyEntry, score: 0.32 };
    labelEntryLadderRung(scored3, 3, "score 0.32 below standard threshold 0.45");
    expect(scored3.ladder_rung).toBe(3);
    expect(scored3.is_loosened).toBe(true);
    expect(scored3.loosened_reason).toBe("score 0.32 below standard threshold 0.45");
    expect(formatLoosenedBadge(scored3)).toBe(" [LOOSENED MATCH (Rung 3) — score 0.32 below standard threshold 0.45]");
  });

  it("Rung 1: strict match satisfies threshold without descending ladder", () => {
    propose(store, {
      title: "PostgreSQL Database Connection Pooling",
      content: "Always configure pgBouncer connection pooling with transaction mode for microservices.",
      project: "finance",
      type: "decision",
      skipRetentionGate: true,
    });

    const result = executeRetrievalLadder(store, "PostgreSQL Database Connection Pooling", {
      project: "finance",
      strict_threshold: 0.40, // strict threshold easily met by exact title
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.ladder_rungs_used).toEqual([1]);
    expect(result.loosened_matches_count).toBe(0);
    expect(result.loosened_matches).toEqual([]);
    expect(result.results[0].ladder_rung).toBe(1);
    expect(result.results[0].is_loosened).toBe(false);
  });

  it("Rung 2: standard match descends from Rung 1 when strict threshold not met", () => {
    propose(store, {
      title: "Kafka Event Streaming Architecture",
      content: "Publish partitioned domain events to Kafka topic clusters with idempotency enabled.",
      project: "messaging",
      type: "decision",
      skipRetentionGate: true,
    });

    const result = executeRetrievalLadder(store, "Kafka topic events", {
      project: "messaging",
      strict_threshold: 0.95, // intentionally impossible strict threshold
      standard_threshold: 0.25, // reachable standard threshold
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.ladder_rungs_used).toEqual([1, 2]);
    expect(result.loosened_matches_count).toBe(0);
    expect(result.results[0].ladder_rung).toBe(2);
    expect(result.results[0].is_loosened).toBe(false);
  });

  it("Rung 3: loosened match tags candidates and provides explicit loosened reason", () => {
    propose(store, {
      title: "Redis Distributed Caching Layer",
      content: "Cache intermediate token validation tokens in Redis with 15-minute sliding TTL.",
      project: "auth",
      type: "decision",
      skipRetentionGate: true,
    });

    const result = executeRetrievalLadder(store, "redis validation", {
      project: "auth",
      strict_threshold: 0.98,
      standard_threshold: 0.95,
      loosened_threshold: 0.10,
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.ladder_rungs_used).toEqual([1, 2, 3]);
    expect(result.loosened_matches_count).toBeGreaterThan(0);
    expect(result.loosened_matches?.length).toBe(result.loosened_matches_count);

    const loosened = result.results.find((r) => r.is_loosened);
    expect(loosened).toBeDefined();
    expect(loosened?.ladder_rung).toBe(3);
    expect(loosened?.loosened_reason).toContain("loosened_threshold");
  });

  it("Rung 3: relaxes project scope when project matches are absent", () => {
    propose(store, {
      title: "Global Authentication Invariant",
      content: "All bearer tokens must contain issuer and audience claims validated against JWKS.",
      project: "global-auth",
      type: "constraint",
      skipRetentionGate: true,
    });

    const result = executeRetrievalLadder(store, "bearer tokens issuer", {
      project: "billing-service", // target project has no matches
      strict_threshold: 0.90,
      standard_threshold: 0.85,
      loosened_threshold: 0.10,
      allow_scope_relaxation: true,
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.ladder_rungs_used).toEqual([1, 2, 3]);
    const scopeRelaxed = result.results.find((r) => r.is_loosened);
    expect(scopeRelaxed).toBeDefined();
    expect(scopeRelaxed?.loosened_reason).toContain("loosened_scope: relaxed project 'billing-service' constraint to global");
  });

  it("queryContext integrates with enable_ladder flag seamlessly", () => {
    propose(store, {
      title: "Rate Limiter Leaky Bucket Implementation",
      content: "Implement token bucket rate limiting on inbound public API gateway endpoints.",
      project: "gateway",
      type: "decision",
      skipRetentionGate: true,
    });

    const result = queryContext(store, "leaky token bucket", {
      enable_ladder: true,
      strict_threshold: 0.95,
      standard_threshold: 0.20,
    });

    expect(result.ladder_rungs_used).toBeDefined();
    expect(result.ladder_rungs_used?.length).toBeGreaterThan(0);
    expect(result.results.length).toBeGreaterThan(0);
  });

  it("formatPromptContext renders loosened match badge in markdown headers", () => {
    propose(store, {
      title: "Kubernetes Resource Limits Policy",
      content: "Ensure CPU and memory limits are defined on every container deployment pod.",
      project: "infra",
      type: "decision",
      skipRetentionGate: true,
    });

    const formatted = formatPromptContext(store, undefined, "kubernetes deployment limits", {
      enable_ladder: true,
      strict_threshold: 0.99,
      standard_threshold: 0.98,
      loosened_threshold: 0.10,
      depth: "L2",
    });

    expect(formatted.loosened_matches_count).toBeGreaterThan(0);
    expect(formatted.markdown).toContain("[LOOSENED MATCH (Rung 3)");
  });

  it("formatCompactContextPack renders loosened match advisory notice", () => {
    const mockFused: FusedContextResult = {
      tokens_used: 120,
      token_budget: 1000,
      active_constraints: [],
      relevant_memories: [],
      negative_lessons: [],
      code_anchors: [],
      suggested_next_steps: [],
      loosened_matches_count: 3,
    };

    const rendered = formatCompactContextPack(mockFused);
    expect(rendered).toContain("> ⚠️ **Loosened Matches Admitted**: 3 candidate(s) retrieved via relaxed criteria (Rung 3).");
  });
});
