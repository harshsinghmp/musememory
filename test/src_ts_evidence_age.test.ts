import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  openStore,
  closeStore,
  propose,
  get,
  type Store,
} from "../src/store.ts";
import { computeDecayScore, computeStaleness, isStale } from "../src/retention.ts";
import { computeFactors } from "../src/retrieval.ts";
import { runMigrations, getSchemaVersion } from "../src/migrate.ts";

describe("T-090: src_ts Evidence-Age Stamping (Memory Freshness Capped by Evidence)", () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-src-ts-test-"));
    store = openStore(tmpDir);
  });

  afterEach(async () => {
    await closeStore(store);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Schema Migration v7", () => {
    it("applies migration 7 to add src_ts column and index to legacy store", () => {
      const dbFile = join(tmpDir, "legacy_v6.db");
      const db = new Database(dbFile);

      // Create a v6 schema state
      db.exec(`
        CREATE TABLE memories (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          project TEXT NOT NULL,
          type TEXT NOT NULL,
          status TEXT NOT NULL,
          salience REAL,
          reinforcement INTEGER,
          session_id TEXT,
          due_at TEXT,
          expires_at TEXT,
          valid_from TEXT,
          valid_to TEXT,
          valid_to_exact INTEGER DEFAULT 0,
          mem_path TEXT,
          last_accessed_at TEXT,
          access_count INTEGER,
          decay_score REAL DEFAULT 1.0,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        PRAGMA user_version = 6;
      `);

      // Seed row with src_ts in JSON data blob
      const pastTs = new Date(Date.now() - 100 * 86_400_000).toISOString();
      db.run(
        `INSERT INTO memories (id, title, content, project, type, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "legacy_mem_1",
          "Historical architecture",
          "Initial design before migration",
          "core",
          "architecture",
          "active",
          JSON.stringify({ src_ts: pastTs }),
          new Date().toISOString(),
          new Date().toISOString(),
        ],
      );

      expect(getSchemaVersion(db as any)).toBe(6);
      const newVersion = runMigrations(db as any);
      expect(newVersion).toBe(7);
      expect(getSchemaVersion(db as any)).toBe(7);

      const row = db
        .query<{ src_ts: string }, [string]>(`SELECT src_ts FROM memories WHERE id = ?`)
        .get("legacy_mem_1");
      expect(row?.src_ts).toBe(pastTs);

      // Verify index exists
      const indexes = db
        .query<{ name: string }, []>(`PRAGMA index_list(memories)`)
        .all()
        .map((i) => i.name);
      expect(indexes).toContain("idx_memories_src_ts");

      db.close();
    });
  });

  describe("Persistence & Auto-Stamping", () => {
    it("persists explicit src_ts on propose", () => {
      const oldEvidenceTime = new Date(Date.now() - 120 * 86_400_000).toISOString();
      const entry = propose(store, {
        title: "Legacy Bug Fix",
        content: "Fixed connection timeout in connection pool",
        type: "fix",
        project: "test",
        src_ts: oldEvidenceTime,
      });

      expect(entry.src_ts).toBe(oldEvidenceTime);

      const reloaded = get(store, entry.id);
      expect(reloaded).toBeDefined();
      expect(reloaded?.src_ts).toBe(oldEvidenceTime);
    });

    it("auto-stamps src_ts from evidence array timestamp if omitted", () => {
      const docEvidenceTimestamp = "2025-06-15T10:00:00.000Z";
      const entry = propose(store, {
        title: "API endpoint spec",
        content: "POST /v1/chat requires authorization header",
        type: "discovery",
        project: "test",
        evidence: [
          {
            id: "ev-1",
            type: "doc",
            timestamp: docEvidenceTimestamp,
            source: "docs/spec.md",
          },
        ],
      });

      expect(entry.src_ts).toBe(docEvidenceTimestamp);

      const reloaded = get(store, entry.id);
      expect(reloaded?.src_ts).toBe(docEvidenceTimestamp);
    });
  });

  describe("Freshness Decay Capped by Evidence Age", () => {
    it("evaluates freshness decay relative to src_ts rather than created_at", () => {
      const now = Date.now();
      const recentCreated = new Date(now - 1 * 86_400_000).toISOString(); // 1 day ago
      const oldEvidence = new Date(now - 150 * 86_400_000).toISOString(); // 150 days ago

      // Memory freshly minted from fresh evidence
      const freshScore = computeDecayScore(
        {
          type: "discovery", // 45 day half-life
          created_at: recentCreated,
          updated_at: recentCreated,
        },
        now,
      );

      // Memory freshly minted from 150-day-old evidence
      const staleEvidenceScore = computeDecayScore(
        {
          type: "discovery", // 45 day half-life
          created_at: recentCreated,
          updated_at: recentCreated,
          src_ts: oldEvidence,
        },
        now,
      );

      // Fresh memory should be close to 1.0 (1 day / 45 half-life ≈ 0.985)
      expect(freshScore).toBeGreaterThan(0.95);

      // Memory backed by 150-day-old evidence must decay severely (150 days / 45 ≈ 3.33 half-lives ≈ 0.10)
      expect(staleEvidenceScore).toBeLessThan(0.20);
      expect(staleEvidenceScore).toBeLessThan(freshScore);
    });

    it("evaluates staleness using src_ts", () => {
      const now = Date.now();
      const recentCreated = new Date(now - 2 * 86_400_000).toISOString();
      const oldEvidence = new Date(now - 200 * 86_400_000).toISOString();

      const entry = {
        type: "fix", // 120 day half-life
        created_at: recentCreated,
        updated_at: recentCreated,
        src_ts: oldEvidence,
      };

      const staleness = computeStaleness(entry, now);
      // 200 days on a 120 day half-life should be past staleness threshold
      expect(staleness).toBeGreaterThan(0.65);
      expect(isStale(entry, now)).toBe(true);

      // Without src_ts (only 2 days old), it would not be stale
      const entryWithoutSrc = {
        type: "fix",
        created_at: recentCreated,
        updated_at: recentCreated,
      };
      expect(isStale(entryWithoutSrc, now)).toBe(false);
    });

    it("applies recency decay penalty in computeFactors based on src_ts", () => {
      const now = Date.now();
      const recentTime = new Date(now - 1 * 86_400_000).toISOString();
      const oldEvidence = new Date(now - 120 * 86_400_000).toISOString(); // 4 months ago (4 * 30d)

      const freshMemory: any = {
        id: "mem-fresh",
        title: "Postgres optimization",
        content: "Set shared_buffers to 4GB",
        status: "active",
        type: "operation",
        project: "test",
        created_at: recentTime,
        updated_at: recentTime,
      };

      const staleEvidenceMemory: any = {
        ...freshMemory,
        id: "mem-stale-src",
        src_ts: oldEvidence,
      };

      const freshFactors = computeFactors(freshMemory, ["postgres"], { now });
      const staleFactors = computeFactors(staleEvidenceMemory, ["postgres"], { now });

      // fresh memory has 0 or minimal recency decay
      expect(Math.abs(freshFactors.recencyDecay)).toBe(0);

      // 120 days = 4 months -> -0.05 * 4 = -0.20 recency decay
      expect(staleFactors.recencyDecay).toBe(-0.20);
      expect(staleFactors.totalScore).toBeLessThan(freshFactors.totalScore);
    });

    it("preserves immortality for timeless rules and constraints even with old src_ts", () => {
      const now = Date.now();
      const ancientTime = new Date(now - 1000 * 86_400_000).toISOString();

      const constraintScore = computeDecayScore(
        {
          type: "constraint",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          src_ts: ancientTime,
        },
        now,
      );
      expect(constraintScore).toBe(1.0);

      const timelessScore = computeDecayScore(
        {
          type: "architecture",
          temporal_mode: "timeless",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          src_ts: ancientTime,
        },
        now,
      );
      expect(timelessScore).toBe(1.0);
    });
  });
});
