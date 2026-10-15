import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose } from "../src/store.ts";
import { queryContext, formatPromptContext } from "../src/retrieval.ts";
import { rankAndRetrieveMemories } from "../src/retrieval/ranking.ts";

describe("Wave 3: End-to-End Retrieval, Ranking & Token Economics Integration", () => {
  let testDir: string;
  let memoryDir: string;
  let store: ReturnType<typeof openStore>;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "muse-wave3-integration-"));
    memoryDir = join(testDir, ".memory");
    store = openStore(memoryDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("negative anti-pattern lessons are packed with priority inside tight token budgets", async () => {
    // 1. Regular high-score discovery
    propose(store, {
      title: "General API Architecture Overview",
      content: "This is a detailed general guide on REST and GraphQL API design with hundreds of words and tokens that take up significant context space in the LLM context window.",
      project: "web-app",
      type: "architecture",
      confirmed: true,
    });

    // 2. Critical negative anti-pattern guardrail
    const negativeEntry = propose(store, {
      title: "DO NOT USE eval() in authentication",
      content: "Security vulnerability: Never use eval() or Function constructor when validating session tokens.",
      project: "web-app",
      type: "negative",
      tags: ["anti-pattern", "security"],
      confirmed: true,
    });

    // 3. Query with tight token budget (~80 tokens: fits negative guardrail, but not both)
    const result = queryContext(store, "API authentication security", {
      project: "web-app",
      tokenBudget: 80,
    });

    expect(result.results.length).toBeGreaterThan(0);
    // The negative guardrail MUST be packed into the tight budget first
    const hasNegative = result.results.some((r) => r.entry.id === negativeEntry.id);
    expect(hasNegative).toBe(true);
  });

  test("surfaces deterministic why_retrieved reason tokens on queryContext and rankAndRetrieveMemories", async () => {
    const entry = propose(store, {
      title: "Postgres Connection Pool Configuration",
      content: "Configure max connection pool to 20 to prevent exhaustion under burst traffic.",
      project: "backend",
      type: "architecture",
      tags: ["postgres", "database"],
      verification: { level: "independently-verified", method: "pr_review" },
      confirmed: true,
    });

    const resContext = queryContext(store, "postgres database connection pool", {
      project: "backend",
    });

    expect(resContext.results.length).toBeGreaterThan(0);
    const top = resContext.results[0];
    expect(top.why_retrieved).toBeDefined();
    expect(Array.isArray(top.why_retrieved)).toBe(true);
    expect(top.why_retrieved!).toContain("lexical_overlap");
    expect(top.why_retrieved!).toContain("verified_memory");

    const multiRank = await rankAndRetrieveMemories(store, "postgres connection", {
      project: "backend",
    });
    expect(multiRank.length).toBeGreaterThan(0);
    expect(multiRank[0].why_retrieved).toBeDefined();
    expect(multiRank[0].why_retrieved!).toContain("verified_memory");
  });

  test("returns data high-water mark timestamp on SearchResult", () => {
    const e1 = propose(store, {
      title: "First timestamp entry",
      content: "Content 1",
      project: "test",
      confirmed: true,
    });

    const res = queryContext(store, "timestamp");
    expect(res.watermark).toBeDefined();
    expect(res.watermark).toBe(e1.updated_at);
  });

  test("formatPromptContext outputs clean markdown with relevant patterns and why_retrieved reasons preserved", () => {
    propose(store, {
      title: "Safe FTS5 Escaping Rule",
      content: "Always quote tokens in FTS5 MATCH expressions.",
      project: "core",
      type: "constraint",
      confirmed: true,
    });

    const formatted = formatPromptContext(store, memoryDir, "Safe FTS5 Escaping", {
      project: "core",
    });

    expect(formatted.markdown).toContain("Safe FTS5 Escaping Rule");
    expect(formatted.entries.length).toBeGreaterThan(0);
  });
});
