import { describe, test, expect } from "bun:test";
import { promptMultiSelect, parseSelectionInput, type SelectOption } from "../src/prompt.ts";

describe("interactive promptMultiSelect and parseSelectionInput", () => {
  const options: SelectOption[] = [
    { id: "claude-code", label: "Claude Code" },
    { id: "cursor", label: "Cursor" },
    { id: "hermes", label: "Hermes Agent" },
    { id: "opencode", label: "OpenCode" },
    { id: "openclaw", label: "OpenClaw" },
  ];

  test("returns all options in non-interactive environment", async () => {
    const selected = await promptMultiSelect("Select agents", options);
    expect(selected).toEqual(["claude-code", "cursor", "hermes", "opencode", "openclaw"]);
  });

  test("handles empty options cleanly", async () => {
    const selected = await promptMultiSelect("Empty test", []);
    expect(selected).toEqual([]);
  });

  test("parseSelectionInput parses single numbers and comma lists", () => {
    expect(parseSelectionInput("1", options)).toEqual(["claude-code"]);
    expect(parseSelectionInput("1,3,5", options)).toEqual(["claude-code", "hermes", "openclaw"]);
    expect(parseSelectionInput("2 4", options)).toEqual(["cursor", "opencode"]);
  });

  test("parseSelectionInput parses number ranges", () => {
    expect(parseSelectionInput("1-3", options)).toEqual(["claude-code", "cursor", "hermes"]);
    expect(parseSelectionInput("2-4", options)).toEqual(["cursor", "hermes", "opencode"]);
  });

  test("parseSelectionInput parses direct names and aliases", () => {
    expect(parseSelectionInput("hermes", options)).toEqual(["hermes"]);
    expect(parseSelectionInput("claude, opencode", options)).toEqual(["claude-code", "opencode"]);
  });

  test("parseSelectionInput respects defaultAll on empty enter", () => {
    expect(parseSelectionInput("", options, true)).toEqual(["claude-code", "cursor", "hermes", "opencode", "openclaw"]);
    expect(parseSelectionInput("", options, false)).toEqual([]);
  });

  test("parseSelectionInput handles cancel commands (q, quit, exit)", () => {
    expect(parseSelectionInput("q", options)).toEqual([]);
    expect(parseSelectionInput("quit", options)).toEqual([]);
    expect(parseSelectionInput("exit", options)).toEqual([]);
  });

  test("parseSelectionInput handles 'all' and 'a'", () => {
    expect(parseSelectionInput("a", options)).toEqual(["claude-code", "cursor", "hermes", "opencode", "openclaw"]);
    expect(parseSelectionInput("all", options)).toEqual(["claude-code", "cursor", "hermes", "opencode", "openclaw"]);
  });
});
