import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, propose, supersede, markStale, type Store } from "../src/store.ts";
import { evaluateAsOf, queryAsOf, queryContext } from "../src/retrieval.ts";
import { RetrievalEngine } from "../src/retrieval/engine.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("T-083: as_of queries returning {results, undetermined}", () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-asof-"));
    store = openStore(tmpDir);
  });

  afterEach(() => {
    store.db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("evaluateAsOf unit evaluation", () => {
    test("rejects fact not yet created at target time", () => {
      const entry: MemoryEntry = {
        id: "m_1_future",
        title: "Future policy",
        content: "Drafting in 2027",
        project: "test",
        status: "confirmed",
        created_at: "2027-01-01T00:00:00.000Z",
        updated_at: "2027-01-01T00:00:00.000Z",
        source: "manual",
        tags: [],
      };
      const verdict = evaluateAsOf(entry, "2026-06-01T00:00:00.000Z");
      expect(verdict.status).toBe("invalid");
      expect(verdict.reason).toBe("not_yet_valid");
    });

    test("accepts active fact with no valid_to", () => {
      const entry: MemoryEntry = {
        id: "m_2_active",
        title: "Active truth",
        content: "Universal rule",
        project: "test",
        status: "confirmed",
        created_at: "2025-01-01T00:00:00.000Z",
        updated_at: "2025-01-01T00:00:00.000Z",
        source: "manual",
        tags: [],
      };
      const verdict = evaluateAsOf(entry, "2026-06-01T00:00:00.000Z");
      expect(verdict.status).toBe("valid");
      expect(verdict.reason).toBe("active_no_cessation");
    });

    test("rejects fact whose valid_to is prior to target time", () => {
      const entry: MemoryEntry = {
        id: "m_3_ceased",
        title: "Old cert",
        content: "Expired cert",
        project: "test",
        status: "expired",
        created_at: "2025-01-01T00:00:00.000Z",
        updated_at: "2025-06-01T00:00:00.000Z",
        valid_to: "2025-12-31T23:59:59.000Z",
        valid_to_exact: true,
        source: "manual",
        tags: [],
      };
      const verdict = evaluateAsOf(entry, "2026-06-01T00:00:00.000Z");
      expect(verdict.status).toBe("invalid");
      expect(verdict.reason).toBe("ceased_before_target");
    });

    test("accepts fact with exact valid_to after target time", () => {
      const entry: MemoryEntry = {
        id: "m_4_exact_valid",
        title: "2026 contract",
        content: "Valid for all 2026",
        project: "test",
        status: "active",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        valid_to: "2026-12-31T23:59:59.000Z",
        valid_to_exact: true,
        source: "manual",
        tags: [],
      };
      const verdict = evaluateAsOf(entry, "2026-06-15T12:00:00.000Z");
      expect(verdict.status).toBe("valid");
      expect(verdict.reason).toBe("exact_boundary_valid");
    });

    test("marks fact as undetermined when valid_to_exact is false and target is before closeout", () => {
      const entry: MemoryEntry = {
        id: "m_5_undetermined",
        title: "Legacy endpoint",
        content: "Discovered dead during audit",
        project: "test",
        status: "stale",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-08-01T00:00:00.000Z",
        valid_to: "2026-08-01T00:00:00.000Z",
        valid_to_exact: false,
        source: "manual",
        tags: [],
      };
      // On April 1, exact historical cessation date is unknown (invent no dates)
      const verdict = evaluateAsOf(entry, "2026-04-01T00:00:00.000Z");
      expect(verdict.status).toBe("undetermined");
      expect(verdict.reason).toBe("inexact_boundary_observation_lag");
    });
  });

  describe("queryAsOf integration with store", () => {
    test("segregates valid results and undetermined facts at target timestamp", () => {
      // 1. Fact definitively valid in June 2026 (exact valid_to Dec 2026)
      const validEntry = propose(store, {
        content: "API endpoint v2 is primary",
        project: "api",
        confirmed: true,
        created_at: "2026-01-01T00:00:00.000Z",
        valid_to: "2026-12-31T23:59:59.000Z",
        valid_to_exact: true,
      });

      // 2. Fact observed stale in August 2026 with inexact closeout
      const staleEntry = propose(store, {
        content: "API endpoint v1 fallback",
        project: "api",
        confirmed: true,
        created_at: "2026-01-01T00:00:00.000Z",
      });
      markStale(store, staleEntry.id, "Discovered offline in Aug audit", {
        valid_to: "2026-08-01T00:00:00.000Z",
        valid_to_exact: false,
      });

      // 3. Fact that was only created in September 2026
      propose(store, {
        content: "API endpoint v3 experimental",
        project: "api",
        confirmed: true,
        created_at: "2026-09-01T00:00:00.000Z",
      });

      // 4. Fact that had exact cessation in March 2026
      propose(store, {
        content: "API endpoint alpha preview",
        project: "api",
        confirmed: true,
        created_at: "2026-01-01T00:00:00.000Z",
        valid_to: "2026-03-01T00:00:00.000Z",
        valid_to_exact: true,
      });

      // Query as of June 15, 2026
      const result = queryAsOf(store, "endpoint", "2026-06-15T12:00:00.000Z");

      expect(result.as_of).toBe("2026-06-15T12:00:00.000Z");
      // Results must contain v2 (definitively valid)
      const resultIds = result.results.map((r) => r.entry.id);
      expect(resultIds).toContain(validEntry.id);

      // Undetermined must contain v1 (observation lag, cessation unknown)
      const undeterminedIds = result.undetermined.map((r) => r.entry.id);
      expect(undeterminedIds).toContain(staleEntry.id);

      // Neither should contain v3 (future) or alpha (expired in March)
      expect(resultIds).not.toContain("API endpoint v3 experimental");
      expect(undeterminedIds).not.toContain("API endpoint alpha preview");
    });

    test("retrieval through queryContext with as_of option returns matching contract", () => {
      const active = propose(store, {
        content: "Database pool max connections: 50",
        project: "db",
        confirmed: true,
        created_at: "2026-01-01T00:00:00.000Z",
      });

      const res = queryContext(store, "pool max connections", {
        as_of: "2026-05-01T00:00:00.000Z",
      });

      expect(res.as_of).toBe("2026-05-01T00:00:00.000Z");
      expect(res.results.map((r) => r.entry.id)).toContain(active.id);
      expect(res.undetermined).toBeDefined();
    });

    test("RetrievalEngine.searchAsOf returns exact mode with undetermined list", () => {
      const entry = propose(store, {
        content: "Cache TTL is 3600 seconds",
        project: "cache",
        confirmed: true,
        created_at: "2026-01-01T00:00:00.000Z",
      });

      const res = RetrievalEngine.searchAsOf(store, tmpDir, "Cache TTL", "2026-06-01T00:00:00.000Z");
      expect(res.mode).toBe("exact");
      expect(res.as_of).toBe("2026-06-01T00:00:00.000Z");
      expect(res.results.some((r) => r.entry.id === entry.id)).toBe(true);
      expect(Array.isArray(res.undetermined)).toBe(true);
    });
  });
});
