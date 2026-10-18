import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "../src/mcp.ts";

describe("T-398: memory_harvest schema and handler alignment", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-test-t398-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("declares all and auto boolean properties in memory_harvest inputSchema", async () => {
    const server = createServer(tmpDir, "full");
    const listHandler = (server as any)._requestHandlers.get("tools/list");
    expect(listHandler).toBeDefined();

    const result = await listHandler({ method: "tools/list", params: {} });
    const harvestTool = result.tools.find((t: any) => t.name === "memory_harvest");
    expect(harvestTool).toBeDefined();

    const props = harvestTool.inputSchema.properties;
    expect(props.all).toBeDefined();
    expect(props.all.type).toBe("boolean");
    expect(props.auto).toBeDefined();
    expect(props.auto.type).toBe("boolean");
    expect(props.text).toBeDefined();
    expect(props.project).toBeDefined();
  });

  test("rejects missing text when neither all nor auto is specified", async () => {
    const server = createServer(tmpDir, "full");
    const callHandler = (server as any)._requestHandlers.get("tools/call");
    expect(callHandler).toBeDefined();

    // Call without text or flags
    const resNoArgs = await callHandler({
      method: "tools/call",
      params: {
        name: "memory_harvest",
        arguments: {},
      },
    });

    expect(resNoArgs.isError).toBe(true);
    expect(resNoArgs.content[0].text).toContain("requires 'text' parameter");

    // Call with empty / whitespace text
    const resEmpty = await callHandler({
      method: "tools/call",
      params: {
        name: "memory_harvest",
        arguments: { text: "   " },
      },
    });

    expect(resEmpty.isError).toBe(true);
    expect(resEmpty.content[0].text).toContain("requires 'text' parameter");
  });

  test("harvests valid text successfully without requiring all or auto flags", async () => {
    const server = createServer(tmpDir, "full");
    const callHandler = (server as any)._requestHandlers.get("tools/call");

    const sampleText = `
Fix: Fixed bug in auth token refresh logic.
The refresh token expiration was not properly checked.
`;

    const res = await callHandler({
      method: "tools/call",
      params: {
        name: "memory_harvest",
        arguments: { text: sampleText, project: "test" },
      },
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.harvested_count).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(parsed.entries)).toBe(true);
  });

  test("accepts all=true flag without text to trigger transcript harvesting", async () => {
    const server = createServer(tmpDir, "full");
    const callHandler = (server as any)._requestHandlers.get("tools/call");

    const res = await callHandler({
      method: "tools/call",
      params: {
        name: "memory_harvest",
        arguments: { all: true, project: "test" },
      },
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed).toBeDefined();
  }, 15000);

  test("accepts auto=true flag without text to trigger transcript harvesting", async () => {
    const server = createServer(tmpDir, "full");
    const callHandler = (server as any)._requestHandlers.get("tools/call");

    const res = await callHandler({
      method: "tools/call",
      params: {
        name: "memory_harvest",
        arguments: { auto: true, project: "test" },
      },
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed).toBeDefined();
  }, 15000);
});
