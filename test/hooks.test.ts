import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHookPack, uninstallHookPack, buildHookEntry } from "../src/hooks/pack.ts";
import { findOrCreateProjectRoot } from "../src/root.ts";
import { openStore, propose, confirm } from "../src/store.ts";
import { recordObservation } from "../src/learning/observation.ts";
import { distillObservationsToCandidates } from "../src/learning/distill.ts";

describe("Claude Code Hook Pack (GAP-2)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-hooks-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("settings.json wiring", () => {
    it("builds correct hook entries with timeouts", () => {
      const entry = buildHookEntry("SessionStart");
      expect(entry.type).toBe("command");
      expect(entry.command).toBe("memory hooks session-start");
      expect(entry.timeout).toBeGreaterThan(0);
    });

    it("installs all three hooks into settings.json", () => {
      const settingsDir = join(tmpDir, ".claude");
      mkdirSync(settingsDir, { recursive: true });
      const settingsPath = join(settingsDir, "settings.json");

      const result = installHookPack(tmpDir, { settingsPath });

      expect(result.installed).toHaveLength(3);
      expect(result.installed.map((r) => r.event)).toEqual([
        "SessionStart",
        "PostToolUse",
        "Stop",
      ]);

      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      expect(settings.hooks.SessionStart[0].command).toBe("memory hooks session-start");
      expect(settings.hooks.PostToolUse[0].command).toBe("memory hooks post-tool-use");
      expect(settings.hooks.Stop[0].command).toBe("memory hooks stop");
    });

    it("is idempotent — refreshes Muse entries instead of duplicating", () => {
      const settingsPath = join(tmpDir, "settings.json");
      installHookPack(tmpDir, { settingsPath });
      const second = installHookPack(tmpDir, { settingsPath });

      expect(second.alreadyPresent).toBe(true);
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      expect(settings.hooks.SessionStart).toHaveLength(1);
    });

    it("preserves unrelated user hooks and updates only Muse-owned entries", () => {
      const settingsPath = join(tmpDir, "settings.json");
      writeFileSync(
        settingsPath,
        JSON.stringify({
          hooks: {
            SessionStart: [{ type: "command", command: "echo user-hook" }],
          },
          allowedTools: ["Bash"],
        }),
        "utf8",
      );

      installHookPack(tmpDir, { settingsPath });

      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      expect(settings.hooks.SessionStart).toHaveLength(2);
      expect(settings.hooks.SessionStart[0].command).toBe("echo user-hook");
      expect(settings.allowedTools).toEqual(["Bash"]);
    });

    it("uninstalls only Muse-owned entries, leaving user hooks intact", () => {
      const settingsPath = join(tmpDir, "settings.json");
      installHookPack(tmpDir, { settingsPath });
      // Add a user hook too
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      settings.hooks.Stop.push({ type: "command", command: "echo mine" });
      writeFileSync(settingsPath, JSON.stringify(settings), "utf8");

      const result = uninstallHookPack(tmpDir, { settingsPath });
      expect(result.removed).toEqual(["SessionStart", "PostToolUse", "Stop"]);

      const after = JSON.parse(readFileSync(settingsPath, "utf8"));
      expect(after.hooks.Stop).toHaveLength(1);
      expect(after.hooks.Stop[0].command).toBe("echo mine");
      expect(after.hooks.SessionStart).toBeUndefined();
    });

    it("dry-run does not write", () => {
      const settingsPath = join(tmpDir, "settings.json");
      installHookPack(tmpDir, { settingsPath, dryRun: true });
      expect(existsSync(settingsPath)).toBe(false);
    });

    it("refuses to fabricate ~/.claude when missing (no dry-run)", () => {
      const missingHome = join(tmpDir, "no-claude");
      expect(() => installHookPack(missingHome)).toThrow(/not found/);
    });
  });

  describe("payload engines", () => {
    it("distills observations into candidates on stop (engine-level)", () => {
      const { memoryDir } = findOrCreateProjectRoot(tmpDir);
      const store = openStore(memoryDir);

      recordObservation(store, {
        source: "tool",
        project: "hooktest",
        raw: "Avoid using jsonwebtoken in Edge runtime; it caused a regression. Use jose instead.",
        summary: "bcrypt edge incompatibility",
      });

      const result = distillObservationsToCandidates(store, "hooktest");
      expect(result.negativeLessons.length + result.proposedCandidates.length).toBeGreaterThan(0);
    });

    it("session hook stays silent when cwd has no muse root (fail-open)", () => {
      // A cwd whose ancestor chain contains no .memory/.git at all — / here,
      // which is outside any project. The hook must not throw and must not
      // emit a context block.
      const { runSessionStartHook } = require("../src/hooks/pack.ts");
      const origCwd = process.cwd();
      const captured: string[] = [];
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: any) => {
        captured.push(String(chunk));
        return true;
      }) as any;
      try {
        process.chdir("/");
        runSessionStartHook();
      } finally {
        process.chdir(origCwd);
        process.stdout.write = origWrite;
      }
      expect(captured.join("")).toBe("");
    });
  });

  describe("CLI integration (--with-hooks)", () => {
    it("memory hooks CLI dispatches install into a temp settings file", async () => {
      const { handleHooksCommand } = await import("../src/cli/retrieval.ts");
      const settingsPath = join(tmpDir, "settings.json");
      const code = await handleHooksCommand({
        positional: ["install"],
        flags: { settings: settingsPath },
      });
      expect(code).toBe(0);
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      expect(settings.hooks.SessionStart[0].command).toBe("memory hooks session-start");
    });
  });
});
