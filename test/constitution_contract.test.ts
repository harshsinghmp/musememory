import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, save, propose, type Store } from "../src/store.ts";
import type { MemoryEntry } from "../src/types.ts";
import {
  resolveMuseContext,
  formatCompactContextPack,
} from "../src/orchestrator/context.ts";
import {
  CANONICAL_CONSTITUTIONAL_RULES,
  resolveConstitutionalRules,
  assertConstitutionWriteSafety,
  ConstitutionViolationError,
  filterToolsForConstitution,
  executeWithConstitutionGuard,
  isWriteTool,
  type ConstitutionalRule,
} from "../src/orchestrator/constitution.ts";

describe("T-132: constitution contract: rules injected first, trim-exempt, no write tool", () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-constitution-test-"));
    store = openStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Constitutional Rules Schema & Resolution", () => {
    it("provides canonical constitutional rules with trim_exempt: true", () => {
      expect(CANONICAL_CONSTITUTIONAL_RULES.length).toBeGreaterThanOrEqual(4);
      for (const rule of CANONICAL_CONSTITUTIONAL_RULES) {
        expect(rule.id).toBeDefined();
        expect(rule.title).toBeDefined();
        expect(rule.rule.length).toBeGreaterThan(10);
        expect(rule.trim_exempt).toBe(true);
      }
    });

    it("resolves custom constitutional rules and forces trim_exempt: true", () => {
      const custom: ConstitutionalRule[] = [
        {
          id: "CUSTOM-01",
          title: "Custom Airgap Rule",
          rule: "Do not execute remote outbound network requests.",
          trim_exempt: true,
        },
      ];
      const resolved = resolveConstitutionalRules(custom);
      expect(resolved.length).toBe(1);
      expect(resolved[0].id).toBe("CUSTOM-01");
      expect(resolved[0].trim_exempt).toBe(true);
    });
  });

  describe("Rules Injected First", () => {
    it("injects constitutional rules at index 0 of FusedContextResult", async () => {
      const mem1: MemoryEntry = {
        id: "m_test_1",
        title: "Database migration lock",
        content: "Acquire advisory lock before running migrations",
        project: "test",
        type: "decision",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      save(store, mem1);

      const fused = await resolveMuseContext(store, tmpDir, {
        query: "database migrations",
        include_constitution: true,
        token_budget: 3000,
      });

      expect(fused.constitutional_rules).toBeDefined();
      expect(fused.constitutional_rules?.length).toBe(CANONICAL_CONSTITUTIONAL_RULES.length);
      expect(fused.constitutional_rules?.[0].id).toBe("R1-zero-claude");

      // Manifest lists constitution first
      expect(fused.context_manifest).toBeDefined();
      expect(fused.context_manifest?.[0].type).toBe("constitution");
      expect(fused.context_manifest?.[0].truncated).toBe(false);
    });

    it("renders constitutional directives at the very top of formatCompactContextPack", async () => {
      const mem1 = propose(store, {
        title: "Postgres schema standard",
        content: "Always use UUIDv7 for primary keys in new tables",
        project: "test",
        type: "constraint",
        confirmed: true,
      });
      save(store, mem1);

      const fused = await resolveMuseContext(store, tmpDir, {
        query: "schema postgres",
        include_constitution: true,
        token_budget: 2000,
      });

      const formatted = formatCompactContextPack(fused);
      expect(formatted).toContain("## 📜 Constitutional Directives (Trim-Exempt · Immutable)");
      expect(formatted).toContain("Zero-Claude Isolation");
      expect(formatted).toContain("Zero Secret Exposure");

      // Verify constitutional directives appear BEFORE active constraints and memories
      const constitutionIndex = formatted.indexOf("## 📜 Constitutional Directives");
      const constraintsIndex = formatted.indexOf("## 🔒 Active Constraints & Invariants");
      const memoriesIndex = formatted.indexOf("## 💡 Relevant Memories & Decisions");

      expect(constitutionIndex).toBeGreaterThan(0);
      if (constraintsIndex !== -1) {
        expect(constitutionIndex).toBeLessThan(constraintsIndex);
      }
      if (memoriesIndex !== -1) {
        expect(constitutionIndex).toBeLessThan(memoriesIndex);
      }
    });
  });

  describe("Trim-Exempt Guarantee Under Exhausted Token Budget", () => {
    it("preserves constitutional rules even when token budget is 0 or near-zero", async () => {
      // Seed store with multiple memories
      for (let i = 0; i < 5; i++) {
        save(
          store,
          propose(store, {
            title: `Architecture Decision Record ${i}`,
            content: `Documenting architecture decision ${i} covering database connection pooling, query caching layers, telemetry collectors, and write buffer persistence strategies across nodes.`,
            project: "test",
            type: "fix",
            confirmed: true,
            skipRetentionGate: true,
          })
        );
      }

      // Zero token budget
      const fusedZeroBudget = await resolveMuseContext(store, tmpDir, {
        query: "memory",
        include_constitution: true,
        token_budget: 0,
      });

      // Constitutional rules are strictly trim-exempt: never dropped
      expect(fusedZeroBudget.constitutional_rules).toBeDefined();
      expect(fusedZeroBudget.constitutional_rules?.length).toBe(CANONICAL_CONSTITUTIONAL_RULES.length);

      // All regular candidate memories are omitted
      expect(fusedZeroBudget.relevant_memories.length).toBe(0);

      // Manifest marks constitution as not truncated, but memories as truncated
      const constitutionItems = fusedZeroBudget.context_manifest?.filter((m) => m.type === "constitution");
      expect(constitutionItems?.every((c) => c.truncated === false)).toBe(true);

      const memoryItems = fusedZeroBudget.context_manifest?.filter((m) => m.type !== "constitution");
      expect(memoryItems?.every((m) => m.truncated === true)).toBe(true);
    });
  });

  describe("No Write Tool Contract & Immutability Enforcement", () => {
    it("correctly identifies write tools vs read tools", () => {
      expect(isWriteTool("write_to_file")).toBe(true);
      expect(isWriteTool("replace_file_content")).toBe(true);
      expect(isWriteTool("save")).toBe(true);
      expect(isWriteTool("delete")).toBe(true);
      expect(isWriteTool("propose")).toBe(true);
      expect(isWriteTool("mutate_rule")).toBe(true);
      expect(isWriteTool("drop_table")).toBe(true);

      expect(isWriteTool("read_file")).toBe(false);
      expect(isWriteTool("get_context")).toBe(false);
      expect(isWriteTool("list")).toBe(false);
      expect(isWriteTool("search")).toBe(false);
      expect(isWriteTool("view_file")).toBe(false);
    });

    it("rejects write tools attempting to mutate constitutional directives", () => {
      expect(() => {
        assertConstitutionWriteSafety("save", "R1-zero-claude");
      }).toThrow(ConstitutionViolationError);

      expect(() => {
        assertConstitutionWriteSafety("replace_file_content", "CONSTITUTION.md");
      }).toThrow(ConstitutionViolationError);

      expect(() => {
        assertConstitutionWriteSafety("delete", "constitutional_rules");
      }).toThrow(ConstitutionViolationError);

      // Read tools on constitutional targets are allowed
      expect(() => {
        assertConstitutionWriteSafety("view_file", "CONSTITUTION.md");
      }).not.toThrow();
    });

    it("rejects all write tools when operating in strict read-only constitution mode", () => {
      expect(() => {
        assertConstitutionWriteSafety("write_to_file", "src/index.ts", { strictReadOnly: true });
      }).toThrow(ConstitutionViolationError);

      expect(() => {
        assertConstitutionWriteSafety("read_file", "src/index.ts", { strictReadOnly: true });
      }).not.toThrow();
    });

    it("filters out write tools from available tool list for constitution-bound agents", () => {
      const tools = ["get_context", "query", "save", "delete", "read_file", "replace_file_content"];
      const readOnlyTools = filterToolsForConstitution(tools);
      expect(readOnlyTools).toEqual(["get_context", "query", "read_file"]);

      const allTools = filterToolsForConstitution(tools, { allowWriteTools: true });
      expect(allTools).toEqual(tools);
    });

    it("executeWithConstitutionGuard wraps execution safely", () => {
      // Safe read operation
      const readResult = executeWithConstitutionGuard("get_context", "R1-zero-claude", () => "rules_content");
      expect(readResult).toBe("rules_content");

      // Mutating operation blocked
      expect(() => {
        executeWithConstitutionGuard("save", "R1-zero-claude", () => {
          throw new Error("Should never execute");
        });
      }).toThrow(ConstitutionViolationError);
    });
  });
});
