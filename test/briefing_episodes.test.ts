import { describe, test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.ts";
import { handleBriefingCommand } from "../src/cli/lifecycle.ts";
import { createServer } from "../src/mcp.ts";

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
      observation("o1", "2026-01-01T10:00:00Z", "manual", "Goal: fix login", "auth breaks"),
      observation("o2", "2026-01-01T10:01:00Z", "test", "verification: tests green", "bun test passes"),
      observation("o3", "2026-01-01T10:02:00Z", "manual", "Retrospective: add regression", "lesson"),
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

  test("muse_episodes returns the same narratives over MCP", async () => {
    const root = mkdtempSync(join(tmpdir(), "muse-mcp-episodes-"));
    const memoryDir = join(root, ".memory");
    mkdirSync(memoryDir, { recursive: true });
    openStore(memoryDir);
    const lines = [
      observation("o1", "2026-01-01T10:00:00Z", "manual", "Goal: fix login", "auth breaks"),
      observation("o2", "2026-01-01T10:01:00Z", "test", "verification: tests green", "bun test passes"),
    ];
    writeFileSync(join(memoryDir, "observations.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
    try {
      const server = createServer(root, "full");
      const call = (server as any)._requestHandlers.get("tools/call");
      const result = await call({
        method: "tools/call",
        params: { name: "muse_episodes", arguments: { dir: root, limit: 5 } },
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Goal: fix login");
      expect(result.content[0].text).toContain("verification: tests green");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
