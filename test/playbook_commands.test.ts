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
          arguments: { dir, title: "Fix flaky test", goal: "make it deterministic", steps: [{ action: "reproduce" }], preconditions: ["repro"], verification: ["tests green"], rollback: ["git checkout"], tags: ["tests"] },
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

      const stepUpdate = await call({
        method: "tools/call",
        params: {
          name: "muse_playbook_record",
          arguments: {
            dir,
            id: "Fix flaky test",
            title: "Fix flaky test",
            goal: "make it deterministic",
            steps: [{ action: "reproduce" }, { action: "fix" }],
          },
        },
      });
      expect(stepUpdate.isError).toBeFalsy();
      expect(stepUpdate.content[0].text).toContain("## Verification");

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

  // D7: `--run` was a silent alias for show, so `--run <id>` appeared to
  // execute the trajectory and only printed it. It must refuse loudly rather
  // than imply execution it never performed.
  test("CLI refuses --run instead of silently showing the playbook", async () => {
    const dir = mkdtempSync(join(tmpdir(), "muse-playbook-run-"));
    const previous = process.cwd();
    try {
      const memoryDir = join(dir, ".memory");
      savePlaybook(memoryDir, { title: "Deploy", goal: "ship", steps: [{ action: "build" }] });
      process.chdir(dir);

      const errors: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => errors.push(args.join(" "));
      let runCode: number;
      try {
        runCode = await handlePlaybookCommand({ positional: [], flags: { run: "Deploy" } } as any);
      } finally {
        console.error = originalError;
      }

      // Non-zero, and it says why rather than printing the playbook.
      expect(runCode).toBe(2);
      expect(errors.join(" ")).toContain("not implemented");

      // The plain show path still works.
      expect(await handlePlaybookCommand({ positional: ["Deploy"], flags: {} } as any)).toBe(0);
    } finally {
      process.chdir(previous);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // D4: the tool has two modes, so MCP clients need to know each mode's
  // minimum. A flat `required` array would be wrong for one of them.
  test("muse_playbook_record advertises both mode contracts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "muse-playbook-schema-"));
    try {
      const server = createServer(dir, "full");
      const listHandler = (server as any)._requestHandlers.get("tools/list");
      expect(listHandler).toBeDefined();
      const response = await listHandler({ method: "tools/list", params: {} });
      const record = response.tools.find((t: any) => t.name === "muse_playbook_record");
      expect(record).toBeDefined();
      const anyOf = record.inputSchema.anyOf;
      expect(Array.isArray(anyOf)).toBe(true);
      expect(anyOf).toContainEqual({ required: ["id", "success"] });
      expect(anyOf).toContainEqual({ required: ["title", "goal", "steps"] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
