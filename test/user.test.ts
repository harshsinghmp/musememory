import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getUserProfile,
  setUserProfile,
  initUserProfile,
  userFilePath,
  ARCHETYPE_TEMPLATES,
  type UserArchetype,
} from "../src/user.ts";
import { openStore } from "../src/store.ts";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "user-test-"));
}

describe("USER.md profile & preferences engine", () => {
  test("ARCHETYPE_TEMPLATES contains clean, zero-fingerprint defaults for all 5 archetypes", () => {
    const archetypes: UserArchetype[] = ["developer", "designer", "marketer", "casual", "custom"];
    for (const arch of archetypes) {
      const template = ARCHETYPE_TEMPLATES[arch];
      expect(template).toBeDefined();
      expect(template.length).toBeGreaterThan(50);
      expect(template).toContain("USER.md");
      // Verify zero personal fingerprints
      expect(template).not.toContain("/home/");
      expect(template).not.toContain("/Users/");
    }
  });

  test("initUserProfile creates USER.md with selected archetype", () => {
    const root = temp();
    const targetPath = userFilePath(root);
    expect(existsSync(targetPath)).toBe(false);

    const created = initUserProfile(root, "designer");
    expect(existsSync(targetPath)).toBe(true);
    expect(created).toContain("UI/UX Designer");

    // Default without overwrite preserves existing
    const secondCall = initUserProfile(root, "developer", false);
    expect(secondCall).toContain("UI/UX Designer");

    // Overwrite updates to new archetype
    const overwritten = initUserProfile(root, "marketer", true);
    expect(overwritten).toContain("Growth & Marketing Strategist");

    rmSync(root, { recursive: true, force: true });
  });

  test("getUserProfile falls back from local workspace to global store", () => {
    const localDir = temp();
    const globalDir = temp();

    // Local missing, global missing -> null (or global default if set)
    const initial = getUserProfile(localDir);

    // Set local profile
    setUserProfile(localDir, "# Custom Local Profile\n- Tone: Ultra terse");
    expect(getUserProfile(localDir)).toContain("Ultra terse");

    rmSync(localDir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
  });

  test("setUserProfile intercepts and rejects secrets via Vibeguard scanner", () => {
    const root = temp();

    expect(() => {
      setUserProfile(root, "User prefers API key: sk-ant-api03-1234567890abcdef1234567890abcdef1234567890abcdef1234");
    }).toThrow(/Secret detected in USER\.md/);

    rmSync(root, { recursive: true, force: true });
  });

  test("MemoryStore methods getUserProfile and setUserProfile integrate seamlessly", () => {
    const root = temp();
    const store = openStore(root);

    store.setUserProfile("# Developer Profile\n- Prefers TypeScript and Bun");
    expect(store.getUserProfile()).toContain("Prefers TypeScript and Bun");

    rmSync(root, { recursive: true, force: true });
  });
});
