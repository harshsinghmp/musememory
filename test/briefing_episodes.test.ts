import { describe, test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.ts";
import { handleBriefingCommand } from "../src/cli/lifecycle.ts";

function observation(id: string, timestamp: string, source: string, summary: string, text: string) {
  return { id, timestamp, source, project: "demo", raw: text, summary, metadata: { session_id: "s1" }, processed: false };
}

describe("T-428: briefing surfaces recent episodes", () => {
  test("prints causal episodes built from observations", async () => {
    const root = mkdtempSync(join(tmpdir(), "muse-brief-episodes-"));
    const memoryDir = join(root, ".memory");
    mkdirSync(memoryDir, { recursive: true });
    const store = openStore(memoryDir);
    const lines = [
      observation("o1", "2026-01-01T10:00:00Z", "goal", "Goal: fix login", "auth breaks"),
      observation("o2", "2026-01-01T10:01:00Z", "verification", "tests green", "bun test passes"),
      observation("o3", "2026-01-01T10:02:00Z", "retrospective", "add regression", "lesson"),
    ];
    writeFileSync(join(memoryDir, "observations.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");

    const output: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => { output.push(args.map(String).join(" ")); };
    try {
      const code = await handleBriefingCommand({ positional: [], flags: { dir: root } } as any);
      expect(code).toBe(0);
    } finally {
      console.log = original;
      rmSync(root, { recursive: true, force: true });
    }
    const text = output.join("\n");
    expect(text).toContain("recent episodes:");
    expect(text).toContain("Goal: fix login");
  });
});
