import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, propose, confirm, supersede, markStale, reject, deleteEntry } from "../src/store.ts";
import { recordAuditEvent, getAuditTrail } from "../src/audit.ts";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "audit-test-"));
}

describe("operational governance & audit trail", () => {
  test("recordAuditEvent and getAuditTrail write and query append-only records", () => {
    const root = temp();
    recordAuditEvent(root, {
      operation: "propose",
      entry_id: "test-1",
      project: "projA",
      actor: "agent",
      details: { note: "first audit event" },
    });
    recordAuditEvent(root, {
      operation: "confirm",
      entry_id: "test-1",
      project: "projA",
      actor: "user",
    });

    const trail = getAuditTrail(root);
    expect(trail.length).toBe(2);
    // Reverse chronological order
    expect(trail[0].operation).toBe("confirm");
    expect(trail[1].operation).toBe("propose");

    const filtered = getAuditTrail(root, { operation: "confirm" });
    expect(filtered.length).toBe(1);
    expect(filtered[0].entry_id).toBe("test-1");

    rmSync(root, { recursive: true, force: true });
  });

  test("store mutations automatically record audit events", () => {
    const root = temp();
    const store = openStore(root);

    // 1. Propose
    const entry1 = propose(store, {
      project: "test-proj",
      title: "Decision Alpha",
      content: "Alpha specifications",
    });

    // 2. Confirm
    confirm(store, entry1.id);

    // 3. Propose new & Confirm
    const entry2 = propose(store, {
      project: "test-proj",
      title: "Decision Beta",
      content: "Beta specifications",
      confirmed: true,
    });

    // 4. Supersede
    supersede(store, entry1.id, entry2.id);

    // 5. Mark Stale
    const entry3 = propose(store, {
      project: "test-proj",
      title: "Discovery Gamma",
      content: "Gamma notes",
      confirmed: true,
    });
    markStale(store, entry3.id, "no longer valid");

    // 6. Reject
    const entry4 = propose(store, {
      project: "test-proj",
      title: "Candidate Delta",
      content: "Delta notes",
    });
    reject(store, entry4.id);

    // 7. Delete
    deleteEntry(store, entry4.id, "cleaned up rejected candidate");

    const trail = getAuditTrail(root);
    expect(trail.length).toBeGreaterThanOrEqual(7);

    const ops = trail.map((t) => t.operation);
    expect(ops).toContain("propose");
    expect(ops).toContain("confirm");
    expect(ops).toContain("supersede");
    expect(ops).toContain("mark_stale");
    expect(ops).toContain("reject");
    expect(ops).toContain("delete");

    rmSync(root, { recursive: true, force: true });
  });
});
