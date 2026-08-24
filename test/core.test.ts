import { describe, test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CORE_TIERS, coreFilePath, readCore, setCore, removeCore, formatCoreBlock } from "../src/core.ts";
import { formatPromptContext } from "../src/retrieval.ts";
import { openStore, propose } from "../src/store.ts";
import { setCurrent } from "../src/current.ts";
import { setUserProfile } from "../src/user.ts";
import { setupFixtureRoot, cleanup, makeTempRoot } from "./helpers.ts";

describe("CORE.md partitioning", () => {
  test("setCore writes tiers in place and readCore roundtrips them", () => {
    const root = makeTempRoot();
    const memoryDir = join(root, ".memory");

    setCore(memoryDir, "identity", "I am Muse Memory, file-backed cognition engine.");
    setCore(memoryDir, "directives", "Always confirm before delete.\nNever leak secrets.");

    expect(existsSync(coreFilePath(memoryDir))).toBe(true);
    const tiers = readCore(memoryDir);
    expect(tiers.identity).toEqual(["I am Muse Memory, file-backed cognition engine."]);
    expect(tiers.directives).toEqual(["Always confirm before delete.", "Never leak secrets."]);
    expect(tiers.conventions).toEqual([]);
    expect(tiers.context).toEqual([]);

    // Overwrite replaces tier content without touching others
    setCore(memoryDir, "identity", "New identity line");
    const updated = readCore(memoryDir);
    expect(updated.identity).toEqual(["New identity line"]);
    expect(updated.directives.length).toBe(2);

    cleanup(root);
  });

  test("removeCore clears one tier and leaves the rest intact", () => {
    const root = makeTempRoot();
    const memoryDir = join(root, ".memory");

    setCore(memoryDir, "conventions", "Use Bun, not Node.");
    setCore(memoryDir, "context", "Working on musememory repo.");
    removeCore(memoryDir, "conventions");

    const tiers = readCore(memoryDir);
    expect(tiers.conventions).toEqual([]);
    expect(tiers.context).toEqual(["Working on musememory repo."]);

    cleanup(root);
  });

  test("setCore rejects secrets via Vibeguard scanner", () => {
    const root = makeTempRoot();
    const memoryDir = join(root, ".memory");

    expect(() => {
      setCore(memoryDir, "directives", "key: sk-proj-12345678901234567890123456");
    }).toThrow(/Secret detected in CORE\.md/);

    cleanup(root);
  });

  test("readCore on missing CORE.md returns empty tiers; formatCoreBlock null when empty", () => {
    const root = makeTempRoot();
    const memoryDir = join(root, ".memory");

    expect(readCore(memoryDir)).toEqual({ identity: [], directives: [], conventions: [], context: [] });
    expect(formatCoreBlock(memoryDir)).toBeNull();
    expect(formatCoreBlock(undefined)).toBeNull();

    cleanup(root);
  });

  test("formatPromptContext injects CORE.md between USER profile and CURRENT constraints", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    setUserProfile(memoryDir, "# Developer Profile\n- Tone: terse");
    setCurrent(memoryDir, "Ship only via feature branches.", "aria");
    setCore(memoryDir, "identity", "Autonomous memory agent for this workspace.");
    propose(store, { title: "Branching Rule", content: "feature branch then PR", project: "aria", confirmed: true });

    const formatted = formatPromptContext(store, memoryDir, "branching", {});
    const md = formatted.markdown;
    const userProfileIdx = md.indexOf("### User Profile & Preferences (USER.md)");
    const coreIdx = md.indexOf("### Core Memory (CORE.md)");
    const constraintsIdx = md.indexOf("### Active Working Constraints (CURRENT.md)");

    expect(coreIdx).toBeGreaterThan(-1);
    expect(userProfileIdx).toBeLessThan(coreIdx);
    expect(coreIdx).toBeLessThan(constraintsIdx);
    expect(md).toContain("Autonomous memory agent");

    cleanup(root);
  });
});
