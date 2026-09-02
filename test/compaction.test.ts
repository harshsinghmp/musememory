import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, list } from "../src/store.ts";
import {
  evaluateContextUsage,
  generateSessionHandoff,
  harvestSessionMemories,
} from "../src/compaction/index.ts";
import { getAuditTrail } from "../src/audit.ts";

describe("R6 Context Compaction & Session Handoff Distillation Engine", () => {
  let testDir: string;
  let memoryDir: string;
  let store: ReturnType<typeof openStore>;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "musememory-compaction-test-"));
    memoryDir = join(testDir, ".memory");
    store = openStore(memoryDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("Context Usage Evaluation (70% Invariant Rule)", () => {
    it("reports normal status when context is under 70%", () => {
      const evalResult = evaluateContextUsage(100_000, 200_000); // 50%
      expect(evalResult.usagePercent).toBe(50);
      expect(evalResult.thresholdExceeded).toBe(false);
      expect(evalResult.prompt).toContain("Context at 50% used");
    });

    it("triggers compaction prompt when context hits or exceeds 70%", () => {
      const evalResult = evaluateContextUsage(142_000, 200_000); // 71%
      expect(evalResult.usagePercent).toBe(71);
      expect(evalResult.thresholdExceeded).toBe(true);
      expect(evalResult.prompt).toBe("Context at 71%. Compact now or continue?");
    });
  });

  describe("Interruption-Proof Session Handoff (CURRENT.md)", () => {
    it("locks 5 mandatory invariants and writes structured handoff to CURRENT.md", () => {
      const result = generateSessionHandoff(
        memoryDir,
        {
          highLevelGoal: "Evolve MuseMemory into autonomous cognitive engine",
          currentArchitecture: "Local-first SQLite + Flat-file dual persistence with L0 hot cache",
          completedTasks: [
            "PR 1: Core Speed (L0/L1 hot cache & FTS5)",
            "PR 2: Quality & Contradiction Engine",
            "PR 3: Autonomous Learning & Negative Lessons",
            "PR 4: Code Intelligence Provider Architecture",
            "PR 5: Multi-Factor Ranking Engine",
          ],
          openTasks: ["PR 7: Clean PR -> dev -> main branch release"],
          nextConcreteTask: "Execute release gate validation and merge dev into main",
          activeConstraints: ["Zero external daemons required", "Vibeguard secret isolation"],
          decisionsMade: ["Chose in-process SQLite FTS5 over external vector DBs"],
        },
        { agent: "Muse", sessionId: "sess_401", project: "musememory" },
      );

      expect(existsSync(result.currentMdPath)).toBe(true);

      const content = readFileSync(result.currentMdPath, "utf8");
      expect(content).toContain("## 🎯 2. High-Level Goal");
      expect(content).toContain("Evolve MuseMemory into autonomous cognitive engine");
      expect(content).toContain("## 🏗️ 3. Current Architecture & Data Flow");
      expect(content).toContain("## ✅ 4. Implemented & Done");
      expect(content).toContain("PR 1: Core Speed");
      expect(content).toContain("## ⏳ 5. Explicitly Not Done Yet");
      expect(content).toContain("PR 7: Clean PR");
      expect(content).toContain("## 🚀 6. Next Concrete Task");
      expect(content).toContain("Execute release gate validation");
      expect(content).toContain("## 📜 8. Interruption-Proof Checkpoint & Session Handoff");

      // Verify resumption prompt
      expect(result.resumptionPrompt).toContain("[SESSION HANDOFF RESUMPTION]");
      expect(result.resumptionPrompt).toContain("Next Task: Execute release gate validation");

      // Verify audit log
      const audit = getAuditTrail(memoryDir);
      expect(audit.length).toBeGreaterThan(0);
      expect(audit.some((a) => a.entry_id === "CURRENT.md")).toBe(true);
    });

    it("throws error if highLevelGoal or nextConcreteTask is omitted", () => {
      expect(() => {
        generateSessionHandoff(memoryDir, {
          highLevelGoal: "",
          currentArchitecture: "test",
          completedTasks: [],
          openTasks: [],
          nextConcreteTask: "",
        });
      }).toThrow(/Cannot generate handoff/);
    });
  });

  describe("Continuous Conversational Memory Harvester", () => {
    it("extracts decisions, fixes, constraints, and negative lessons from turn text", () => {
      const turnText = `
Architecture Decision: Chose Bun native SQLite driver over better-sqlite3 for zero-compilation cross-platform speed.
Fix: Resolved race condition in cache eviction by bumping store version sequence on write.
Invariant: Never commit unmasked API tokens or private keys to git.
Avoid: Do not use synchronous file system calls in hot retrieval loop as it introduces event loop jitter.
`;

      const harvested = harvestSessionMemories(store, turnText, {
        project: "engine",
        actor: "agent",
      });

      expect(harvested.length).toBe(4);

      const types = harvested.map((h) => h.type);
      expect(types).toContain("decision");
      expect(types).toContain("fix");
      expect(types).toContain("constraint");
      expect(types).toContain("negative");

      // Confirm entries exist in store
      const allMemories = list(store);
      expect(allMemories.length).toBe(4);
    });

    it("aborts harvesting if text contains credentials (Vibeguard defense)", () => {
      const fakeToken = "ghp_" + "123456789012345678901234567890123456";
      const dirtyText = `Decision: Use GitHub token ${fakeToken} for authentication.`;

      const harvested = harvestSessionMemories(store, dirtyText, {
        project: "auth",
      });

      expect(harvested.length).toBe(0);
      expect(list(store).length).toBe(0);
    });
  });
});
