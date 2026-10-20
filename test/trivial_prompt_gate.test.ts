import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isTrivialQuery,
  evaluateTrivialPromptGate,
} from "../src/orchestrator/trivial_gate.ts";
import { resolveMuseContext, formatCompactContextPack } from "../src/orchestrator/context.ts";
import { openStore, propose } from "../src/store.ts";
import type { Store } from "../src/store.ts";

describe("T-113: Trivial-prompt gate (skip recall for greetings)", () => {
  describe("isTrivialQuery", () => {
    it("recognizes common conversational greetings", () => {
      expect(isTrivialQuery("hi")).toBe(true);
      expect(isTrivialQuery("hello!")).toBe(true);
      expect(isTrivialQuery("Hey there")).toBe(true);
      expect(isTrivialQuery("good morning...")).toBe(true);
      expect(isTrivialQuery("howdy")).toBe(true);
      expect(isTrivialQuery("yo")).toBe(true);
      expect(isTrivialQuery("sup?")).toBe(true);
    });

    it("recognizes conversational acknowledgments and pleasantries", () => {
      expect(isTrivialQuery("thanks")).toBe(true);
      expect(isTrivialQuery("thank you!")).toBe(true);
      expect(isTrivialQuery("ok")).toBe(true);
      expect(isTrivialQuery("okay")).toBe(true);
      expect(isTrivialQuery("cool")).toBe(true);
      expect(isTrivialQuery("got it")).toBe(true);
      expect(isTrivialQuery("bye")).toBe(true);
    });

    it("recognizes empty or minimal non-semantic strings", () => {
      expect(isTrivialQuery("")).toBe(true);
      expect(isTrivialQuery("   ")).toBe(true);
      expect(isTrivialQuery("?")).toBe(true);
      expect(isTrivialQuery("..")).toBe(true);
      expect(isTrivialQuery("a")).toBe(true);
    });

    it("does not flag substantive technical queries as trivial", () => {
      expect(isTrivialQuery("How do I configure redis cluster caching?")).toBe(false);
      expect(isTrivialQuery("fix race condition in connection pool")).toBe(false);
      expect(isTrivialQuery("migrate database schema to v2")).toBe(false);
      expect(isTrivialQuery("build error TS2304")).toBe(false);
    });
  });

  describe("evaluateTrivialPromptGate", () => {
    it("gates pure greeting input without technical anchors", () => {
      const decision = evaluateTrivialPromptGate({ query: "Hello there!" });
      expect(decision.isTrivial).toBe(true);
      expect(decision.reason).toContain("trivial_prompt_gated");
    });

    it("does NOT gate greeting when active_file is specified", () => {
      const decision = evaluateTrivialPromptGate({
        query: "Hello!",
        active_file: "src/store.ts",
      });
      expect(decision.isTrivial).toBe(false);
    });

    it("does NOT gate greeting when symbol is specified", () => {
      const decision = evaluateTrivialPromptGate({
        query: "hi",
        symbol: "resolveMuseContext",
      });
      expect(decision.isTrivial).toBe(false);
    });

    it("does NOT gate greeting when error_message is provided", () => {
      const decision = evaluateTrivialPromptGate({
        query: "thanks",
        error_message: "Error: Connection timeout at pool.acquire()",
      });
      expect(decision.isTrivial).toBe(false);
    });

    it("does NOT gate greeting when non-general task_intent is specified", () => {
      const decision = evaluateTrivialPromptGate({
        query: "hello",
        task_intent: "bugfix",
      });
      expect(decision.isTrivial).toBe(false);
    });

    it("does NOT gate technical queries", () => {
      const decision = evaluateTrivialPromptGate({
        query: "Explain database replication topology",
      });
      expect(decision.isTrivial).toBe(false);
    });
  });

  describe("resolveMuseContext integration", () => {
    let tmpDir: string;
    let store: Store;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "muse-trivial-gate-test-"));
      store = openStore(tmpDir);
    });

    afterEach(() => {
      if (tmpDir) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("bypasses memory recall for pure greetings while preserving constraints", async () => {
      // Seed a memory and a constraint
      propose(store, {
        id: "mem_greeting_recall",
        title: "Database connection pool",
        content: "Pool max connections 25",
        project: "core",
        type: "decision",
        confirmed: true,
      });

      propose(store, {
        id: "const_secret",
        title: "Zero secrets policy",
        content: "Never log passwords or raw credentials",
        project: "core",
        type: "constraint",
        confirmed: true,
      });

      // Greeting prompt
      const result = await resolveMuseContext(store, tmpDir, {
        query: "Hello!",
        project: "core",
      });

      // Recall was bypassed
      expect(result.trivial_prompt_gated).toBe(true);
      expect(result.trivial_gate_reason).toContain("trivial_prompt_gated");
      expect(result.mode).toBe("no_confident_match");
      expect(result.relevant_memories.length).toBe(0);

      // Constraints are still loaded
      expect(result.active_constraints.some((c) => c.title === "Zero secrets policy")).toBe(true);

      // Next steps guide the user to ask a specific question
      expect(result.suggested_next_steps[0]).toContain("State a specific technical goal");

      // Verify formatCompactContextPack renders informational banner
      const packed = formatCompactContextPack(result);
      expect(packed).toContain("Conversational greeting or acknowledgement detected");
    });

    it("executes recall when enable_trivial_gate is false", async () => {
      propose(store, {
        id: "mem_welcome_rule",
        title: "Hello world convention",
        content: "Greeting banners must follow brand tokens",
        project: "core",
        type: "decision",
        confirmed: true,
      });

      const result = await resolveMuseContext(store, tmpDir, {
        query: "hello",
        project: "core",
        enable_trivial_gate: false,
      });

      expect(result.trivial_prompt_gated).toBeUndefined();
    });

    it("executes recall when technical anchor accompanies greeting", async () => {
      const authDir = join(tmpDir, "src/auth");
      const { mkdirSync } = await import("node:fs");
      mkdirSync(authDir, { recursive: true });
      writeFileSync(join(authDir, "jwt.ts"), "export function signToken() {}\n");

      const { save } = await import("../src/store.ts");
      save(store, {
        id: "mem_auth_token",
        title: "JWT signing configuration",
        content: "Use RS256 with 2048-bit key for JWT signing",
        project: "auth",
        type: "decision",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        anchors: [
          {
            id: "anc_sign_token",
            kind: "symbol",
            file_path: "src/auth/jwt.ts",
            symbol_name: "signToken",
          },
        ],
      });

      const result = await resolveMuseContext(store, tmpDir, {
        query: "hi",
        symbol: "signToken",
        project: "auth",
      });

      expect(result.trivial_prompt_gated).toBeUndefined();
      expect(result.code_anchors.some((a) => a.symbol_name === "signToken")).toBe(true);
    });
  });
});
