import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../src/mcp.ts";
import { handlePlaybookCommand } from "../src/cli/playbook.ts";
import { savePlaybook } from "../src/cognition/playbooks.ts";

function callHandler(dir: string) {
  const server = createServer(dir, "full");
  return (server as any)._requestHandlers.get("tools/call");
}

describe("T-431: playbook CLI and MCP commands", () => {
  test("MCP records, recalls and updates a playbook", async () => {
    const dir = mkdtempSync(join(tmpdir(), "muse-playbook-mcp-"));
    try {
      const call = callHandler(dir);
      const recorded = await call({
        method: "tools/call",
        params: {
          name: "muse_playbook_record",
          arguments: { dir, title: "Fix flaky test", goal: "make it deterministic", steps: [{ action: "reproduce" }], tags: ["tests"] },
        },
      });
      expect(recorded.isError).toBeFalsy();
      expect(recorded.content[0].text).toContain("# Fix flaky test");

      const recalled = await call({
        method: "tools/call",
        params: { name: "muse_playbook_recall", arguments: { dir, tag: "tests" } },
      });
      expect(recalled.isError).toBeFalsy();
      expect(recalled.content[0].text).toContain("Fix flaky test");

      const outcome = await call({
        method: "tools/call",
        params: { name: "muse_playbook_record", arguments: { dir, id: "Fix flaky test", success: true } },
      });
      expect(outcome.isError).toBeFalsy();
      expect(outcome.content[0].text).toContain("1 success");

      const missing = await call({
        method: "tools/call",
        params: { name: "muse_playbook_recall", arguments: { dir, id: "nope" } },
      });
      expect(missing.isError).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("CLI lists and shows a recorded playbook", async () => {
    const dir = mkdtempSync(join(tmpdir(), "muse-playbook-cli-"));
    const previous = process.cwd();
    try {
      const { memoryDir } = { memoryDir: join(dir, ".memory") };
      savePlaybook(memoryDir, { title: "Deploy", goal: "ship", steps: [{ action: "build" }], tags: ["ops"] });
      process.chdir(dir);
      const listCode = await handlePlaybookCommand({ positional: [], flags: { list: "true" } } as any);
      expect(listCode).toBe(0);
      const showCode = await handlePlaybookCommand({ positional: ["Deploy"], flags: {} } as any);
      expect(showCode).toBe(0);
      const missingCode = await handlePlaybookCommand({ positional: ["nope"], flags: {} } as any);
      expect(missingCode).toBe(1);
    } finally {
      process.chdir(previous);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
