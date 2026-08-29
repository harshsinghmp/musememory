import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectProvider,
  getGraphStatus,
  indexGraph,
  loadGraphSymbolIndex,
  extractReferencedSymbols,
  autoStampGraphMetadata,
} from "../src/graph.ts";
import { openStore, propose } from "../src/store.ts";
import { queryContext, scoreEntry, graphSymbolOverlapBonus } from "../src/retrieval.ts";

describe("SOW-107: AST Symbol Graph Integration (CodeGraph / Graphify)", () => {
  let projectRoot: string;
  let memoryDir: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "muse-ast-graph-"));
    memoryDir = join(projectRoot, ".memory");
    mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(projectRoot, { recursive: true, force: true });
    } catch {}
  });

  it("detectProvider and getGraphStatus identify CodeGraph, Graphify, and none", () => {
    // 1. None by default
    expect(detectProvider(projectRoot)).toBe("none");
    const statusNone = getGraphStatus(projectRoot);
    expect(statusNone.provider).toBe("none");
    expect(statusNone.available).toBe(false);

    // 2. CodeGraph detected
    const codegraphDir = join(projectRoot, ".codegraph");
    mkdirSync(codegraphDir, { recursive: true });
    writeFileSync(join(codegraphDir, "meta.json"), JSON.stringify({ revision: "v2.1.0", symbolCount: 42 }));

    expect(detectProvider(projectRoot)).toBe("codegraph");
    const statusCodeGraph = getGraphStatus(projectRoot);
    expect(statusCodeGraph.provider).toBe("codegraph");
    expect(statusCodeGraph.available).toBe(true);
    expect(statusCodeGraph.graphRevision).toBe("v2.1.0");

    // Clean up .codegraph
    rmSync(codegraphDir, { recursive: true, force: true });

    // 3. Graphify detected
    const graphifyDir = join(projectRoot, ".graphify");
    mkdirSync(graphifyDir, { recursive: true });
    writeFileSync(join(graphifyDir, "meta.json"), JSON.stringify({ commit: "git-commit-abc" }));

    expect(detectProvider(projectRoot)).toBe("graphify");
    const statusGraphify = getGraphStatus(projectRoot);
    expect(statusGraphify.provider).toBe("graphify");
    expect(statusGraphify.available).toBe(true);
    expect(statusGraphify.graphRevision).toBe("git-commit-abc");
  });

  it("indexGraph parses symbols from .codegraph and caches graph-symbols.json in .memory/", () => {
    const codegraphDir = join(projectRoot, ".codegraph");
    mkdirSync(codegraphDir, { recursive: true });

    // Mock symbols in .codegraph/symbols.json
    const mockSymbols = [
      { name: "handleAuthentication", path: "src/auth/handler.ts" },
      { name: "TokenValidator", path: "src/auth/validator.ts" },
      { name: "queryContext", path: "src/retrieval.ts" },
    ];
    writeFileSync(join(codegraphDir, "symbols.json"), JSON.stringify(mockSymbols));

    const index = indexGraph(projectRoot, memoryDir);
    expect(index.provider).toBe("codegraph");
    expect(index.symbolCount).toBe(3);
    expect(index.symbols["handleAuthentication"]).toBe("src/auth/handler.ts");
    expect(index.symbols["TokenValidator"]).toBe("src/auth/validator.ts");
    expect(index.symbols["queryContext"]).toBe("src/retrieval.ts");

    // Verify cache load
    const loaded = loadGraphSymbolIndex(memoryDir);
    expect(loaded).not.toBeNull();
    expect(loaded?.symbolCount).toBe(3);
    expect(loaded?.symbols["TokenValidator"]).toBe("src/auth/validator.ts");
  });

  it("extractReferencedSymbols matches code identifiers from text", () => {
    const codegraphDir = join(projectRoot, ".codegraph");
    mkdirSync(codegraphDir, { recursive: true });
    writeFileSync(
      join(codegraphDir, "symbols.json"),
      JSON.stringify([
        { name: "handleAuthentication", path: "src/auth/handler.ts" },
        { name: "TokenValidator", path: "src/auth/validator.ts" },
        { name: "databasePool", path: "src/db/pool.ts" },
      ]),
    );
    indexGraph(projectRoot, memoryDir);

    const text = "Refactored handleAuthentication to use TokenValidator for JWT verification.";
    const extracted = extractReferencedSymbols(text, memoryDir);

    expect(extracted.provider).toBe("codegraph");
    expect(extracted.symbol_names).toContain("handleAuthentication");
    expect(extracted.symbol_names).toContain("TokenValidator");
    expect(extracted.symbol_names).not.toContain("databasePool");
    expect(extracted.affected_paths).toContain("src/auth/handler.ts");
    expect(extracted.affected_paths).toContain("src/auth/validator.ts");
  });

  it("store.propose automatically stamps entry.graph with symbol_names and affected_paths", () => {
    const codegraphDir = join(projectRoot, ".codegraph");
    mkdirSync(codegraphDir, { recursive: true });
    writeFileSync(
      join(codegraphDir, "symbols.json"),
      JSON.stringify([
        { name: "executeMigration", path: "src/migrator/engine.ts" },
        { name: "detectProviders", path: "src/migrator/detect.ts" },
      ]),
    );
    indexGraph(projectRoot, memoryDir);

    const store = openStore(memoryDir);
    const entry = propose(store, {
      title: "Migration Bug Fix",
      content: "Ensure executeMigration properly invokes detectProviders before state mapping.",
      project: "test_proj",
      type: "fix",
      confirmed: true,
    });

    expect(entry.graph).toBeDefined();
    expect(entry.graph?.provider).toBe("codegraph");
    expect(entry.graph?.symbol_names).toContain("executeMigration");
    expect(entry.graph?.symbol_names).toContain("detectProviders");
    expect(entry.graph?.affected_paths).toContain("src/migrator/engine.ts");
    expect(entry.graph?.affected_paths).toContain("src/migrator/detect.ts");
  });

  it("graphSymbolOverlapBonus and queryContext boost symbol-matching memories", () => {
    const store = openStore(memoryDir);
    const now = Date.now();

    // Memory A: with matching AST symbols
    const memoryA = propose(store, {
      title: "Authentication Token Handling",
      content: "General notes on tokens and authentication handlers.",
      project: "test_proj",
      type: "architecture",
      confirmed: true,
      graph: {
        provider: "codegraph",
        symbol_names: ["handleAuthentication", "TokenValidator"],
        affected_paths: ["src/auth/handler.ts"],
      },
    });

    // Memory B: without graph symbols
    const memoryB = propose(store, {
      title: "Authentication Token Handling",
      content: "General notes on tokens and authentication handlers.",
      project: "test_proj",
      type: "architecture",
      confirmed: true,
    });

    // Query specifically targeting the symbol name
    const queryTokens = ["handleauthentication", "token"];
    const bonusA = graphSymbolOverlapBonus(memoryA, queryTokens);
    const bonusB = graphSymbolOverlapBonus(memoryB, queryTokens);

    expect(bonusA).toBeGreaterThan(0);
    expect(bonusB).toBe(0);

    const scoreA = scoreEntry(memoryA, queryTokens, now);
    const scoreB = scoreEntry(memoryB, queryTokens, now);
    expect(scoreA).toBeGreaterThan(scoreB);

    // queryContext ranking
    const res = queryContext(store, "handleAuthentication token");
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results[0].entry.id).toBe(memoryA.id);
  });
});
