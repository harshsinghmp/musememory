import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { makeTempRoot, cleanup } from "./helpers.ts";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  listPrompts,
  getPrompt,
  renderPrompt,
  savePrompt,
  BUILTIN_PROMPTS,
} from "../src/prompts.ts";

describe("Deliverable 4: Native Prompt Registry & Runner", () => {
  let root: string;
  let memoryDir: string;

  beforeEach(() => {
    root = makeTempRoot();
    memoryDir = join(root, ".memory");
    mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    cleanup(root);
  });

  test("listPrompts returns all 4 built-in standard prompts by default", () => {
    const prompts = listPrompts(memoryDir);
    const names = prompts.map((p) => p.name);

    expect(names).toContain("morning-standup");
    expect(names).toContain("drift-audit");
    expect(names).toContain("pre-publish-audit");
    expect(names).toContain("sprint-compounding");
  });

  test("getPrompt retrieves built-in prompt template and description", () => {
    const standup = getPrompt(memoryDir, "morning-standup");
    expect(standup).not.toBeNull();
    expect(standup?.name).toBe("morning-standup");
    expect(standup?.template).toContain("Standup");
  });

  test("savePrompt persists custom markdown prompt in .memory/prompts/<name>.md", () => {
    savePrompt(memoryDir, {
      name: "custom-review",
      title: "Custom Code Review",
      description: "Review diff for anti-patterns and performance bottlenecks",
      template: "Please review the following PR diff:\n{{diff}}\nFocus areas: {{focus}}",
      variables: ["diff", "focus"],
      tags: ["review", "qa"],
    });

    const prompts = listPrompts(memoryDir);
    expect(prompts.some((p) => p.name === "custom-review")).toBe(true);

    const custom = getPrompt(memoryDir, "custom-review");
    expect(custom?.title).toBe("Custom Code Review");
  });

  test("renderPrompt substitutes variables and dynamic context placeholders", () => {
    savePrompt(memoryDir, {
      name: "greeting",
      title: "Greeting Prompt",
      description: "Simple greeting",
      template: "Hello, {{name}}! Welcome to {{project}}.",
      variables: ["name", "project"],
    });

    const rendered = renderPrompt(memoryDir, "greeting", {
      name: "Harsh",
      project: "Muse Memory",
    });

    expect(rendered).toBe("Hello, Harsh! Welcome to Muse Memory.");
  });

  test("renderPrompt injects live context for morning-standup", () => {
    writeFileSync(
      join(memoryDir, "CURRENT.md"),
      "# Active Constraints\n- Strict TDD enforcement",
      "utf-8",
    );

    const rendered = renderPrompt(memoryDir, "morning-standup");
    expect(rendered).toContain("Active Constraints");
    expect(rendered).toContain("Strict TDD enforcement");
  });
});
