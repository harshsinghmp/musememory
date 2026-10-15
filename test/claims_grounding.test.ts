import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { makeTempRoot, cleanup } from "./helpers.ts";
import { addSource } from "../src/provenance.ts";
import { recordClaim, getClaim } from "../src/claims.ts";
import { openStore, propose } from "../src/store.ts";

describe("T-391: Citation Validation Against Live Source Registry", () => {
  let root: string;
  let memoryDir: string;

  beforeEach(() => {
    root = makeTempRoot();
    memoryDir = `${root}/.memory`;
  });

  afterEach(() => {
    cleanup(root);
  });

  test("recordClaim accepts valid registered source_ids and derives verified: true", () => {
    const src = addSource(memoryDir, {
      url: "https://sqlite.org/wal.html",
      title: "SQLite Write-Ahead Logging",
      source_type: "documentation",
      excerpt: "WAL mode significantly improves concurrency.",
    });

    const claim = recordClaim(memoryDir, {
      claim: "SQLite WAL mode improves concurrency for multi-process environments.",
      confidence_tag: "RAW",
      source_ids: [src.id],
      verified: true,
    });

    expect(claim.id).toBeDefined();
    expect(claim.source_ids).toEqual([src.id]);
    expect(claim.verified).toBe(true);
  });

  test("recordClaim rejects unknown source_ids with Grounding failure", () => {
    // Add one valid source to activate the live registry
    addSource(memoryDir, {
      url: "https://sqlite.org/wal.html",
      title: "SQLite Write-Ahead Logging",
    });

    expect(() => {
      recordClaim(memoryDir, {
        claim: "Unverified assertion with forged source reference.",
        source_ids: ["src_nonexistent_999"],
        verified: true,
      });
    }).toThrow(/Grounding failure: unknown source_id/i);
  });

  test("recordClaim derives verified: false when caller asserts true without citations", () => {
    const claim = recordClaim(memoryDir, {
      claim: "Blind assertion without any supporting citations.",
      confidence_tag: "INFER",
      verified: true, // Caller asserts true, but without citations it cannot be verified
    });

    expect(claim.verified).toBe(false);
  });

  test("propose validates source_ids against live registry in store", () => {
    const store = openStore(memoryDir);

    const src = addSource(store.memoryDir!, {
      url: "https://bun.sh/docs/test",
      title: "Bun Test Documentation",
      excerpt: "bun test runs fast unit tests in-process.",
    });

    // Valid citation passes propose
    const entry = propose(store, {
      title: "Bun test runner invariant",
      content: "Always use bun test for running repository test suites.",
      project: "core",
      source_ids: [src.id],
      source: "manual",
    });
    expect(entry.source_ids).toEqual([src.id]);

    // Unknown citation fails propose
    expect(() => {
      propose(store, {
        title: "Forged citation entry",
        content: "Some claim citing a nonexistent document.",
        project: "core",
        source_ids: ["src_fake_citation"],
        source: "manual",
      });
    }).toThrow(/Grounding failure: unknown source_id/i);
  });
});
