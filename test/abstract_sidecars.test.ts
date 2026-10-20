import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, type Store } from "../src/store.ts";
import {
  generateL0Abstract,
  generateL1Abstract,
  buildAbstractSidecar,
  saveAbstractSidecar,
  loadAbstractSidecar,
  listAbstractSidecars,
  saveAbstractSidecarToDb,
  loadAbstractSidecarFromDb,
  ensureAbstractSidecar,
  sidecarFilePath,
  computeMemoryContentHash,
} from "../src/store/sidecars.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("T-122: L0/L1 abstract sidecars (clean-room MIT implementation)", () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-sidecars-test-"));
    store = openStore(tmpDir);
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  const sampleEntry: MemoryEntry = {
    id: "mem-sidecar-1",
    title: "PostgreSQL connection pool architecture",
    content: `# Connection Pooling Architecture
We use PgBouncer in transaction pooling mode for client connection scaling.

Key considerations:
- Max client connections set to 500 with default pool size of 20 per database.
- Prepared statements must use transaction-level named parameter workarounds.
- Health checks ping every 10 seconds via \`check_postgres_health\`.

Do not configure session pooling as it leaks backend connections.`,
    type: "decision",
    status: "active",
    confidence: 0.95,
    project: "test",
    tags: ["database", "postgres", "pgbouncer"],
    graph: {
      provider: "ast",
      symbol_names: ["PgBouncer", "check_postgres_health"],
      affected_paths: ["config/pgbouncer.ini"],
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  describe("generateL0Abstract", () => {
    it("generates concise single-line executive summary under 120 characters", () => {
      const l0 = generateL0Abstract(sampleEntry);
      expect(l0.length).toBeLessThanOrEqual(120);
      expect(l0).toContain("PostgreSQL connection pool architecture");
      expect(l0).not.toContain("#"); // stripped markdown
      expect(l0).not.toContain("\n"); // strictly single line
    });

    it("truncates long titles cleanly at word boundaries with ellipsis", () => {
      const longEntry: MemoryEntry = {
        ...sampleEntry,
        title: "Extremely long title describing an intricate microservices architectural decision involving distributed transaction coordination across heterogenous databases and messaging fabrics",
      };
      const l0 = generateL0Abstract(longEntry);
      expect(l0.length).toBeLessThanOrEqual(120);
      expect(l0.endsWith("...")).toBe(true);
      expect(l0).not.toContain("\n");
    });
  });

  describe("generateL1Abstract", () => {
    it("generates structured L1 abstract with summary, key takeaways, entities, and token count", () => {
      const l1 = generateL1Abstract(sampleEntry);

      expect(l1.summary).toBeDefined();
      expect(l1.summary.length).toBeGreaterThan(10);
      expect(l1.summary.length).toBeLessThanOrEqual(250);

      expect(l1.key_takeaways.length).toBeGreaterThanOrEqual(2);
      expect(l1.key_takeaways.length).toBeLessThanOrEqual(4);
      expect(l1.key_takeaways.some((t) => t.includes("500") || t.includes("PgBouncer"))).toBe(true);

      expect(l1.entities).toContain("database");
      expect(l1.entities).toContain("postgres");
      expect(l1.entities).toContain("pgbouncer");
      expect(l1.entities).toContain("check_postgres_health");

      expect(l1.estimated_tokens).toBeGreaterThan(0);
    });
  });

  describe("buildAbstractSidecar", () => {
    it("builds complete sidecar with content hash and ISO timestamp", () => {
      const sidecar = buildAbstractSidecar(sampleEntry);

      expect(sidecar.id).toBe(sampleEntry.id);
      expect(sidecar.l0).toBeDefined();
      expect(sidecar.l1).toBeDefined();
      expect(sidecar.source_content_hash).toBe(computeMemoryContentHash(sampleEntry.title, sampleEntry.content));
      expect(Date.parse(sidecar.generated_at)).not.toBeNaN();
    });
  });

  describe("filesystem persistence", () => {
    it("saves and loads abstract sidecars to disk", () => {
      const sidecar = buildAbstractSidecar(sampleEntry);
      saveAbstractSidecar(store.memoryDir!, sidecar);

      expect(existsSync(sidecarFilePath(store.memoryDir!, sampleEntry.id))).toBe(true);

      const loaded = loadAbstractSidecar(store.memoryDir!, sampleEntry.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(sidecar.id);
      expect(loaded!.l0).toBe(sidecar.l0);
      expect(loaded!.l1.key_takeaways).toEqual(sidecar.l1.key_takeaways);

      const all = listAbstractSidecars(store.memoryDir!);
      expect(all.length).toBe(1);
      expect(all[0].id).toBe(sampleEntry.id);
    });
  });

  describe("SQLite persistence", () => {
    it("saves and loads abstract sidecars from SQLite cache", () => {
      expect(store.db).toBeDefined();
      const sidecar = buildAbstractSidecar(sampleEntry);

      saveAbstractSidecarToDb(store.db!, sidecar);

      const loaded = loadAbstractSidecarFromDb(store.db!, sampleEntry.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(sidecar.id);
      expect(loaded!.l0).toBe(sidecar.l0);
      expect(loaded!.l1.summary).toBe(sidecar.l1.summary);
      expect(loaded!.source_content_hash).toBe(sidecar.source_content_hash);
    });
  });

  describe("ensureAbstractSidecar", () => {
    it("generates sidecar on first call and reuses cached on subsequent call", () => {
      const first = ensureAbstractSidecar(store, sampleEntry);
      expect(first).toBeDefined();
      expect(first.id).toBe(sampleEntry.id);

      // Second call should return cached version
      const second = ensureAbstractSidecar(store, sampleEntry);
      expect(second.generated_at).toBe(first.generated_at);
      expect(second.source_content_hash).toBe(first.source_content_hash);
    });

    it("regenerates sidecar when content changes", () => {
      const initial = ensureAbstractSidecar(store, sampleEntry);

      const updatedEntry: MemoryEntry = {
        ...sampleEntry,
        content: "Completely revised content for PostgreSQL connection pooling using Odyssey proxy.",
      };

      const refreshed = ensureAbstractSidecar(store, updatedEntry);
      expect(refreshed.source_content_hash).not.toBe(initial.source_content_hash);
      expect(refreshed.l1.summary).toContain("Odyssey");
    });
  });
});
