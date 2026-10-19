import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, propose, confirm, supersede, get, type Store } from "../src/store.ts";
import { flagConflict } from "../src/quality/contradiction.ts";
import { runMigrations } from "../src/migrate.ts";

describe("T-100: Lineage FKs (supersedes_id & conflicts_with_id)", () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-lineage-fks-"));
    store = openStore(tmpDir);
  });

  afterEach(() => {
    store.db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("propose with supersedes sets supersedes_id in SQLite column and memory entry", () => {
    const original = propose(store, {
      title: "Architecture: PostgreSQL Database Engine",
      content: "We use Postgres for primary persistence.",
      project: "test-proj",
      type: "architecture",
      confirmed: true,
    });

    const replacement = propose(store, {
      title: "Architecture: CockroachDB Database Engine",
      content: "We migrated to CockroachDB for distributed SQL persistence.",
      project: "test-proj",
      type: "architecture",
      supersedes: original.id,
      confirmed: true,
    });

    expect(replacement.supersedes_id).toBe(original.id);
    expect(replacement.supersedes).toBe(original.id);

    // Verify directly from SQLite column
    const row = store.db!.query<{ id: string; supersedes_id: string }>(
      "SELECT id, supersedes_id FROM memories WHERE id = ?"
    ).get([replacement.id]);

    expect(row).toBeDefined();
    expect(row!.supersedes_id).toBe(original.id);

    // Verify read through store.get()
    const fetched = get(store, replacement.id);
    expect(fetched).toBeDefined();
    expect(fetched!.supersedes_id).toBe(original.id);
  });

  test("supersede() helper updates supersedes_id on the new entry", () => {
    const v1 = propose(store, {
      title: "Auth: RSA 2048 keys",
      content: "Auth tokens signed with RSA 2048 keys.",
      project: "auth-proj",
      type: "decision",
      confirmed: true,
    });

    const v2 = propose(store, {
      title: "Auth: Ed25519 keys",
      content: "Auth tokens signed with Ed25519 asymmetric keys.",
      project: "auth-proj",
      type: "decision",
      confirmed: true,
    });

    const superseded = supersede(store, v1.id, v2.id);
    expect(superseded).toBeDefined();
    expect(superseded!.status).toBe("superseded");

    const updatedV2 = get(store, v2.id);
    expect(updatedV2).toBeDefined();
    expect(updatedV2!.supersedes_id).toBe(v1.id);

    // Direct SQLite check
    const row = store.db!.query<{ supersedes_id: string }>(
      "SELECT supersedes_id FROM memories WHERE id = ?"
    ).get([v2.id]);
    expect(row!.supersedes_id).toBe(v1.id);
  });

  test("flagConflict() sets conflicts_with_id on incoming and existing entries", () => {
    const mem1 = propose(store, {
      title: "API Port Config",
      content: "The API server listens on port 8080.",
      project: "network-proj",
      type: "constraint",
      confirmed: true,
    });

    const mem2 = propose(store, {
      title: "API Port Config Divergence",
      content: "The API server listens on port 9090 in all environments.",
      project: "network-proj",
      type: "constraint",
      confirmed: true,
    });

    const { existing, incoming } = flagConflict(store, mem1.id, mem2.id, "Port conflict: 8080 vs 9090");

    expect(incoming.conflicts_with_id).toBe(mem1.id);
    expect(existing.conflicts_with_id).toBe(mem2.id);

    // Check SQLite columns
    const row1 = store.db!.query<{ conflicts_with_id: string }>(
      "SELECT conflicts_with_id FROM memories WHERE id = ?"
    ).get([mem1.id]);
    const row2 = store.db!.query<{ conflicts_with_id: string }>(
      "SELECT conflicts_with_id FROM memories WHERE id = ?"
    ).get([mem2.id]);

    expect(row1!.conflicts_with_id).toBe(mem2.id);
    expect(row2!.conflicts_with_id).toBe(mem1.id);
  });

  test("SQLite index enables fast query by supersedes_id and conflicts_with_id", () => {
    const a = propose(store, {
      title: "Root Architecture Node",
      content: "Root decision.",
      project: "dag-proj",
      type: "architecture",
    });

    const b = propose(store, {
      title: "Child Architecture Node",
      content: "Child decision superseding root.",
      project: "dag-proj",
      type: "architecture",
      supersedes: a.id,
    });

    const c = propose(store, {
      title: "Conflicting Node",
      content: "Contradicts child decision.",
      project: "dag-proj",
      type: "architecture",
      conflict_ids: [b.id],
    });

    // Query by supersedes_id index
    const supersedingRows = store.db!.query<{ id: string }>(
      "SELECT id FROM memories WHERE supersedes_id = ?"
    ).all([a.id]);
    expect(supersedingRows.map((r) => r.id)).toEqual([b.id]);

    // Query by conflicts_with_id index
    const conflictingRows = store.db!.query<{ id: string }>(
      "SELECT id FROM memories WHERE conflicts_with_id = ?"
    ).all([b.id]);
    expect(conflictingRows.map((r) => r.id)).toEqual([c.id]);
  });
});
