import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { makeTempRoot, cleanup } from "./helpers.ts";
import { openStore, propose, expireEntry, markExpired, sweepExpiredEntries, get } from "../src/store.ts";
import { queryContext, isExpired } from "../src/retrieval.ts";
import { getAuditTrail } from "../src/audit.ts";

describe("T-079: Stamped Expiry Status, expired_at, and expired_by Rule Name", () => {
  let root: string;
  let memoryDir: string;

  beforeEach(() => {
    root = makeTempRoot();
    memoryDir = `${root}/.memory`;
  });

  afterEach(() => {
    cleanup(root);
  });

  test("expireEntry stamps status: 'expired', expired_at, and expired_by rule name", () => {
    const store = openStore(memoryDir);

    const entry = propose(store, {
      title: "Temporary Network Hack",
      content: "MTU workaround for legacy gateway interface.",
      project: "infra",
      type: "fix",
    });

    const expiredTimestamp = "2026-10-18T20:00:00.000Z";
    const ruleName = "policy:ttl_fix_90d";

    const result = expireEntry(store, entry.id, {
      rule: ruleName,
      expired_at: expiredTimestamp,
      reason: "Horizon exceeded standard SLA",
    });

    expect(result).not.toBeNull();
    expect(result!.status).toBe("expired");
    expect(result!.expired_at).toBe(expiredTimestamp);
    expect(result!.expired_by).toBe(ruleName);
    expect(result!.valid_to).toBeDefined();

    // Verify persisted across reload
    const reloaded = get(store, entry.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.status).toBe("expired");
    expect(reloaded!.expired_at).toBe(expiredTimestamp);
    expect(reloaded!.expired_by).toBe(ruleName);

    // Audit event recorded
    const audit = getAuditTrail(memoryDir, { entryId: entry.id });
    expect(audit.some((e) => e.operation === "expire" && e.details?.expired_by === ruleName)).toBe(true);
  });

  test("markExpired is an alias for expireEntry with default rule name", () => {
    const store = openStore(memoryDir);

    const entry = propose(store, {
      title: "Expiring Note",
      content: "One-off deployment flag to remove after verify.",
      project: "infra",
      type: "operation",
    });

    const result = markExpired(store, entry.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("expired");
    expect(result!.expired_by).toBe("rule:default_expiry");
    expect(result!.expired_at).toBeDefined();
  });

  test("expireEntry respects pinned exemption unless forced", () => {
    const store = openStore(memoryDir);

    const pinnedEntry = propose(store, {
      title: "Core Invariant",
      content: "Never disable TLS verification in production client.",
      project: "infra",
      type: "architecture",
      pinned: true,
    });

    // Attempting normal expireEntry does nothing on pinned entry
    const attempt = expireEntry(store, pinnedEntry.id, { rule: "sweep" });
    expect(attempt!.status).toBe("candidate");
    expect(attempt!.expired_at).toBeUndefined();

    // Forced expire overrides pin
    const forced = expireEntry(store, pinnedEntry.id, { rule: "emergency_purge", force: true });
    expect(forced!.status).toBe("expired");
    expect(forced!.expired_by).toBe("emergency_purge");
  });

  test("sweepExpiredEntries expires past-due items and skips pinned/unexpired", () => {
    const store = openStore(memoryDir);
    const now = Date.now();

    // 1. Past due -> should expire
    const pastDue = propose(store, {
      id: "m_past_due",
      title: "Old Fix",
      content: "Ancient patch that should be swept away.",
      project: "infra",
      type: "fix",
      expires_at: new Date(now - 10 * 86_400_000).toISOString(),
    });

    // 2. Future due -> should stay active
    const futureDue = propose(store, {
      id: "m_future_due",
      title: "Current Fix",
      content: "Recent patch still valid for 60 days.",
      project: "infra",
      type: "fix",
      expires_at: new Date(now + 60 * 86_400_000).toISOString(),
    });

    // 3. Past due but pinned -> should skip
    const pinnedPastDue = propose(store, {
      id: "m_pinned_past_due",
      title: "Pinned Old Fix",
      content: "Ancient patch pinned permanently against sweeps.",
      project: "infra",
      type: "fix",
      expires_at: new Date(now - 10 * 86_400_000).toISOString(),
      pinned: true,
    });

    const sweepResult = sweepExpiredEntries(store, { now, rule: "cron_daily_sweep" });
    expect(sweepResult.expired.length).toBe(1);
    expect(sweepResult.expired[0].id).toBe(pastDue.id);
    expect(sweepResult.expired[0].status).toBe("expired");
    expect(sweepResult.expired[0].expired_by).toBe("cron_daily_sweep");
    expect(sweepResult.skippedPinned).toBe(1);

    // Verify individual statuses
    expect(get(store, pastDue.id)!.status).toBe("expired");
    expect(get(store, futureDue.id)!.status).toBe("candidate");
    expect(get(store, pinnedPastDue.id)!.status).toBe("candidate");
  });

  test("isExpired and queryContext filter out entries with status: 'expired'", () => {
    const store = openStore(memoryDir);

    const entry = propose(store, {
      id: "m_expired_status",
      title: "Expired Filter Test",
      content: "Searchable keyword testing filter behavior.",
      project: "infra",
      type: "fix",
    });

    expireEntry(store, entry.id, { rule: "manual_retirement" });

    const reloaded = get(store, entry.id)!;
    expect(isExpired(reloaded, Date.now())).toBe(true);

    const defaultRes = queryContext(store, "testing filter behavior", { project: "infra" });
    expect(defaultRes.results.map((r) => r.entry.id)).not.toContain("m_expired_status");

    const optInRes = queryContext(store, "testing filter behavior", { project: "infra", includeExpired: true });
    expect(optInRes.results.map((r) => r.entry.id)).toContain("m_expired_status");
  });
});
