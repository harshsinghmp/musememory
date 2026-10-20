import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { makeTempRoot, cleanup } from "./helpers.ts";
import { openStore, propose } from "../src/store.ts";
import { queryContext } from "../src/retrieval.ts";
import {
  DEFAULT_EXPIRY_DAYS_BY_TYPE,
  defaultExpiryDays,
  computeDefaultExpiresAt,
} from "../src/retention.ts";

describe("T-078: Per-Type Default expires_at (fix 90d, operation 180d, architecture 365d, discovery 30d)", () => {
  let root: string;
  let memoryDir: string;

  beforeEach(() => {
    root = makeTempRoot();
    memoryDir = `${root}/.memory`;
  });

  afterEach(() => {
    cleanup(root);
  });

  test("defaultExpiryDays returns expected days for each type", () => {
    expect(defaultExpiryDays("fix")).toBe(90);
    expect(defaultExpiryDays("operation")).toBe(180);
    expect(defaultExpiryDays("architecture")).toBe(365);
    expect(defaultExpiryDays("discovery")).toBe(30);
    expect(defaultExpiryDays("preference")).toBeNull();
    expect(defaultExpiryDays("constraint")).toBeNull();
    expect(defaultExpiryDays("adr")).toBe(365);
    expect(defaultExpiryDays("negative")).toBe(180);
    expect(defaultExpiryDays(undefined)).toBeNull();
  });

  test("computeDefaultExpiresAt calculates accurate ISO timestamps", () => {
    const base = new Date("2026-01-01T00:00:00.000Z");

    const fixExpiry = computeDefaultExpiresAt("fix", base);
    expect(fixExpiry).toBe(new Date("2026-04-01T00:00:00.000Z").toISOString()); // +90 days (Jan: 31, Feb: 28, Mar: 31 = 90d -> Apr 1)

    const discoveryExpiry = computeDefaultExpiresAt("discovery", base);
    expect(discoveryExpiry).toBe(new Date("2026-01-31T00:00:00.000Z").toISOString()); // +30 days

    const preferenceExpiry = computeDefaultExpiresAt("preference", base);
    expect(preferenceExpiry).toBeUndefined();

    const constraintExpiry = computeDefaultExpiresAt("constraint", base);
    expect(constraintExpiry).toBeUndefined();
  });

  test("propose applies per-type default expires_at on admission", () => {
    const store = openStore(memoryDir);

    const fixEntry = propose(store, {
      title: "Bugfix Memory",
      content: "Resolved race condition in event loop handlers.",
      project: "core",
      type: "fix",
    });
    expect(fixEntry.expires_at).toBeDefined();
    const fixDays = (Date.parse(fixEntry.expires_at!) - Date.parse(fixEntry.created_at)) / 86_400_000;
    expect(Math.round(fixDays)).toBe(90);

    const opEntry = propose(store, {
      title: "Operation Protocol",
      content: "Nightly backup maintenance rotation runbook.",
      project: "core",
      type: "operation",
    });
    expect(opEntry.expires_at).toBeDefined();
    const opDays = (Date.parse(opEntry.expires_at!) - Date.parse(opEntry.created_at)) / 86_400_000;
    expect(Math.round(opDays)).toBe(180);

    const archEntry = propose(store, {
      title: "System Architecture Rule",
      content: "All database writes must execute within transactional boundary.",
      project: "core",
      type: "architecture",
    });
    expect(archEntry.expires_at).toBeDefined();
    const archDays = (Date.parse(archEntry.expires_at!) - Date.parse(archEntry.created_at)) / 86_400_000;
    expect(Math.round(archDays)).toBe(365);

    const discEntry = propose(store, {
      title: "Discovery Probe",
      content: "Observed temporary cache miss spike during peak deploy.",
      project: "core",
      type: "discovery",
    });
    expect(discEntry.expires_at).toBeDefined();
    const discDays = (Date.parse(discEntry.expires_at!) - Date.parse(discEntry.created_at)) / 86_400_000;
    expect(Math.round(discDays)).toBe(30);

    const prefEntry = propose(store, {
      title: "User Preference",
      content: "Prefer concise TypeScript without redundant interfaces.",
      project: "core",
      type: "preference",
    });
    expect(prefEntry.expires_at).toBeUndefined();
  });

  test("propose supports explicit overrides, null opt-outs, and pin exemptions", () => {
    const store = openStore(memoryDir);

    // Custom string override
    const customExpiry = "2029-01-01T00:00:00.000Z";
    const customEntry = propose(store, {
      title: "Custom Expiry Fix",
      content: "Special patch valid until 2029 long-term support end.",
      project: "core",
      type: "fix",
      expires_at: customExpiry,
    });
    expect(customEntry.expires_at).toBe(customExpiry);

    // Null opt-out
    const nullEntry = propose(store, {
      title: "Permanent Fix",
      content: "Fundamental mathematical fix that will never expire.",
      project: "core",
      type: "fix",
      expires_at: null,
    });
    expect(nullEntry.expires_at).toBeUndefined();

    // Pinned exemption
    const pinnedEntry = propose(store, {
      title: "Pinned Operational Rule",
      content: "Essential core invariant pinned against all expiry sweeps.",
      project: "core",
      type: "operation",
      pinned: true,
    });
    expect(pinnedEntry.expires_at).toBeUndefined();
    expect(pinnedEntry.pinned).toBe(true);

    // Timeless exemption
    const timelessEntry = propose(store, {
      title: "Timeless Architecture",
      content: "Universal distributed systems CAP theorem invariant.",
      project: "core",
      type: "architecture",
      temporal_mode: "timeless",
    });
    expect(timelessEntry.expires_at).toBeUndefined();
  });

  test("expired per-type entries are filtered out in queryContext", () => {
    const store = openStore(memoryDir);

    // Live entry
    propose(store, {
      id: "m_live_fix",
      title: "Active Fix",
      content: "Live buffer overflow prevention patch.",
      project: "core",
      type: "fix",
    });

    // Manually expired entry
    propose(store, {
      id: "m_expired_fix",
      title: "Expired Fix",
      content: "Outdated workaround for obsolete kernel version.",
      project: "core",
      type: "fix",
      expires_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    });

    const defaultRes = queryContext(store, "fix", { project: "core" });
    const defaultIds = defaultRes.results.map((r) => r.entry.id);
    expect(defaultIds).toContain("m_live_fix");
    expect(defaultIds).not.toContain("m_expired_fix");

    const includeExpiredRes = queryContext(store, "fix", { project: "core", includeExpired: true });
    const allIds = includeExpiredRes.results.map((r) => r.entry.id);
    expect(allIds).toContain("m_live_fix");
    expect(allIds).toContain("m_expired_fix");
  });
});
