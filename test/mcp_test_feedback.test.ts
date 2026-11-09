import { describe, test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, get } from "../src/store.ts";
import { recordNegativeLesson } from "../src/learning/index.ts";
import { createServer } from "../src/mcp.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "muse-mcp-test-feedback-"));
  const memoryDir = join(root, ".memory");
  mkdirSync(memoryDir, { recursive: true });
  const store = openStore(memoryDir);
  const server = createServer(root, "full");
  const call = (server as any)._requestHandlers.get("tools/call");
  const invoke = (name: string, args: Record<string, unknown>) =>
    call({ method: "tools/call", params: { name, arguments: { dir: root, ...args } } });
  return { root, memoryDir, store, invoke };
}

describe("T-440/T-441: MCP test-feedback and regression-sentry surfaces", () => {
  test("memory_test_feedback updates ROI and returns sentry matches", async () => {
    const { root, memoryDir, store, invoke } = fixture();
    try {
      const memory = propose(store, { content: "parse payloads defensively", project: "p", type: "fix", confirmed: true });
      recordNegativeLesson(store, {
        project: "p",
        title: "BUG_PRONE: unguarded JSON.parse",
        failed_approach: "JSON.parse on untrusted input",
        failure_reason: "throws on malformed payload",
        reproduction_command: "bun test src/parse.test.ts",
      });

      const result = await invoke("memory_test_feedback", {
        command: "bun test src/parse.test.ts",
        exit_code: 1,
        stdout: ["(fail) parse payload [1ms]", "error: SyntaxError", "", " 0 pass", " 1 fail"].join("\n"),
        memory_ids: [memory.id],
        project: "p",
        session_id: "s1",
      });
      expect(result.isError).toBeFalsy();
      const payload = JSON.parse(result.content[0].text);
      expect(payload.run.harness).toBe("bun");
      expect(payload.run.failed_count).toBe(1);
      expect(payload.feedback.updated[0].id).toBe(memory.id);
      expect(payload.sentry.matched.length).toBeGreaterThan(0);

      const after = get(store, memory.id);
      expect(after?.utility?.application_count).toBe(1);
      expect(after?.utility?.failed_applications).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("muse_regression_sentry accepts explicit failures and is read-only", async () => {
    const { root, store, invoke } = fixture();
    try {
      recordNegativeLesson(store, {
        project: "p",
        title: "DO NOT call the API without a timeout",
        failed_approach: "fetch without AbortSignal",
        failure_reason: "hangs the request",
        reproduction_command: "bun test src/api.test.ts",
      });

      const result = await invoke("muse_regression_sentry", {
        command: "bun test src/api.test.ts",
        failures: [{ name: "times out", message: "no AbortSignal in src/api.test.ts" }],
        project: "p",
      });
      expect(result.isError).toBeFalsy();
      const report = JSON.parse(result.content[0].text);
      expect(report.matched).toHaveLength(1);
      expect(report.matched[0].kind).toBe("DO_NOT_USE");
      expect(report.notice).toContain("read-only");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("memory_test_feedback validates required arguments", async () => {
    const { root, invoke } = fixture();
    try {
      const missingCommand = await invoke("memory_test_feedback", { exit_code: 0 });
      expect(missingCommand.isError).toBe(true);
      const missingCode = await invoke("memory_test_feedback", { command: "bun test" });
      expect(missingCode.isError).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
