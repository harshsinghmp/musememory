import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, get } from "../src/store.ts";
import {
  ProviderRegistry,
  HeuristicFallbackProvider,
  CodeGraphProvider,
  GraphifyProvider,
  LspProvider,
  enrichMemoryWithCodeIntel,
} from "../src/intelligence/index.ts";
import type { CodeIntelligenceProvider } from "../src/intelligence/types.ts";

describe("R4 Optional Code Intelligence Provider Architecture & Fallbacks", () => {
  let testDir: string;
  let memoryDir: string;
  let store: ReturnType<typeof openStore>;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "musememory-intel-test-"));
    memoryDir = join(testDir, ".memory");
    store = openStore(memoryDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("Heuristic Fallback Provider (zero external dependencies)", () => {
    it("is always available and resolves symbols via lightweight AST/regex inspection", async () => {
      const srcFile = join(testDir, "service.ts");
      writeFileSync(
        srcFile,
        `
export class PaymentService {
  processTransaction(amount: number): boolean {
    return true;
  }
}

export function calculateTax(rate: number): number {
  return rate * 0.1;
}
`,
        "utf8",
      );

      const provider = new HeuristicFallbackProvider();
      expect(provider.isAvailable(testDir)).toBe(true);

      const symbols = await provider.resolveSymbols("PaymentService", testDir);
      expect(symbols.length).toBeGreaterThan(0);
      expect(symbols[0].name).toBe("PaymentService");
      expect(symbols[0].kind).toBe("class");

      const fnSymbols = await provider.resolveSymbols("calculateTax", testDir);
      expect(fnSymbols.length).toBeGreaterThan(0);
      expect(fnSymbols[0].name).toBe("calculateTax");
      expect(fnSymbols[0].kind).toBe("function");
    });

    it("detects callers and calculates blast radius with zero dependencies", async () => {
      writeFileSync(
        join(testDir, "utils.ts"),
        `
export function sanitizeInput(input: string): string {
  return input.trim();
}
`,
        "utf8",
      );

      writeFileSync(
        join(testDir, "consumer.ts"),
        `
import { sanitizeInput } from "./utils";

export function handleRequest(raw: string) {
  const clean = sanitizeInput(raw);
  return clean;
}
`,
        "utf8",
      );

      const provider = new HeuristicFallbackProvider();
      const callers = await provider.getCallers("sanitizeInput", testDir);
      expect(callers.length).toBeGreaterThan(0);
      expect(callers[0].file).toContain("consumer.ts");

      const blast = await provider.getBlastRadius("sanitizeInput", testDir);
      expect(blast.target).toBe("sanitizeInput");
      expect(blast.affectedFiles.length).toBeGreaterThan(0);
    });
  });

  describe("CodeGraph and Graphify Optional Adapters", () => {
    it("CodeGraphProvider is only available when .codegraph exists", () => {
      const provider = new CodeGraphProvider();
      expect(provider.isAvailable(testDir)).toBe(false);

      mkdirSync(join(testDir, ".codegraph"), { recursive: true });
      expect(provider.isAvailable(testDir)).toBe(true);
    });

    it("GraphifyProvider is only available when .graphify exists", async () => {
      const provider = new GraphifyProvider();
      expect(provider.isAvailable(testDir)).toBe(false);

      const graphDir = join(testDir, ".graphify");
      mkdirSync(graphDir, { recursive: true });
      expect(provider.isAvailable(testDir)).toBe(true);

      // Verify reading graph.json
      writeFileSync(
        join(graphDir, "graph.json"),
        JSON.stringify({
          nodes: [
            { id: "node1", label: "AuthMiddleware", type: "class", file: "src/auth.ts", line: 10 },
          ],
          edges: [
            { source: "src/auth.ts", target: "src/user.ts", relationship: "imports" },
          ],
        }),
        "utf8",
      );

      const symbols = await provider.resolveSymbols("AuthMiddleware", testDir);
      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe("AuthMiddleware");
      expect(symbols[0].file).toBe("src/auth.ts");

      const related = await provider.getRelatedFiles("src/auth.ts", testDir);
      expect(related).toContain("src/user.ts");
    });
  });

  describe("Provider Registry & Graceful Fallback Chain", () => {
    it("auto-detects available providers and degrades gracefully to heuristic fallback", async () => {
      const registry = new ProviderRegistry();
      const available = await registry.getAvailableProviders(testDir);

      // In an empty directory with no .codegraph or .graphify, heuristic is the only active provider
      expect(available.length).toBe(1);
      expect(available[0].name).toBe("heuristic");
    });

    it("switches to next provider in fallback chain if a custom provider throws", async () => {
      const faultyProvider: CodeIntelligenceProvider = {
        name: "faulty-engine",
        isAvailable: () => true,
        getCapabilities: () => ({ resolveSymbols: true }),
        resolveSymbols: async () => {
          throw new Error("Fatal engine crash simulation");
        },
      };

      const registry = new ProviderRegistry([faultyProvider, new HeuristicFallbackProvider()]);

      writeFileSync(
        join(testDir, "app.ts"),
        `export function bootstrapApp() { return true; }`,
        "utf8",
      );

      // Faulty provider should fail silently and fall back to heuristic provider without throwing
      const symbols = await registry.resolveSymbolsWithFallback("bootstrapApp", testDir);
      expect(symbols.length).toBeGreaterThan(0);
      expect(symbols[0].name).toBe("bootstrapApp");
    });
  });

  describe("Memory Enrichment Integration", () => {
    it("enriches a memory entry with code intelligence evidence when symbols match", async () => {
      writeFileSync(
        join(testDir, "auth.ts"),
        `
export class TokenAuthenticator {
  validateToken(jwt: string): boolean {
    return true;
  }
}
`,
        "utf8",
      );

      const mem = propose(store, {
        title: "TokenAuthenticator Security Guideline",
        content: "Always check claims in TokenAuthenticator before granting admin permissions.",
        project: "security",
        tags: ["TokenAuthenticator", "auth"],
        confirmed: true,
      });

      expect(mem.evidence?.length ?? 0).toBe(0);

      const enriched = await enrichMemoryWithCodeIntel(store, mem, testDir);

      expect(enriched.evidence).toBeDefined();
      expect(enriched.evidence!.length).toBeGreaterThan(0);
      expect(enriched.evidence![0].type).toBe("code_intelligence");
      expect(enriched.evidence![0].excerpt).toContain("TokenAuthenticator");

      // Idempotency check: calling enrich again does not create duplicate evidence items
      const countBefore = enriched.evidence!.length;
      const reEnriched = await enrichMemoryWithCodeIntel(store, enriched, testDir);
      expect(reEnriched.evidence!.length).toBe(countBefore);
    });

    it("leaves memory untouched when no symbols match without throwing", async () => {
      const mem = propose(store, {
        title: "General Process Convention",
        content: "Keep daily standups under 15 minutes.",
        project: "general",
        confirmed: true,
      });

      const enriched = await enrichMemoryWithCodeIntel(store, mem, testDir);
      expect(enriched.evidence?.length ?? 0).toBe(0);
    });
  });
});
