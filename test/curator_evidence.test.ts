import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, propose, get, type Store } from "../src/store.ts";
import { appendEvidence } from "../src/promotion/engine.ts";
import { getAuditTrail } from "../src/audit.ts";

describe("T-106: Curator Concept — Agent Appends Evidence, Deterministic Promotion Decides", () => {
  let tmpDir: string;
  let globalTmpDir: string;
  let store: Store;
  const origGlobalDir = process.env.MUSEMEMORY_GLOBAL_DIR;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-curator-test-"));
    globalTmpDir = mkdtempSync(join(tmpdir(), "muse-global-curator-"));
    process.env.MUSEMEMORY_GLOBAL_DIR = globalTmpDir;
    store = openStore(join(tmpDir, ".memory"));
  });

  afterEach(() => {
    if (origGlobalDir !== undefined) {
      process.env.MUSEMEMORY_GLOBAL_DIR = origGlobalDir;
    } else {
      delete process.env.MUSEMEMORY_GLOBAL_DIR;
    }
    store.db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(globalTmpDir, { recursive: true, force: true });
  });

  test("agent appends empirical evidence and records observation audit event", () => {
    const memory = propose(store, {
      title: "Query Optimization: Composite Index",
      content: "Use (tenant_id, created_at) index for paginated customer logs.",
      project: "billing",
      type: "discovery",
      confirmed: true,
    });

    const result = appendEvidence(
      store,
      memory.id,
      {
        type: "test",
        source: "bun test test/billing_perf.test.ts",
        excerpt: "Query latency dropped from 240ms to 4ms with composite index.",
        confidence: 0.98,
      },
      {
        actor: "sol_architect",
        applicationOutcome: "success",
      },
    );

    expect(result.memory_id).toBe(memory.id);
    expect(result.evidence_added).toBeDefined();
    expect(result.evidence_added.type).toBe("test");
    expect(result.evidence_added.source).toBe("bun test test/billing_perf.test.ts");
    expect(result.utility.successful_applications).toBe(1);
    expect(result.utility.application_count).toBe(1);
    expect(result.utility.reuse_success_rate).toBe(1.0);

    const fetched = get(store, memory.id)!;
    expect(fetched.evidence?.length).toBe(1);
    expect(fetched.evidence![0].excerpt).toContain("dropped from 240ms to 4ms");

    const auditTrail = getAuditTrail(store.memoryDir!);
    const obsEvent = auditTrail.find((e) => e.operation === "observation");
    expect(obsEvent).toBeDefined();
    expect(obsEvent!.entry_id).toBe(memory.id);
  });

  test("updates utility metrics for regression outcome", () => {
    const memory = propose(store, {
      title: "Async File Lock Pattern",
      content: "Always lock with 200ms spinwait.",
      project: "core",
      type: "architecture",
      confirmed: true,
    });

    const result = appendEvidence(
      store,
      memory.id,
      {
        type: "test",
        source: "ci_runner",
        excerpt: "Deadlock reproduced under 50 concurrent workers.",
      },
      {
        actor: "nexus_qa",
        applicationOutcome: "regression",
      },
    );

    expect(result.utility.application_count).toBe(1);
    expect(result.utility.regressions).toBe(1);
    expect(result.utility.successful_applications).toBe(0);
    expect(result.utility.reuse_success_rate).toBe(0);
  });

  test("deterministic promotion decides: candidate with sufficient evidence auto-promotes to project", () => {
    // A candidate memory starts at local scope
    const candidate = propose(store, {
      title: "Worker Graceful Shutdown",
      content: "Always drain queue before closing socket.",
      project: "queue",
      type: "fix",
      confirmed: false, // candidate status -> local scope
    });

    expect(candidate.status).toBe("candidate");

    // Agent curates with verified test evidence
    const curateRes = appendEvidence(
      store,
      candidate.id,
      {
        type: "test",
        source: "integration_suite",
        excerpt: "Verified 0 dropped jobs on SIGTERM.",
      },
      {
        actor: "agent",
        applicationOutcome: "success",
        autoEvaluate: true,
      },
    );

    // Deterministic promotion should promote LOCAL -> PROJECT
    expect(curateRes.promotion_result).toBeDefined();
    expect(curateRes.promotion_result!.promoted).toBe(true);
    expect(curateRes.promotion_result!.to_scope).toBe("project");

    const updated = get(store, candidate.id)!;
    expect(updated.status).toBe("confirmed");
    expect(updated.scope).toBe("project");
  });

  test("deterministic promotion blocks global scope until 5x success and 2-day corroboration", () => {
    const entry = propose(store, {
      title: "Universal Retry Decorator",
      content: "Exponential backoff retry with jitter on network requests.",
      project: "network",
      type: "architecture",
      confirmed: true, // project scope
    });

    // 1st success on day 1
    const res1 = appendEvidence(
      store,
      entry.id,
      { type: "code", timestamp: "2026-10-18T10:00:00.000Z" },
      { applicationOutcome: "success" },
    );
    expect(res1.promotion_evaluation.eligible).toBe(false);
    expect(res1.promotion_result).toBeUndefined();

    // 4 more successes on day 2
    for (let i = 0; i < 3; i++) {
      appendEvidence(
        store,
        entry.id,
        { type: "code", timestamp: "2026-10-19T10:00:00.000Z" },
        { applicationOutcome: "success" },
      );
    }

    // 5th success (reaching 5x threshold spanning 2 days)
    const res5 = appendEvidence(
      store,
      entry.id,
      { type: "human", source: "lead_architect", timestamp: "2026-10-19T12:00:00.000Z" },
      { applicationOutcome: "success", autoEvaluate: true },
    );

    expect(res5.promotion_evaluation.eligible).toBe(true);
    expect(res5.promotion_result).toBeDefined();
    expect(res5.promotion_result!.promoted).toBe(true);
    expect(res5.promotion_result!.to_scope).toBe("global");
  });

  test("throws error when trying to curate non-existent memory", () => {
    expect(() =>
      appendEvidence(store, "non_existent_123", { type: "code" }),
    ).toThrow("not found");
  });
});
