import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { makeTempRoot, cleanup } from "./helpers.ts";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { openStore, propose, confirm, save } from "../src/store.ts";
import { addSource } from "../src/provenance.ts";
import { recordClaim } from "../src/claims.ts";
import { verifyStrictIntegrity } from "../src/verify.ts";
import type { Store } from "../src/store.ts";

describe("Deliverable 7: Strict Integrity & Health Gate", () => {
  let root: string;
  let memoryDir: string;
  let store: Store;

  beforeEach(() => {
    root = makeTempRoot();
    memoryDir = join(root, ".memory");
    mkdirSync(memoryDir, { recursive: true });
    store = openStore(memoryDir);

    writeFileSync(join(memoryDir, "CURRENT.md"), "# Constraints\n- Invariant 1", "utf-8");
    writeFileSync(join(memoryDir, "USER.md"), "# User\n- Dev", "utf-8");
  });

  afterEach(() => {
    cleanup(root);
  });

  test("verifyStrictIntegrity passes on clean repository and memory store", () => {
    const s1 = addSource(memoryDir, {
      url: "https://example.com",
      title: "Clean Source",
    });

    const m1 = propose(store, {
      title: "Clean Memory",
      content: "No secrets, clean references",
      project: "core",
      type: "architecture",
    });
    confirm(store, m1.id);

    recordClaim(memoryDir, {
      claim: "Clean Claim",
      confidence_tag: "RAW",
      source_ids: [s1.id],
      memory_ids: [m1.id],
    });

    const report = verifyStrictIntegrity(store, memoryDir, root);
    expect(report.ok).toBe(true);
    expect(report.failedChecks).toBe(0);
    expect(report.checks.length).toBeGreaterThanOrEqual(5);
  });

  test("verifyStrictIntegrity catches broken supersedes referential links", () => {
    const m1 = propose(store, {
      title: "Broken Link Memory",
      content: "Points to non-existent superseded_by",
      project: "core",
      type: "architecture",
    });
    confirm(store, m1.id);

    // Inject non-existent superseded_by manually
    m1.superseded_by = "non_existent_memory_id";
    save(store, m1);

    const report = verifyStrictIntegrity(store, memoryDir, root);
    expect(report.ok).toBe(false);
    const linkCheck = report.checks.find((c) => c.name === "referential_integrity");
    expect(linkCheck?.passed).toBe(false);
    expect(linkCheck?.errors?.[0]).toContain("non_existent_memory_id");
  });

  test("verifyStrictIntegrity catches claims referencing missing source IDs", () => {
    recordClaim(memoryDir, {
      claim: "Dangling claim",
      confidence_tag: "RAW",
      source_ids: ["src_missing_999"],
    });

    const report = verifyStrictIntegrity(store, memoryDir, root);
    expect(report.ok).toBe(false);
    const claimCheck = report.checks.find((c) => c.name === "claim_sources");
    expect(claimCheck?.passed).toBe(false);
  });

  test("verifyStrictIntegrity catches broken wikilinks in .memory/wiki/", () => {
    const wikiDir = join(memoryDir, "wiki");
    mkdirSync(wikiDir, { recursive: true });
    writeFileSync(
      join(wikiDir, "concept-a.md"),
      "# Concept A\nReferences [[non-existent-concept-slug]] in text.",
      "utf-8",
    );

    const report = verifyStrictIntegrity(store, memoryDir, root);
    expect(report.ok).toBe(false);
    const wikiCheck = report.checks.find((c) => c.name === "wikilink_resolution");
    expect(wikiCheck?.passed).toBe(false);
  });
});
