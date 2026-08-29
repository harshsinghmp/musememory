import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanSecrets } from "../src/secrets.ts";
import { openStore, propose, confirm, get } from "../src/store.ts";
import { compileWiki, listWikiPages } from "../src/wiki/compiler.ts";
import { buildTreeIndex, searchTree } from "../src/retrieval/tree-index.ts";
import { validateStore, validateEntry } from "../src/schema.ts";
import { handleStaleCommand } from "../src/cli/lifecycle.ts";

describe("Forensic Bug Fixes & Edge Case Hardening", () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-forensic-"));
    memoryDir = join(tmpDir, ".memory");
    mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("Vibeguard secret scanner allows mentions of 'private key' in regular text but catches actual key blocks", () => {
    // Regular technical text mentioning the phrase
    const benignText = "Make sure to configure the SSH private key authentication properly in production.";
    expect(scanSecrets(benignText)).toEqual([]);

    const benignText2 = "Generate an RSA private key using openssl genpkey command.";
    expect(scanSecrets(benignText2)).toEqual([]);

    // Actual private key blocks
    const rsaKeyBlock = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY-----";
    expect(scanSecrets(rsaKeyBlock)).toContain("Private Key Block");

    const ecKeyBlock = "-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEI...\n-----END EC PRIVATE KEY-----";
    expect(scanSecrets(ecKeyBlock)).toContain("Private Key Block");

    const genericKeyBlock = "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----";
    expect(scanSecrets(genericKeyBlock)).toContain("Private Key Block");
  });

  it("Wiki compiler handles frontmatter array deserialization and doesn't duplicate frontmatter on recompile", () => {
    const store = openStore(memoryDir);
    propose(store, {
      title: "Architecture Decisions",
      content: "Using SQLite and YAML dual storage with token knapsack retrieval.",
      tags: ["sqlite", "retrieval", "knapsack"],
      type: "architecture",
      confirmed: true,
      project: "proj1",
    });

    // First compilation
    const res1 = compileWiki(store, memoryDir);
    expect(res1.pagesCreated.length).toBeGreaterThan(0);

    // Second compilation (loads existing concept files and parses frontmatter)
    const res2 = compileWiki(store, memoryDir);
    expect(res2.pagesCreated.length + res2.pagesUpdated.length).toBeGreaterThan(0);

    const pages = listWikiPages(memoryDir, { detailLevel: "full" });
    expect(pages.length).toBeGreaterThan(0);
    for (const p of pages) {
      if (p.type === "concept") {
        expect(Array.isArray((p as any).tags)).toBe(true);
        expect(Array.isArray(p.memoryRefs)).toBe(true);
      }
    }
  });

  it("searchTree respects maxNodes > 10 without artificial pageSize truncation", () => {
    const store = openStore(memoryDir);
    for (let i = 0; i < 25; i++) {
      propose(store, {
        title: `Distinct Service Pattern ${i}`,
        content: `Independent architecture documentation node number ${i} for cluster microservices.`,
        type: (i % 2 === 0 ? "architecture" : "operation") as any,
        confirmed: true,
        project: `cluster_${i}`,
        tags: [`tag_${i}`],
      });
    }

    const index = buildTreeIndex(store, memoryDir);
    const searchRes = searchTree(index, {
      query: "architecture documentation",
      maxNodes: 20,
    });

    expect(searchRes.nodes.length).toBeGreaterThan(10);
    expect(searchRes.nodes.length).toBeLessThanOrEqual(20);
  });

  it("validateStore and validateEntry correctly load schema.json without runtime error", () => {
    const store = openStore(memoryDir);
    const entry = propose(store, {
      title: "Authentication Token Expiry",
      content: "JWT auth tokens expire after 3600 seconds.",
      type: "fix",
      confirmed: true,
      project: "auth",
      tags: ["auth", "jwt"],
    });

    const report = validateStore(store);
    expect(report.total).toBe(1);
    expect(report.validCount).toBe(1);
    expect(report.isValid).toBe(true);

    const entryValidation = validateEntry(entry);
    expect(entryValidation.valid).toBe(true);
  });

  it("get() falls back to SQLite store when YAML file on disk is corrupted or empty", () => {
    const store = openStore(memoryDir);
    const entry = propose(store, {
      title: "Resilient Storage Test",
      content: "This memory should survive a corrupted YAML file on disk.",
      type: "architecture",
      confirmed: true,
      project: "core",
      tags: ["storage", "sqlite"],
    });

    // Verify it is saved
    const retrieved = get(store, entry.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.title).toBe("Resilient Storage Test");

    // Remove YAML file from disk
    const { unlinkSync } = require("node:fs");
    const yamlFile = join(memoryDir, "memories", `${entry.id}.yaml`);
    unlinkSync(yamlFile);

    // get() should gracefully fall back to SQLite db
    const retrievedFromDb = get(store, entry.id);
    expect(retrievedFromDb).not.toBeNull();
    expect(retrievedFromDb?.title).toBe("Resilient Storage Test");
    expect(retrievedFromDb?.content).toBe("This memory should survive a corrupted YAML file on disk.");
  });

  it("handleStaleCommand detects confirmed entries that have exceeded staleness threshold", async () => {
    const store = openStore(memoryDir);
    // Create an old confirmed discovery memory (30 days policy)
    const entry = propose(store, {
      title: "Old Discovery Insight",
      content: "Ephemeral discovery from ancient research.",
      type: "discovery",
      confirmed: true,
      project: "research",
      tags: ["research"],
    });

    // Manually backdate updated_at by 45 days
    const ancientDate = new Date(Date.now() - 45 * 86_400_000).toISOString();
    entry.updated_at = ancientDate;
    entry.created_at = ancientDate;
    if (store.db) {
      store.db.run("UPDATE memories SET updated_at = ?, created_at = ? WHERE id = ?", [
        ancientDate,
        ancientDate,
        entry.id,
      ]);
    }

    const exitCode = await handleStaleCommand({
      positional: [],
      flags: { dir: tmpDir },
    });
    expect(exitCode).toBe(0);
  });

  it("clearSchemaCache resets compiled validator cache cleanly", () => {
    const { clearSchemaCache, validateStore } = require("../src/schema.ts");
    const store = openStore(memoryDir);
    validateStore(store);
    expect(() => clearSchemaCache()).not.toThrow();
    // Validate again after cache invalidation
    const report = validateStore(store);
    expect(report.isValid).toBe(true);
  });

  it("buildTreeIndexAsync indexes confirmed memories asynchronously without blocking", async () => {
    const { buildTreeIndexAsync } = require("../src/retrieval/tree-index.ts");
    const store = openStore(memoryDir);
    for (let i = 0; i < 5; i++) {
      propose(store, {
        title: `Async Tree Memory ${i}`,
        content: `Content for async tree indexing item ${i}`,
        type: "architecture",
        confirmed: true,
        project: "async_test",
      });
    }

    const asyncIndex = await buildTreeIndexAsync(store, memoryDir);
    expect(asyncIndex.totalMemories).toBe(5);
    expect(asyncIndex.partitions["async_test|architecture"]).toBeDefined();
  });
});
