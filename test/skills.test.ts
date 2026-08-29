import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

describe("Agent Skills Validation (.agents/skills/)", () => {
  const skillsDir = join(process.cwd(), ".agents", "skills");
  const expectedSkills = [
    "muse-ground",
    "muse-capture",
    "muse-current",
    "muse-graph",
    "muse-wiki",
    "muse-brief",
  ];

  it("contains all 6 expected agent skill directories", () => {
    expect(existsSync(skillsDir)).toBe(true);
    const subdirs = readdirSync(skillsDir);
    for (const expected of expectedSkills) {
      expect(subdirs).toContain(expected);
      const skillMd = join(skillsDir, expected, "SKILL.md");
      expect(existsSync(skillMd)).toBe(true);
    }
  });

  it("each SKILL.md contains valid YAML frontmatter and documentation sections", () => {
    for (const skillName of expectedSkills) {
      const skillPath = join(skillsDir, skillName, "SKILL.md");
      const content = readFileSync(skillPath, "utf8");

      // Verify YAML frontmatter
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      expect(match).not.toBeNull();
      const frontmatter = yaml.load(match![1]) as Record<string, any>;

      expect(frontmatter.name).toBe(skillName);
      expect(typeof frontmatter.description).toBe("string");
      expect(frontmatter.description.length).toBeGreaterThan(10);

      // Verify documentation sections
      expect(content).toContain("## 🚀 Execution Workflow");
      expect(content).toContain("## 💻 CLI Equivalents");
    }
  });
});
