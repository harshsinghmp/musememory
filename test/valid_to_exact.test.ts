import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  openStore,
  propose,
  confirm,
  supersede,
  markStale,
  markSuperseded,
  expireEntry,
  reject,
  get,
  closeOutValidity,
  type Store,
} from "../src/store.ts";

describe("T-082: valid_to_exact flag on transitions", () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-valid-exact-"));
    store = openStore(tmpDir);
  });

  afterEach(() => {
    store.db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("propose without valid_to leaves valid_to_exact undefined", () => {
    const entry = propose(store, {
      content: "Default active fact",
      project: "test",
    });
    expect(entry.valid_to).toBeUndefined();
    expect(entry.valid_to_exact).toBeUndefined();

    const loaded = get(store, entry.id);
    expect(loaded?.valid_to).toBeUndefined();
    expect(loaded?.valid_to_exact).toBeUndefined();
  });

  test("propose with explicit valid_to defaults valid_to_exact to true", () => {
    const entry = propose(store, {
      content: "Temporary contract valid through Q1",
      project: "test",
      valid_to: "2026-03-31T23:59:59.000Z",
    });
    expect(entry.valid_to).toBe("2026-03-31T23:59:59.000Z");
    expect(entry.valid_to_exact).toBe(true);

    const loaded = get(store, entry.id);
    expect(loaded?.valid_to).toBe("2026-03-31T23:59:59.000Z");
    expect(loaded?.valid_to_exact).toBe(true);
  });

  test("propose allows explicit valid_to_exact: false even with valid_to", () => {
    const entry = propose(store, {
      content: "Estimated deprecation around Q2",
      project: "test",
      valid_to: "2026-06-30T00:00:00.000Z",
      valid_to_exact: false,
    });
    expect(entry.valid_to).toBe("2026-06-30T00:00:00.000Z");
    expect(entry.valid_to_exact).toBe(false);

    const loaded = get(store, entry.id);
    expect(loaded?.valid_to_exact).toBe(false);
  });

  test("closeOutValidity stamps valid_to and defaults valid_to_exact to false", () => {
    const entry = propose(store, {
      content: "Active policy",
      project: "test",
    });
    closeOutValidity(entry);
    expect(entry.valid_to).toBeDefined();
    expect(entry.valid_to_exact).toBe(false);
  });

  test("closeOutValidity respects explicit options for valid_to and valid_to_exact", () => {
    const entry = propose(store, {
      content: "Active policy with exact cessation",
      project: "test",
    });
    const exactEnd = "2026-05-01T12:00:00.000Z";
    closeOutValidity(entry, { valid_to: exactEnd, valid_to_exact: true });
    expect(entry.valid_to).toBe(exactEnd);
    expect(entry.valid_to_exact).toBe(true);
  });

  test("supersede defaults old entry to valid_to_exact: false", () => {
    const oldEntry = propose(store, {
      content: "Legacy encryption scheme: AES-128",
      project: "sec",
      confirmed: true,
    });
    const newEntry = propose(store, {
      content: "Modern encryption scheme: AES-256-GCM",
      project: "sec",
      confirmed: true,
    });

    const superseded = supersede(store, oldEntry.id, newEntry.id);
    expect(superseded).not.toBeNull();
    expect(superseded?.status).toBe("superseded");
    expect(superseded?.valid_to).toBeDefined();
    expect(superseded?.valid_to_exact).toBe(false);

    const reloaded = get(store, oldEntry.id);
    expect(reloaded?.valid_to_exact).toBe(false);
  });

  test("supersede accepts exact valid_to_exact override", () => {
    const oldEntry = propose(store, {
      content: "OAuth 1.0 endpoint",
      project: "auth",
      confirmed: true,
    });
    const newEntry = propose(store, {
      content: "OAuth 2.1 endpoint",
      project: "auth",
      confirmed: true,
    });

    const sunsetTime = "2026-01-01T00:00:00.000Z";
    const superseded = supersede(store, oldEntry.id, newEntry.id, {
      valid_to: sunsetTime,
      valid_to_exact: true,
    });
    expect(superseded?.valid_to).toBe(sunsetTime);
    expect(superseded?.valid_to_exact).toBe(true);

    const reloaded = get(store, oldEntry.id);
    expect(reloaded?.valid_to).toBe(sunsetTime);
    expect(reloaded?.valid_to_exact).toBe(true);
  });

  test("markStale defaults valid_to_exact: false and accepts override", () => {
    const entry = propose(store, { content: "Node 18 supported", project: "infra" });
    markStale(store, entry.id, "Node 18 EOL reached");
    const staleEntry = get(store, entry.id);
    expect(staleEntry?.status).toBe("stale");
    expect(staleEntry?.valid_to_exact).toBe(false);

    const exactEntry = propose(store, { content: "Python 3.8 supported", project: "infra" });
    markStale(store, exactEntry.id, "Python 3.8 official EOL", {
      valid_to: "2024-10-01T00:00:00.000Z",
      valid_to_exact: true,
    });
    const reloadedExact = get(store, exactEntry.id);
    expect(reloadedExact?.valid_to).toBe("2024-10-01T00:00:00.000Z");
    expect(reloadedExact?.valid_to_exact).toBe(true);
  });

  test("expireEntry stamps valid_to_exact: false or respects exact flag", () => {
    const entry1 = propose(store, { content: "Cert expiring", project: "p" });
    expireEntry(store, entry1.id);
    expect(get(store, entry1.id)?.valid_to_exact).toBe(false);

    const entry2 = propose(store, { content: "Fixed deadline promo", project: "p" });
    expireEntry(store, entry2.id, { valid_to_exact: true });
    expect(get(store, entry2.id)?.valid_to_exact).toBe(true);
  });

  test("reject stamps valid_to_exact: false or respects exact flag", () => {
    const entry1 = propose(store, { content: "Bad advice", project: "p" });
    reject(store, entry1.id);
    expect(get(store, entry1.id)?.valid_to_exact).toBe(false);

    const entry2 = propose(store, { content: "Disproven hypothesis", project: "p" });
    reject(store, entry2.id, { valid_to_exact: true });
    expect(get(store, entry2.id)?.valid_to_exact).toBe(true);
  });
});
