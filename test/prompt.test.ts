import { describe, test, expect } from "bun:test";
import { promptMultiSelect, type SelectOption } from "../src/prompt.ts";

describe("interactive promptMultiSelect", () => {
  test("returns all options in non-interactive environment", async () => {
    const options: SelectOption[] = [
      { id: "claude-code", label: "Claude Code" },
      { id: "cursor", label: "Cursor" },
      { id: "hermes", label: "Hermes Agent" },
    ];

    // In automated bun test runner, stdin is not a TTY
    const selected = await promptMultiSelect("Select agents", options);
    expect(selected).toEqual(["claude-code", "cursor", "hermes"]);
  });

  test("handles empty options cleanly", async () => {
    const selected = await promptMultiSelect("Empty test", []);
    expect(selected).toEqual([]);
  });
});
