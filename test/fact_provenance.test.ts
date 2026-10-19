import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  openStore,
  propose,
  confirm,
  save,
  recordFactProvenance,
  getFactProvenance,
  listFactProvenance,
  type Store,
} from "../src/store.ts";
import { runMigrations, getSchemaVersion } from "../src/migrate.ts";

describe("T-099: fact_provenance append-only table, triple-unique index", () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-fact-prov-test-"));
    mkdirSync(join(tmpDir, ".memory"), { recursive: true });
    store = openStore(join(tmpDir, ".memory"));
  });

  afterEach(() => {
    if (store.db) {
      store.db.close();
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("applies Migration 9 and verifies fact_provenance schema & indexes", () => {
    expect(store.db).toBeDefined();
    expect(getSchemaVersion(store.db!)).toBeGreaterThanOrEqual(9);

    const tables = store.db!
      .query<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all()
      .map((t) => t.name);
    expect(tables).toContain("fact_provenance");

    const indexes = store.db!
      .query<{ name: string }>(`PRAGMA index_list(fact_provenance)`)
      .all()
      .map((r) => r.name);
    expect(indexes).toContain("idx_fact_provenance_triple");
    expect(indexes).toContain("idx_fact_provenance_mem_id");
    expect(indexes).toContain("idx_fact_provenance_entity");
    expect(indexes).toContain("idx_fact_provenance_created");
  });

  it("auto-records fact provenance during propose/save with explicit triples", () => {
    const mem = confirm(
      store,
      propose(store, {
        title: "Auth Service Architecture",
        content: "Auth service uses Redis for fast session token cache.",
        project: "test-proj",
        type: "architecture",
        source: "agent",
        session_id: "sess_123",
        triples: [
          {
            entity: "auth_service",
            relation: "cache",
            target: "redis",
            scope: "production",
          },
        ],
      }).id,
    )!;

    // Verify record was inserted in fact_provenance
    const prov = getFactProvenance(store, "auth service", "cache", "redis");
    expect(prov).not.toBeNull();
    expect(prov?.memory_id).toBe(mem.id);
    expect(prov?.entity).toBe("auth service");
    expect(prov?.relation).toBe("cache");
    expect(prov?.target).toBe("redis");
    expect(prov?.scope).toBe("production");
    expect(prov?.source).toBe("agent");
    expect(prov?.session_id).toBe("sess_123");
  });

  it("auto-records fact provenance from heuristic text extraction", () => {
    const mem = confirm(
      store,
      propose(store, {
        title: "Production database setup",
        content: "In production, the primary database uses PostgreSQL for relational storage.",
        project: "test-proj",
        type: "decision",
        source: "user",
      }).id,
    )!;

    const list = listFactProvenance(store, { memory_id: mem.id });
    expect(list.length).toBeGreaterThan(0);
    const dbProv = list.find((p) => p.relation === "database");
    expect(dbProv).toBeDefined();
    expect(dbProv?.target).toBe("postgresql");
    expect(dbProv?.scope).toBe("production");
    expect(dbProv?.source).toBe("user");
  });

  it("enforces triple-unique index: duplicate insertions of the same triple are ignored and preserve original provenance", () => {
    const mem1 = confirm(
      store,
      propose(store, {
        title: "Primary DB Setup V1",
        content: "Initial setup",
        project: "test-proj",
        type: "architecture",
        source: "agent_v1",
        triples: [
          {
            entity: "db_cluster",
            relation: "engine",
            target: "postgres",
            scope: "production",
          },
        ],
      }).id,
    )!;

    const initialProv = getFactProvenance(store, "db cluster", "engine", "postgres");
    expect(initialProv).not.toBeNull();
    expect(initialProv?.memory_id).toBe(mem1.id);
    expect(initialProv?.source).toBe("agent_v1");

    // Propose a second memory asserting the identical triple
    const mem2 = confirm(
      store,
      propose(store, {
        title: "Primary DB Setup V2",
        content: "Re-asserting identical engine",
        project: "test-proj",
        type: "architecture",
        source: "agent_v2",
        triples: [
          {
            entity: "db_cluster",
            relation: "engine",
            target: "postgres",
            scope: "production",
          },
        ],
      }).id,
    )!;

    // Prove the original provenance was preserved (append-only fact registry, not overwritten)
    const afterProv = getFactProvenance(store, "db cluster", "engine", "postgres");
    expect(afterProv).not.toBeNull();
    expect(afterProv?.id).toBe(initialProv!.id);
    expect(afterProv?.memory_id).toBe(mem1.id);
    expect(afterProv?.source).toBe("agent_v1");
  });

  it("supports listFactProvenance with granular filtering", () => {
    const mem = confirm(
      store,
      propose(store, {
        title: "Microservice Topology",
        content: "Gateway and payment services",
        project: "test-proj",
        type: "architecture",
        triples: [
          { entity: "api_gateway", relation: "port", target: "8080", scope: "production" },
          { entity: "payment_svc", relation: "port", target: "9000", scope: "production" },
          { entity: "payment_svc", relation: "database", target: "postgres", scope: "production" },
        ],
      }).id,
    )!;

    const allForMem = listFactProvenance(store, { memory_id: mem.id });
    expect(allForMem.length).toBe(3);

    const paymentFacts = listFactProvenance(store, { entity: "payment svc" });
    expect(paymentFacts.length).toBe(2);

    const portFacts = listFactProvenance(store, { relation: "port" });
    expect(portFacts.length).toBe(2);

    const postgresFacts = listFactProvenance(store, { target: "postgres" });
    expect(postgresFacts.length).toBe(1);
    expect(postgresFacts[0].entity).toBe("payment svc");
  });
});
