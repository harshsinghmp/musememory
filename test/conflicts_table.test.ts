import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, get, propose, listConflicts, getConflict, recordConflict } from "../src/store.ts";
import { detectConflict, flagConflict, resolveConflict } from "../src/quality/contradiction.ts";
import type { Store } from "../src/store.ts";

describe("T-086: Keep-Both Conflicts Table (never delete)", () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-conflicts-test-"));
    store = openStore(tmpDir);
  });

  afterEach(() => {
    if (store.db) {
      store.db.close();
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a conflicts table row upon flagConflict and preserves both memories (keep-both)", () => {
    const memA = propose(store, {
      title: "Primary DB is Postgres",
      content: "System uses PostgreSQL as the primary relational database.",
      type: "architecture",
      project: "web-api",
      confirmed: true,
    });

    const memB = propose(store, {
      title: "Primary DB is MySQL",
      content: "System uses MySQL as the primary relational database.",
      type: "architecture",
      project: "web-api",
      confirmed: true,
    });

    const flagged = flagConflict(
      store,
      memA.id,
      memB.id,
      "Conflicting primary database choice between Postgres and MySQL",
    );

    // 1. Keep-both invariant: both memories exist in store
    expect(flagged.existing.id).toBe(memA.id);
    expect(flagged.incoming.id).toBe(memB.id);
    expect(get(store, memA.id)).toBeDefined();
    expect(get(store, memB.id)).toBeDefined();
    expect(get(store, memA.id)?.status).toBe("conflicted");
    expect(get(store, memB.id)?.status).toBe("conflicted");

    // 2. Conflict record persisted in SQLite
    expect(flagged.conflict).toBeDefined();
    expect(flagged.conflict?.status).toBe("open");
    expect(flagged.conflict?.memory_a_id).toBe(memA.id);
    expect(flagged.conflict?.memory_b_id).toBe(memB.id);

    // 3. Queryable via listConflicts
    const openConflicts = listConflicts(store, { status: "open" });
    expect(openConflicts.length).toBe(1);
    expect(openConflicts[0].id).toBe(flagged.conflict!.id);
    expect(openConflicts[0].reason).toContain("Conflicting primary database choice");
  });

  it("updates conflict to resolved without deleting row or losing memories on resolveConflict(keep_both)", () => {
    const memA = propose(store, {
      title: "API Authentication uses JWT",
      content: "HTTP endpoints require Bearer JWT tokens.",
      type: "architecture",
      project: "auth",
      confirmed: true,
    });
    const memB = propose(store, {
      title: "API Authentication uses Session Cookies",
      content: "Web browser endpoints require Session Cookies.",
      type: "architecture",
      project: "auth",
      confirmed: true,
    });

    const { conflict } = flagConflict(
      store,
      memA.id,
      memB.id,
      "Dual auth mechanism ambiguity",
    );
    expect(conflict).toBeDefined();

    const result = resolveConflict(store, {
      winningId: memA.id,
      losingId: memB.id,
      strategy: "keep_both",
      reason: "Both are valid: JWT for mobile/api clients and Cookies for web dashboard",
      actor: "sec-architect",
    });

    expect(result.success).toBe(true);

    // Keep-both: both memories are still in store
    const storedA = get(store, memA.id);
    const storedB = get(store, memB.id);
    expect(storedA).toBeDefined();
    expect(storedB).toBeDefined();
    expect(storedA?.status).toBe("confirmed");
    expect(storedB?.status).toBe("confirmed");

    // Never delete: conflict row is still in SQLite conflicts table, now marked resolved
    const conflictInDb = getConflict(store, conflict!.id);
    expect(conflictInDb).not.toBeNull();
    expect(conflictInDb?.status).toBe("resolved");
    expect(conflictInDb?.resolution_strategy).toBe("keep_both");
    expect(conflictInDb?.resolved_by).toBe("sec-architect");
    expect(conflictInDb?.resolved_at).toBeDefined();
  });

  it("preserves conflict record and memories on resolveConflict(supersede)", () => {
    const memA = propose(store, {
      title: "Runtime Engine: Node.js",
      content: "Use Node runtime for all microservices.",
      type: "architecture",
      project: "core",
      confirmed: true,
    });
    const memB = propose(store, {
      title: "Runtime Engine: Bun",
      content: "Use Bun runtime for all microservices.",
      type: "architecture",
      project: "core",
      confirmed: true,
    });

    const { conflict } = flagConflict(
      store,
      memA.id,
      memB.id,
      "Conflicting runtime engine choice",
    );

    const result = resolveConflict(store, {
      winningId: memB.id,
      losingId: memA.id,
      strategy: "supersede",
      reason: "Migrated whole stack to Bun runtime v1.4+",
      actor: "lead-dev",
    });

    expect(result.success).toBe(true);

    // Winning confirmed, losing superseded (both still exist!)
    const storedA = get(store, memA.id);
    const storedB = get(store, memB.id);
    expect(storedA?.status).toBe("superseded");
    expect(storedB?.status).toBe("confirmed");

    // Conflict row is resolved and never deleted
    const allConflicts = listConflicts(store);
    expect(allConflicts.length).toBe(1);
    expect(allConflicts[0].id).toBe(conflict!.id);
    expect(allConflicts[0].status).toBe("resolved");
    expect(allConflicts[0].resolution_strategy).toBe("supersede");
    expect(allConflicts[0].resolved_by).toBe("lead-dev");
  });

  it("filters conflicts by memoryId and status", () => {
    const mem1 = propose(store, { title: "Topic 1", content: "Enable feature X", project: "p1" });
    const mem2 = propose(store, { title: "Topic 2", content: "Disable feature X", project: "p1" });
    const mem3 = propose(store, { title: "Topic 3", content: "Enable feature Y", project: "p2" });
    const mem4 = propose(store, { title: "Topic 4", content: "Disable feature Y", project: "p2" });

    const c1 = recordConflict(store, {
      memory_a_id: mem1.id,
      memory_b_id: mem2.id,
      status: "open",
      reason: "Feature X polarity contradiction",
    });

    const c2 = recordConflict(store, {
      memory_a_id: mem3.id,
      memory_b_id: mem4.id,
      status: "resolved",
      resolution_strategy: "reject",
      resolved_at: new Date().toISOString(),
      reason: "Feature Y contradiction resolved",
    });

    // Filter by status
    const openList = listConflicts(store, { status: "open" });
    expect(openList.length).toBe(1);
    expect(openList[0].id).toBe(c1.id);

    const resolvedList = listConflicts(store, { status: "resolved" });
    expect(resolvedList.length).toBe(1);
    expect(resolvedList[0].id).toBe(c2.id);

    // Filter by memoryId
    const mem3Conflicts = listConflicts(store, { memoryId: mem3.id });
    expect(mem3Conflicts.length).toBe(1);
    expect(mem3Conflicts[0].id).toBe(c2.id);

    const mem2Conflicts = listConflicts(store, { memoryId: mem2.id });
    expect(mem2Conflicts.length).toBe(1);
    expect(mem2Conflicts[0].id).toBe(c1.id);
  });

  it("integrates automated contradiction check during propose with conflict table recording", () => {
    propose(store, {
      title: "Port binding config",
      content: "Service always binds to port 3000 in production.",
      type: "operation",
      project: "gateway",
      confirmed: true,
    });

    // Propose conflicting entry with checkConflict: true
    const conflicting = propose(store, {
      title: "Port binding config",
      content: "Service always binds to port 8080 in production.",
      type: "operation",
      project: "gateway",
      confirmed: true,
      checkConflict: true,
    });

    expect(conflicting.status).toBe("conflicted");

    // Automatically recorded in conflicts table
    const recorded = listConflicts(store, { status: "open" });
    expect(recorded.length).toBe(1);
    expect(recorded[0].memory_b_id).toBe(conflicting.id);
    expect(recorded[0].reason).toContain("Conflicting port binding");
  });
});
