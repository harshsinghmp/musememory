import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { openStore, propose, save, get } from "../src/store.ts";
import { validateStore } from "../src/schema.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";

describe("validateStore deep validation", () => {
  test("fixture root passes validation", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const report = validateStore(store);
    expect(report.isValid).toBe(true);
    expect(report.schemaErrors).toHaveLength(0);
    expect(report.secretErrors).toHaveLength(0);
    expect(report.brokenLinks).toHaveLength(0);
    cleanup(root);
  });

  test("detects broken links in supersedes and related_memory_ids", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const a = propose(store, { content: "valid entry", project: "aria", confirmed: true });
    a.supersedes = ["m_nonexistent_123"];
    a.related_memory_ids = ["m_nonexistent_456"];
    save(store, a, { skipSecretCheck: true });

    const report = validateStore(store);
    expect(report.isValid).toBe(false);
    expect(report.brokenLinks).toHaveLength(2);
    expect(report.brokenLinks.map((b) => b.targetId)).toContain("m_nonexistent_123");
    expect(report.brokenLinks.map((b) => b.targetId)).toContain("m_nonexistent_456");
    cleanup(root);
  });

  test("detects probable secrets stored in memory files", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const leakedId = "m_999_leaked";
    writeFileSync(
      join(memoryDir, "memories", `${leakedId}.yaml`),
      `id: ${leakedId}\ntitle: Leaked key\ncontent: key is ghp_123456789012345678901234567890123456\nproject: aria\nstatus: active\ncreated_at: 2026-01-01T00:00:00Z\nupdated_at: 2026-01-01T00:00:00Z\nsource: test\ntags: [test]\n`,
    );

    const report = validateStore(store);
    expect(report.isValid).toBe(false);
    expect(report.secretErrors.length).toBeGreaterThan(0);
    expect(report.secretErrors[0].id).toBe(leakedId);
    cleanup(root);
  });

  test("deduplicates multiple errors on single entry for validCount calculation", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const initialTotal = validateStore(store).total;

    const brokenMultiId = "m_999_multi_error";
    // Entry has both secret error and broken link
    writeFileSync(
      join(memoryDir, "memories", `${brokenMultiId}.yaml`),
      `id: ${brokenMultiId}\ntitle: Multi error\ncontent: key is ghp_123456789012345678901234567890123456\nproject: aria\nstatus: active\ncreated_at: 2026-01-01T00:00:00Z\nupdated_at: 2026-01-01T00:00:00Z\nsource: test\ntags: [test]\nrelated_memory_ids: [m_missing_link_target]\n`,
    );

    const report = validateStore(store);
    expect(report.isValid).toBe(false);
    expect(report.total).toBe(initialTotal + 1);
    // 1 invalid entry added, so validCount should be exactly initialTotal
    expect(report.validCount).toBe(initialTotal);
    cleanup(root);
  });

  test("detects referential integrity inconsistency", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const a = propose(store, { content: "original", project: "aria", confirmed: true });
    const b = propose(store, { content: "replacement", project: "aria", confirmed: true });

    // b supersedes a, but a is left with status active (not superseded)
    b.supersedes = [a.id];
    save(store, b);

    const report = validateStore(store);
    expect(report.isValid).toBe(false);
    expect(report.integrityErrors.some((e) => e.message.includes("expected superseded"))).toBe(true);
    cleanup(root);
  });
});
