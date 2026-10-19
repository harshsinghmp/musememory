import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, propose, supersede, type Store } from "../src/store.ts";
import { searchTemporal } from "../src/retrieval.ts";
import { RetrievalEngine } from "../src/retrieval/engine.ts";

describe("T-085: searchTemporal(atTime) default-excluding superseded", () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-temporal-"));
    store = openStore(tmpDir);
  });

  afterEach(() => {
    store.db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("default-excludes memories superseded before or at atTime", () => {
    // Memory 1: created Jan 1, superseded March 1
    const v1 = propose(store, {
      content: "Framework: React 18",
      project: "web",
      confirmed: true,
      created_at: "2026-01-01T00:00:00.000Z",
    });
    const v2 = propose(store, {
      content: "Framework: React 19",
      project: "web",
      confirmed: true,
      created_at: "2026-03-01T00:00:00.000Z",
    });
    supersede(store, v1.id, v2.id, {
      valid_to: "2026-03-01T00:00:00.000Z",
      valid_to_exact: true,
    });

    // Query on June 1, 2026 (after supersession)
    const postSupersession = searchTemporal(store, "Framework", "2026-06-01T00:00:00.000Z");
    const postIds = postSupersession.results.map((r) => r.entry.id);
    expect(postIds).toContain(v2.id);
    expect(postIds).not.toContain(v1.id);

    // Query on Feb 1, 2026 (before supersession, when v1 was current and v2 didn't exist)
    const preSupersession = searchTemporal(store, "Framework", "2026-02-01T00:00:00.000Z", {
      includeSuperseded: true, // v1 is superseded in current state, but was active historically
    });
    const preIds = preSupersession.results.map((r) => r.entry.id);
    expect(preIds).toContain(v1.id);
    expect(preIds).not.toContain(v2.id); // v2 created in March
  });

  test("respects includeSuperseded: true flag", () => {
    const oldCert = propose(store, {
      content: "SSL cert: Let's Encrypt 2025",
      project: "ops",
      confirmed: true,
      created_at: "2025-01-01T00:00:00.000Z",
    });
    const newCert = propose(store, {
      content: "SSL cert: Let's Encrypt 2026",
      project: "ops",
      confirmed: true,
      created_at: "2026-01-01T00:00:00.000Z",
    });
    supersede(store, oldCert.id, newCert.id, {
      valid_to: "2026-01-01T00:00:00.000Z",
      valid_to_exact: true,
    });

    // Without includeSuperseded: only newCert is returned
    const defaultSearch = searchTemporal(store, "SSL cert", "2026-05-01T00:00:00.000Z");
    expect(defaultSearch.results.map((r) => r.entry.id)).toContain(newCert.id);
    expect(defaultSearch.results.map((r) => r.entry.id)).not.toContain(oldCert.id);

    // With includeSuperseded: true
    const withSuperseded = searchTemporal(store, "SSL cert", "2026-05-01T00:00:00.000Z", {
      includeSuperseded: true,
    });
    expect(withSuperseded.results.map((r) => r.entry.id)).toContain(newCert.id);
  });

  test("RetrievalEngine.searchTemporal coordinates point-in-time search", () => {
    const memory = propose(store, {
      content: "Kafka cluster replication factor: 3",
      project: "data",
      confirmed: true,
      created_at: "2026-01-01T00:00:00.000Z",
    });

    const res = RetrievalEngine.searchTemporal(store, tmpDir, "Kafka cluster", "2026-04-01T00:00:00.000Z");
    expect(res.mode).toBe("exact");
    expect(res.as_of).toBe("2026-04-01T00:00:00.000Z");
    expect(res.results.some((r) => r.entry.id === memory.id)).toBe(true);
  });

  test("throws error on unparseable temporal timestamp", () => {
    expect(() => {
      searchTemporal(store, "test", "not-a-valid-date");
    }).toThrow("Invalid temporal search timestamp");
  });
});
