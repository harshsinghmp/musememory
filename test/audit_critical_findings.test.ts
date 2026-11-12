import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, deleteEntry, get, flagConflict, save } from "../src/store.ts";
import { queryContext } from "../src/retrieval.ts";
import { scanSecrets } from "../src/secrets.ts";

// Reproductions for the four critical findings in
// .agents/artifacts/audit-2026-11-11/CODE_REVIEW.md. Each was seen RED before
// the corresponding fix, per the gauntlet TDD gate.

describe("audit F1: idempotency key must not delete a tombstoned row", () => {
  test("an unrelated write with the same key leaves the tombstone intact", () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-f1-"));
    try {
      const store = openStore(dir);
      const a = propose(store, {
        content: "customer alpha record",
        project: "p",
        confirmed: true,
        idempotency_key: "K1",
      } as any);
      deleteEntry(store, a.id, "gdpr erasure");
      // get() correctly hides tombstoned rows, so assert on the row itself:
      // the defect destroyed the row entirely, which is what must not happen.
      const before = store.db!.query("SELECT id, deleted_at FROM memories WHERE id = ?").get([a.id]) as any;
      expect(before).toBeDefined();
      expect(before.deleted_at).toBeTruthy();

      // Unrelated fact, same idempotency key.
      propose(store, {
        content: "unrelated new fact",
        project: "p",
        confirmed: true,
        idempotency_key: "K1",
      } as any);

      const row = store.db!.query("SELECT id, deleted_at FROM memories WHERE id = ?").get([a.id]) as any;
      expect(row).toBeDefined();
      expect(row.deleted_at).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("audit F2: as_of must not bypass lifecycle gates", () => {
  test("conflicted memories stay withheld when as_of is set", () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-f2-"));
    try {
      const store = openStore(dir);
      const now = new Date().toISOString();
      save(store, { id: "m_ok", title: "safe fact", content: "deploy target is fly", project: "p", status: "confirmed", created_at: now, updated_at: now } as any);
      save(store, { id: "m_c1", title: "TTL is 600", content: "TTL is 600 seconds", project: "p", status: "confirmed", created_at: now, updated_at: now } as any);
      save(store, { id: "m_c2", title: "TTL is 60", content: "TTL is 60 seconds", project: "p", status: "confirmed", created_at: now, updated_at: now } as any);
      flagConflict(store, "m_c1", "m_c2", "contradiction");

      const withAsOf = queryContext(store, "TTL", { limit: 10, as_of: now });
      const ids = withAsOf.results.map((r) => r.entry.id);
      expect(ids).not.toContain("m_c1");
      expect(ids).not.toContain("m_c2");
      expect(withAsOf.results.every((r) => r.entry.status !== "conflicted")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("expired memories stay withheld when as_of is set", () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-f2b-"));
    try {
      const store = openStore(dir);
      const now = new Date().toISOString();
      save(store, {
        id: "m_exp",
        title: "beta flag",
        content: "the beta flag is enabled for all users",
        project: "p",
        status: "confirmed",
        created_at: now,
        updated_at: now,
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      } as any);
      const res = queryContext(store, "beta flag", { limit: 10, as_of: now });
      expect(res.results.map((r) => r.entry.id)).not.toContain("m_exp");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("audit F2b: historical reads must still see what was valid then", () => {
  test("a memory that has since expired is retrievable at a time it was valid", () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-f2-hist-"));
    try {
      const store = openStore(dir);
      const old = new Date(Date.now() - 90 * 86400000).toISOString();
      const mid = new Date(Date.now() - 30 * 86400000).toISOString();
      save(store, {
        id: "m_hist",
        title: "deploy target",
        content: "deploy target is heroku",
        project: "p",
        status: "confirmed",
        created_at: old,
        updated_at: old,
        valid_from: old,
        valid_to: mid,
        // Exact boundary so evaluateAsOf returns "valid" rather than
        // "undetermined" for the snapshot.
        valid_to_exact: true,
      } as any);

      // 60 days ago it was valid.
      const past = queryContext(store, "deploy target", {
        limit: 10,
        as_of: new Date(Date.now() - 60 * 86400000).toISOString(),
      });
      expect(past.results.map((r) => r.entry.id)).toContain("m_hist");

      // Today it is expired and must be withheld.
      const today = queryContext(store, "deploy target", {
        limit: 10,
        as_of: new Date().toISOString(),
      });
      expect(today.results.map((r) => r.entry.id)).not.toContain("m_hist");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("audit F8: secret scanner covers common password shapes", () => {
  test("detects passwords containing punctuation", () => {
    for (const text of [
      'password: "hunter2!extra"',
      "password=hunter2!",
      "secret_key: abc123$def",
      "auth_token: tok+en/with=special",
    ]) {
      expect(scanSecrets(text).length).toBeGreaterThan(0);
    }
  });

  test("still ignores prose that merely says the word password", () => {
    // No assignment, so this must not fire — over-matching would block
    // legitimate memories about credentials.
    expect(scanSecrets("never store the password in the repo")).toHaveLength(0);
  });
});

describe("audit F3: a stale YAML mirror must not revert newer SQLite state", () => {
  test("read returns the newer row and leaves the DB untouched", () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-f3-"));
    try {
      const store = openStore(dir);
      const t0 = new Date().toISOString();
      save(store, { id: "m_v", title: "deploy", content: "v1: fly.io", project: "p", status: "confirmed", created_at: t0, updated_at: t0 } as any);

      // Newer authoritative write in SQLite only (mirror write skipped/failed).
      const t1 = new Date(Date.now() + 5000).toISOString();
      save(store, { id: "m_v", title: "deploy", content: "v2: AWS", project: "p", status: "confirmed", created_at: t0, updated_at: t1 } as any, { skipSecretCheck: true });

      // Force the mirror back to the older copy, simulating a crash between the
      // DB commit and the mirror rename.
      const yamlPath = require("node:child_process")
        .execSync(`find ${JSON.stringify(dir)} -name "*.yaml" | head -1`)
        .toString()
        .trim();
      require("node:fs").writeFileSync(
        yamlPath,
        `id: m_v\ntitle: deploy\ncontent: "v1: fly.io"\nproject: p\nstatus: confirmed\ncreated_at: "${t0}"\nupdated_at: "${t0}"\n`,
      );

      const got = get(store, "m_v");
      expect(got?.content).toBe("v2: AWS");

      const row = store.db!.query("SELECT data FROM memories WHERE id = 'm_v'").get() as any;
      expect(JSON.parse(row.data).content).toBe("v2: AWS");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The first version of this fix compared file mtime only, which silently
  // discarded a genuine external edit whose mtime was older (clock skew,
  // rsync, restore from backup). Both directions must hold.
  test("a genuine external edit is honoured even with a backdated mtime", () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-f3-skew-"));
    try {
      const store = openStore(dir);
      const t0 = new Date().toISOString();
      save(store, { id: "m_s", title: "t", content: "v1", project: "p", status: "confirmed", created_at: t0, updated_at: t0 } as any);

      const yamlPath = require("node:child_process")
        .execSync(`find ${JSON.stringify(dir)} -name "*.yaml" | head -1`)
        .toString()
        .trim();
      const newer = new Date(Date.now() + 9000).toISOString();
      require("node:fs").writeFileSync(
        yamlPath,
        `id: m_s\ntitle: t\ncontent: "v3 EXTERNAL"\nproject: p\nstatus: confirmed\ncreated_at: "${t0}"\nupdated_at: "${newer}"\n`,
      );
      // Backdate the file: a real edit can still carry an old mtime.
      const past = (Date.now() - 3_600_000) / 1000;
      require("node:fs").utimesSync(yamlPath, past, past);

      expect(get(store, "m_s")?.content).toBe("v3 EXTERNAL");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
