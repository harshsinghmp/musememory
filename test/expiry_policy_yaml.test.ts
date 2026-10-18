import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempRoot, cleanup } from "./helpers.ts";
import {
  parseExpiryPolicyYaml,
  loadExpiryPolicyYaml,
  matchExpiryRule,
  evaluateExpiryPolicy,
  applyExpiryPolicy,
  DEFAULT_BUILTIN_EXPIRY_POLICY,
  type ExpiryPolicyConfig,
} from "../src/retention/expiry_policy.ts";
import { openStore, propose, get } from "../src/store.ts";
import { isExpired } from "../src/retrieval.ts";

describe("T-080: Pin-Capable First-Match-Wins Expiry Policy YAML", () => {
  let root: string;
  let memoryDir: string;

  beforeEach(() => {
    root = makeTempRoot();
    memoryDir = `${root}/.memory`;
  });

  afterEach(() => {
    cleanup(root);
  });

  test("parseExpiryPolicyYaml parses valid YAML and handles malformed gracefully", () => {
    const yamlContent = `
version: 1
rules:
  - name: pin_critical_security
    type: architecture
    tags: [security, compliance]
    pinned: true
  - name: expire_web_scrapes_fast
    trust: untrusted
    ttl_days: 7
    reason: "Untrusted web content short retention"
  - name: test_pattern_rule
    pattern: "temporary.*workaround"
    ttl_days: 3
`;
    const parsed = parseExpiryPolicyYaml(yamlContent);
    expect(parsed.rules.length).toBe(3);

    expect(parsed.rules[0].name).toBe("pin_critical_security");
    expect(parsed.rules[0].type).toBe("architecture");
    expect(parsed.rules[0].tags).toEqual(["security", "compliance"]);
    expect(parsed.rules[0].pinned).toBe(true);

    expect(parsed.rules[1].name).toBe("expire_web_scrapes_fast");
    expect(parsed.rules[1].trust).toBe("untrusted");
    expect(parsed.rules[1].ttl_days).toBe(7);
    expect(parsed.rules[1].reason).toBe("Untrusted web content short retention");

    expect(parsed.rules[2].name).toBe("test_pattern_rule");
    expect(parsed.rules[2].pattern).toBe("temporary.*workaround");
    expect(parsed.rules[2].ttl_days).toBe(3);

    // Empty or invalid input
    expect(parseExpiryPolicyYaml("").rules).toEqual([]);
    expect(parseExpiryPolicyYaml("   ").rules).toEqual([]);
  });

  test("matchExpiryRule tests all predicate dimensions", () => {
    const entry: any = {
      id: "m_1",
      title: "Auth Gateway TLS Invariant",
      content: "Ensure strict mutual TLS verification across backend services.",
      project: "auth",
      type: "architecture",
      tags: ["security", "networking"],
      trust: "trusted",
      temporal_mode: "timeless",
    };

    // Matching rule
    expect(
      matchExpiryRule(entry, {
        name: "test_match",
        type: "architecture",
        project: "auth",
        tags: ["security"],
        trust: "trusted",
      }),
    ).toBe(true);

    // Type mismatch
    expect(matchExpiryRule(entry, { name: "r", type: "fix" })).toBe(false);

    // Project mismatch
    expect(matchExpiryRule(entry, { name: "r", project: "frontend" })).toBe(false);

    // Tag mismatch
    expect(matchExpiryRule(entry, { name: "r", tags: ["database"] })).toBe(false);

    // Trust mismatch
    expect(matchExpiryRule(entry, { name: "r", trust: "untrusted" })).toBe(false);

    // Pattern regex match
    expect(matchExpiryRule(entry, { name: "r", pattern: "mutual.*TLS" })).toBe(true);
    expect(matchExpiryRule(entry, { name: "r", pattern: "database.*pool" })).toBe(false);
  });

  test("evaluateExpiryPolicy enforces first-match-wins order", () => {
    const entry: any = {
      id: "m_2",
      title: "Security Bugfix",
      content: "Prevent memory leak in token validator.",
      project: "core",
      type: "fix",
      tags: ["security", "urgent"],
      created_at: "2026-01-01T00:00:00.000Z",
    };

    const policy: ExpiryPolicyConfig = {
      version: 1,
      rules: [
        {
          name: "rule_1_pin_security",
          tags: ["security"],
          pinned: true,
        },
        {
          name: "rule_2_expire_fixes_fast",
          type: "fix",
          ttl_days: 10,
        },
      ],
    };

    // Rule 1 matches first -> entry is pinned, ttl_days is null
    const result = evaluateExpiryPolicy(entry, policy);
    expect(result).not.toBeNull();
    expect(result!.rule.name).toBe("rule_1_pin_security");
    expect(result!.pinned).toBe(true);
    expect(result!.ttl_days).toBeNull();
    expect(result!.is_expired).toBe(false);

    // Reverse policy order: Rule 2 matches first -> entry is not pinned, ttl is 10 days
    const reversedPolicy: ExpiryPolicyConfig = {
      version: 1,
      rules: [policy.rules[1], policy.rules[0]],
    };
    const reversedResult = evaluateExpiryPolicy(entry, reversedPolicy, Date.parse("2026-02-01T00:00:00.000Z"));
    expect(reversedResult).not.toBeNull();
    expect(reversedResult!.rule.name).toBe("rule_2_expire_fixes_fast");
    expect(reversedResult!.pinned).toBe(false);
    expect(reversedResult!.ttl_days).toBe(10);
    expect(reversedResult!.is_expired).toBe(true);
  });

  test("propose loads local expiry.yaml policy and applies pin and custom TTL", () => {
    const store = openStore(memoryDir);

    // Create declarative expiry.yaml in memoryDir
    const yamlConfig = `
version: 1
rules:
  - name: pin_critical_invariants
    tags: [critical]
    pinned: true
  - name: fast_qa_fix_ttl
    tags: [qa]
    ttl_days: 15
`;
    writeFileSync(join(memoryDir, "expiry.yaml"), yamlConfig, "utf8");

    // 1. Propose memory with 'critical' tag -> should be automatically pinned by policy!
    const criticalEntry = propose(store, {
      title: "Critical Invariant Memory",
      content: "Database transactions must never deadlock.",
      project: "core",
      type: "fix",
      tags: ["critical"],
    });
    expect(criticalEntry.pinned).toBe(true);
    expect(criticalEntry.expires_at).toBeUndefined();

    // 2. Propose memory with 'qa' tag -> should receive 15-day TTL instead of 90-day fix default!
    const qaEntry = propose(store, {
      title: "QA Test Note",
      content: "Temporary test stub for mock runner.",
      project: "core",
      type: "fix",
      tags: ["qa"],
    });
    expect(qaEntry.pinned).toBeFalsy();
    expect(qaEntry.expires_at).toBeDefined();
    const days = (Date.parse(qaEntry.expires_at!) - Date.parse(qaEntry.created_at)) / 86_400_000;
    expect(Math.round(days)).toBe(15);
  });

  test("applyExpiryPolicy sweeps store, pins entries, and expires past-due items", () => {
    const store = openStore(memoryDir);
    const now = Date.now();

    // Past due entry with test tag
    const oldTestEntry = propose(store, {
      id: "m_old_test",
      title: "Old Test Hack",
      content: "Mock server port override.",
      project: "core",
      type: "discovery",
      tags: ["test"],
      created_at: new Date(now - 20 * 86_400_000).toISOString(),
    });

    // Architecture entry with core tag to pin
    const coreArchEntry = propose(store, {
      id: "m_core_arch",
      title: "Core Architecture Invariant",
      content: "Deterministic ID hashing algorithm.",
      project: "core",
      type: "architecture",
      tags: ["core"],
    });

    const policy: ExpiryPolicyConfig = {
      version: 1,
      rules: [
        {
          name: "pin_core_architecture",
          type: "architecture",
          tags: ["core"],
          pinned: true,
        },
        {
          name: "expire_test_discoveries_10d",
          type: "discovery",
          tags: ["test"],
          ttl_days: 10,
          reason: "Test discoveries expire in 10 days",
        },
      ],
    };

    const res = applyExpiryPolicy(store, policy, { now });
    expect(res.matched).toBe(2);
    expect(res.pinned.some((p) => p.id === coreArchEntry.id)).toBe(true);
    expect(res.expired.some((e) => e.id === oldTestEntry.id)).toBe(true);

    // Verify persisted state
    const reloadedArch = get(store, coreArchEntry.id)!;
    expect(reloadedArch.pinned).toBe(true);

    const reloadedOld = get(store, oldTestEntry.id)!;
    expect(reloadedOld.status).toBe("expired");
    expect(reloadedOld.expired_by).toBe("expire_test_discoveries_10d");
    expect(isExpired(reloadedOld, now)).toBe(true);
  });
});
