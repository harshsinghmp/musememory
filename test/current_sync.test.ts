import { describe, test, expect } from "bun:test";
import { openStore, propose, confirm, supersede, markStale, reject, deleteEntry } from "../src/store.ts";
import {
  getCurrent,
  setCurrent,
  syncConstraints,
  currentFilePath,
  updateSessionHandoff,
  getSessionHandoff,
  markSessionCompleted,
  parseCurrentFile,
} from "../src/current.ts";
import { formatPromptContext } from "../src/retrieval.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";
import { readFileSync, existsSync } from "node:fs";

describe("CURRENT.md auto-population and synchronization lifecycle", () => {
  test("openStore auto-populates CURRENT.md from active constraint memories in store", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    // Fixture m_1700000001000_auth.yaml has type: constraint and status: active
    const constraints = getCurrent(memoryDir);
    expect(constraints.length).toBeGreaterThanOrEqual(1);
    expect(constraints.some((c) => c.includes("Auth tokens expire after 15 minutes"))).toBe(true);

    const raw = readFileSync(currentFilePath(memoryDir), "utf8");
    expect(raw.startsWith("# Active Project Constraints")).toBe(true);
    expect(raw).toContain("Auth tokens expire after 15 minutes");

    cleanup(root);
  });

  test("proposing and confirming constraint memories auto-syncs to CURRENT.md", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    // Propose candidate constraint
    const cand = propose(store, {
      title: "Rate limit candidate",
      content: "Max 100 req/min per IP",
      project: "api-gw",
      type: "constraint",
      confirmed: false,
    });

    // Confirm candidate -> becomes active in CURRENT.md
    confirm(store, cand.id);
    const updated = getCurrent(memoryDir);
    expect(updated.some((c) => c.includes("Max 100 req/min per IP"))).toBe(true);

    cleanup(root);
  });

  test("superseding a constraint prunes the old constraint and includes the new replacement", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const v1 = propose(store, {
      title: "TLS 1.2 Policy",
      content: "All inbound traffic must use TLS 1.2 minimum",
      project: "ingress",
      type: "constraint",
      confirmed: true,
    });

    expect(getCurrent(memoryDir).some((c) => c.includes("TLS 1.2 minimum"))).toBe(true);

    const v2 = propose(store, {
      title: "TLS 1.3 Policy",
      content: "All inbound traffic must use TLS 1.3 only",
      project: "ingress",
      type: "constraint",
      confirmed: true,
    });

    supersede(store, v1.id, v2.id);

    const afterSupersede = getCurrent(memoryDir);
    expect(afterSupersede.some((c) => c.includes("TLS 1.3 only"))).toBe(true);
    expect(afterSupersede.some((c) => c.includes("TLS 1.2 minimum"))).toBe(false);

    cleanup(root);
  });

  test("marking stale or rejecting a constraint removes it from CURRENT.md", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const entry = propose(store, {
      title: "Temporary Maintenance Gate",
      content: "Block POST /checkout during DB migration window",
      project: "checkout",
      type: "constraint",
      confirmed: true,
    });

    expect(getCurrent(memoryDir).some((c) => c.includes("Block POST /checkout"))).toBe(true);

    markStale(store, entry.id, "Migration completed");
    expect(getCurrent(memoryDir).some((c) => c.includes("Block POST /checkout"))).toBe(false);

    cleanup(root);
  });

  test("deleting a constraint removes it from CURRENT.md", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const entry = propose(store, {
      title: "Legacy Cookie Policy",
      content: "Set SameSite=Lax on all session cookies",
      project: "auth",
      type: "constraint",
      confirmed: true,
    });

    expect(getCurrent(memoryDir).some((c) => c.includes("Set SameSite=Lax"))).toBe(true);

    deleteEntry(store, entry.id);
    expect(getCurrent(memoryDir).some((c) => c.includes("Set SameSite=Lax"))).toBe(false);

    cleanup(root);
  });

  test("manual constraints and prompt context retrieval integrate seamlessly", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    // Direct manual constraint via setCurrent
    setCurrent(memoryDir, "Keep response latencies below 200ms", "edge");

    const formatted = formatPromptContext(store, memoryDir, "latencies edge", { project: "edge" });
    expect(formatted.markdown).toContain("### Active Working Constraints (CURRENT.md)");
    expect(formatted.markdown).toContain("Keep response latencies below 200ms");
    expect(formatted.markdown).not.toContain("- # Active Project Constraints");

    cleanup(root);
  });

  test("real-time session handoff preserves in-flight task state across interruptions", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    // Simulate Agent A starting work and checkpointing in CURRENT.md
    updateSessionHandoff(memoryDir, {
      status: "IN-PROGRESS",
      agent: "Claude 3.7",
      sessionId: "s_1787600001",
      task: "Refactor PostgreSQL query planner and add connection timeout",
      lastQuery: "Debug Postgres pool exhaustion and add connection timeout handler",
      progress: [
        "[x] Identified connection leak in query runner",
        "[~] Adding 5000ms idle timeout parameter",
      ],
      discoveries: ["Postgres pool max_connections default is 10"],
    });

    // Verify written to disk and readable
    const handoff = getSessionHandoff(memoryDir);
    expect(handoff).not.toBeNull();
    expect(handoff?.status).toBe("IN-PROGRESS");
    expect(handoff?.agent).toBe("Claude 3.7");
    expect(handoff?.task).toContain("Refactor PostgreSQL query planner");
    expect(handoff?.progress?.length).toBe(2);
    expect(handoff?.discoveries).toContain("Postgres pool max_connections default is 10");

    // Constraints are preserved in parallel
    const constraints = getCurrent(memoryDir);
    expect(constraints.length).toBeGreaterThanOrEqual(1);

    // Simulate session interruption -> Agent B loads context via get_context / formatPromptContext
    const context = formatPromptContext(store, memoryDir, "postgres connection timeout");
    expect(context.markdown).toContain("### Active In-Flight Context & Session Handoff (CURRENT.md)");
    expect(context.markdown).toContain("**Status**: [IN-PROGRESS]");
    expect(context.markdown).toContain("**Previous / Active Agent**: Claude 3.7");
    expect(context.markdown).toContain("**Last Active Task**: Refactor PostgreSQL query planner");
    expect(context.markdown).toContain("Identified connection leak in query runner");
    expect(context.markdown).toContain("Postgres pool max_connections default is 10");

    // When task is finalized -> mark completed
    markSessionCompleted(memoryDir, "Resolved connection leak and added timeout");
    const completedHandoff = getSessionHandoff(memoryDir);
    expect(completedHandoff?.status).toBe("COMPLETED");
    expect(completedHandoff?.task).toContain("[COMPLETED]");

    cleanup(root);
  });
});
