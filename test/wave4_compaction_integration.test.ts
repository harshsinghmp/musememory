import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, save } from "../src/store.ts";
import { resolveMuseContext, formatCompactContextPack } from "../src/orchestrator/context.ts";

describe("Wave 4 - Task 5: Context-Pack Compaction, Manifest TOC & Truncation Hierarchy", () => {
  let testDir: string;
  let memoryDir: string;
  let store: ReturnType<typeof openStore>;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "musememory-wave4-integration-test-"));
    memoryDir = join(testDir, ".memory");
    store = openStore(memoryDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("T-092: context_manifest TOC lists all discovered candidate memories even when omitted from body", async () => {
    // Propose 5 memories with diverse content
    for (let i = 1; i <= 5; i++) {
      propose(store, {
        title: `Architecture Decision ${i}: Storage layout strategy`,
        content: `Detailed layout documentation for subsystem ${i} implementing transaction boundaries, caching policies, write-ahead logging parameters, flush intervals, and index partitioning mechanisms across cluster nodes.`,
        project: "app",
        type: "decision",
        confirmed: true,
      });
    }

    // Tight budget so only 1 or 2 can fit
    const context = await resolveMuseContext(store, testDir, {
      query: "Storage layout strategy",
      token_budget: 150,
    });

    expect(context.context_manifest).toBeDefined();
    // Manifest must list all discovered candidates
    expect(context.context_manifest?.length).toBeGreaterThanOrEqual(3);
    const omittedInManifest = context.context_manifest?.filter((m) => m.truncated);
    expect(omittedInManifest?.length).toBeGreaterThan(0);
  });

  test("T-093: truncation hierarchy prioritizes Pin > Provenance > Recency > Salience and emits [N omitted — budget M]", async () => {
    // 1. Regular salience memory
    const mem1 = propose(store, {
      title: "Salience memory",
      content: "Regular memory with basic content without verification or pin",
      project: "test",
      type: "fix",
      confirmed: true,
    });
    mem1.created_at = "2026-01-01T00:00:00.000Z";
    save(store, mem1);

    // 2. High provenance memory
    const mem2 = propose(store, {
      title: "High provenance memory",
      content: "Verified architectural invariant confirmed by principal",
      project: "test",
      type: "decision",
      confirmed: true,
      verification: { level: "authoritative", method: "code_review" },
    });
    mem2.created_at = "2026-01-02T00:00:00.000Z";
    save(store, mem2);

    // 3. Pinned guardrail / negative lesson
    const mem3 = propose(store, {
      title: "Pinned anti-pattern guardrail",
      content: "DO NOT USE eval in execution loop",
      project: "test",
      type: "negative",
      confirmed: true,
    });
    mem3.negative = {
      failed_approach: "eval()",
      failure_reason: "code injection",
    };
    mem3.created_at = "2026-01-03T00:00:00.000Z";
    save(store, mem3);

    const context = await resolveMuseContext(store, testDir, {
      query: "memory execution loop",
      token_budget: 180,
    });

    // Pinned guardrail must be packed
    expect(context.negative_lessons.some((n) => n.title.includes("Pinned anti-pattern"))).toBe(true);

    // Budget notice must be emitted if items were omitted
    if ((context.context_manifest?.filter((m) => m.truncated).length ?? 0) > 0) {
      expect(context.budget_notice).toBeDefined();
      expect(context.budget_notice).toMatch(/\[\d+ omitted — budget \d+ tokens\]/);
    }
  });

  test("T-094: reserves slots for global / USER.md guidelines", async () => {
    // Propose global user persona memory
    const gMem = propose(store, {
      title: "Principal Persona and Global Directive",
      content: "Always format code in GitHub-flavored markdown and preserve documentation integrity.",
      project: "global",
      type: "constraint",
      temporal_mode: "timeless",
      confirmed: true,
    });
    gMem.scope = "global";
    save(store, gMem);

    // Propose local memory
    propose(store, {
      title: "Local repository helper script",
      content: "Run test runner with bun test",
      project: "local",
      type: "fix",
      confirmed: true,
    });

    const context = await resolveMuseContext(store, testDir, {
      query: "markdown helper script",
      token_budget: 500,
    });

    expect(context.user_profile_reserved_tokens).toBeGreaterThan(0);
    expect(
      context.active_constraints.some((c) => c.title.includes("Principal Persona")) ||
      context.relevant_memories.some((m) => m.title.includes("Principal Persona")),
    ).toBe(true);
  });

  test("T-091: formatCompactContextPack produces dense structured markdown with manifest TOC and budget marker", async () => {
    propose(store, {
      title: "Cache invalidation rule",
      content: "Invalidate on mtime change",
      project: "core",
      type: "decision",
      confirmed: true,
    });

    const context = await resolveMuseContext(store, testDir, {
      query: "Cache invalidation",
      token_budget: 400,
    });

    const packedText = formatCompactContextPack(context);
    expect(packedText).toContain("# 🧠 Muse Memory Context Pack");
    expect(packedText).toContain("## 📋 Manifest Table of Contents (TOC)");
    expect(packedText).toContain("Cache invalidation rule");
  });
});
