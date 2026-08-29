import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getUserProfile,
  setUserProfile,
  initUserProfile,
  userFilePath,
  detectScopeArchetype,
  ARCHETYPE_TEMPLATES,
  LOCAL_USER_INHERIT_MARKER,
  type UserArchetype,
} from "../src/user.ts";

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

  test("detectScopeArchetype accurately classifies task intent from query and file hints", () => {
    // 1. Designer intent
    expect(detectScopeArchetype("Create a modern responsive navbar with Tailwind CSS and hover animations")).toBe("designer");
    expect(detectScopeArchetype("Update Figma color tokens and WCAG contrast", { files: ["theme.css"] })).toBe("designer");
    expect(detectScopeArchetype("Refactor UI layout hierarchy")).toBe("designer");

    // 2. Marketer intent
    expect(detectScopeArchetype("Write high-converting hero headline copy and SEO meta tags for launch")).toBe("marketer");
    expect(detectScopeArchetype("Craft a punchy sales email campaign with strong CTA hooks")).toBe("marketer");

    // 3. Casual intent
    expect(detectScopeArchetype("Explain what this repository does simply in plain english")).toBe("casual");
    expect(detectScopeArchetype("ELI5: how does token knapsack budgeting work?")).toBe("casual");

    // 4. Developer intent (default)
    expect(detectScopeArchetype("Debug PostgreSQL connection pool timeout and write unit tests")).toBe("developer");
    expect(detectScopeArchetype("Build bun binary and verify TypeScript typecheck")).toBe("developer");
  });

  test("initUserProfile creates USER.md with selected archetype or local inheritance template", () => {
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

    // Local init creates inheritance template
    const localDir = temp();
    const localContent = initUserProfile(localDir, "developer", false, true);
    expect(localContent).toContain(LOCAL_USER_INHERIT_MARKER);
    expect(localContent).toContain("Inherits from global");

    rmSync(root, { recursive: true, force: true });
    rmSync(localDir, { recursive: true, force: true });
  });

  test("getUserProfile inherits global profile and appends local overrides", () => {
    const localDir = temp();

    // Initialize local with inheritance marker + custom local preferences
    setUserProfile(
      localDir,
      `# Local Project Profile\n${LOCAL_USER_INHERIT_MARKER}\n\n- Local Rule: Strict 100ms API timeout\n- Local Rule: Use SQLite in-memory for testing`
    );

    const resolved = getUserProfile(localDir);
    expect(resolved).toBeDefined();
    expect(resolved).toContain("Software Engineer / Developer");
    expect(resolved).toContain("Strict 100ms API timeout");
    expect(resolved).toContain("Use SQLite in-memory for testing");

    rmSync(localDir, { recursive: true, force: true });
  });

  test("getUserProfile dynamically activates designer, marketer, or developer persona based on query scope", () => {
    const localDir = temp();
    initUserProfile(localDir, "developer", true, true);

    // Design query activates designer persona
    const designProfile = getUserProfile(localDir, { query: "Style the dashboard cards with Tailwind CSS grid and subtle borders" });
    expect(designProfile).toContain("UI/UX Designer & Creative Technologist");
    expect(designProfile).toContain("WCAG");

    // Marketing query activates marketer persona
    const marketProfile = getUserProfile(localDir, { query: "Write high-converting landing page copy with punchy headline" });
    expect(marketProfile).toContain("Growth & Marketing Strategist");
    expect(marketProfile).toContain("calls-to-action");

    // Dev query activates developer persona
    const devProfile = getUserProfile(localDir, { query: "Refactor database query to use parameterized prepared statements" });
    expect(devProfile).toContain("Software Engineer / Developer");

    rmSync(localDir, { recursive: true, force: true });
  });

  test("setUserProfile intercepts and rejects secrets via Vibeguard scanner", () => {
    const root = temp();

    expect(() => {
      setUserProfile(root, "User prefers API key: sk-ant-api03-1234567890abcdef1234567890abcdef1234567890abcdef1234");
    }).toThrow(/Secret detected in USER\.md/);

    rmSync(root, { recursive: true, force: true });
  });
});
