import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateSettings, getSettings, setSettings } from "../src/settings/index.ts";
import { openStore } from "../src/store.ts";
import { importSnapshot } from "../src/snapshot.ts";
import { createServer } from "../src/mcp.ts";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

describe("T-394: Enforce decorative settings mcp.enabledTools and imports.secretScanEnabled", () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-test-t394-"));
    memoryDir = join(tmpDir, ".memory");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("validateSettings enforces mcp.enabledTools array and imports.secretScanEnabled boolean", () => {
    // Valid cases
    const valid = validateSettings({
      mcp: { enabledTools: ["memory_read", "search"] } as any,
      imports: { secretScanEnabled: false } as any,
    });
    expect(valid.valid).toBe(true);

    // Invalid mcp.enabledTools
    const invalidTools = validateSettings({
      mcp: { enabledTools: "not-an-array" } as any,
    });
    expect(invalidTools.valid).toBe(false);
    expect(invalidTools.errors.some((e) => e.includes("mcp.enabledTools"))).toBe(true);

    // Invalid imports.secretScanEnabled
    const invalidScan = validateSettings({
      imports: { secretScanEnabled: "yes" } as any,
    });
    expect(invalidScan.valid).toBe(false);
    expect(invalidScan.errors.some((e) => e.includes("imports.secretScanEnabled"))).toBe(true);
  });

  test("importSnapshot respects imports.secretScanEnabled setting and options override", () => {
    const store = openStore(memoryDir);

    const snapshotWithSecret = {
      entries: [
        {
          id: "m_1234567890_secret",
          type: "session",
          title: "Leaked Token",
          content: "Here is the key: sk-ant-api03-1234567890123456789012345678901234567890-test_token_secret",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          project: "test",
          source: "manual",
          tags: ["test"],
          status: "confirmed",
        } as any,
      ],
    };

    // By default, secret scanning is enabled -> import fails
    const resultDefault = importSnapshot(store, snapshotWithSecret);
    expect(resultDefault.imported).toBe(0);
    expect(resultDefault.errors.length).toBeGreaterThan(0);
    expect(resultDefault.errors[0]).toContain("Secret detected");

    // Setting imports.secretScanEnabled = false in settings
    setSettings(memoryDir, {
      imports: {
        allowedProviders: ["agentmemory"],
        secretScanEnabled: false,
        overwriteByDefault: false,
        dryRunByDefault: false,
      },
    });

    const resultDisabled = importSnapshot(store, snapshotWithSecret);
    expect(resultDisabled.imported).toBe(1);
    expect(resultDisabled.errors.length).toBe(0);

    // Options override can re-enable scanning
    const resultOverridden = importSnapshot(store, snapshotWithSecret, {
      secretScanEnabled: true,
      overwrite: true,
    });
    expect(resultOverridden.imported).toBe(0);
    expect(resultOverridden.errors.length).toBeGreaterThan(0);
    expect(resultOverridden.errors[0]).toContain("Secret detected");
  });

  test("mcp server filters tools by mcp.enabledTools allowlist in ListToolsRequest", async () => {
    // Write settings restricting tools to only memory_read and search
    setSettings(memoryDir, {
      mcp: {
        enabledTools: ["memory_read", "search"],
        pageindexEnabled: true,
        autoConnectAgents: false,
        defaultProject: "default",
        permissionsAutoApprove: false,
      },
    });

    const cwdOrig = process.cwd();
    process.chdir(tmpDir);

    try {
      const server = createServer(tmpDir, "full");
      const listHandler = (server as any)._requestHandlers.get("tools/list");
      expect(listHandler).toBeDefined();

      const result = await listHandler({ method: "tools/list", params: {} });
      const toolNames = result.tools.map((t: any) => t.name);

      expect(toolNames).toContain("memory_read");
      expect(toolNames).toContain("search");
      expect(toolNames).not.toContain("memory_capture");
      expect(toolNames).not.toContain("memory_delete");
    } finally {
      process.chdir(cwdOrig);
    }
  });

  test("mcp server rejects CallToolRequest for tools disabled in mcp.enabledTools", async () => {
    // Write settings restricting tools to only memory_read
    setSettings(memoryDir, {
      mcp: {
        enabledTools: ["memory_read"],
        pageindexEnabled: true,
        autoConnectAgents: false,
        defaultProject: "default",
        permissionsAutoApprove: false,
      },
    });

    const cwdOrig = process.cwd();
    process.chdir(tmpDir);

    try {
      const server = createServer(tmpDir, "full");
      const callHandler = (server as any)._requestHandlers.get("tools/call");
      expect(callHandler).toBeDefined();

      // Calling memory_capture (disabled) should return toolError
      const resDisabled = await callHandler({
        method: "tools/call",
        params: {
          name: "memory_capture",
          arguments: { text: "Some memory", type: "discovery" },
        },
      });

      expect(resDisabled.isError).toBe(true);
      expect(resDisabled.content[0].text).toContain("disabled by mcp.enabledTools");

      // Calling memory_read (enabled) should not be rejected by allowlist
      const resEnabled = await callHandler({
        method: "tools/call",
        params: {
          name: "memory_read",
          arguments: { id: "nonexistent_id" },
        },
      });

      // Even if entry not found, it wasn't rejected by allowlist
      expect(resEnabled.content[0].text).not.toContain("disabled by mcp.enabledTools");
    } finally {
      process.chdir(cwdOrig);
    }
  });
});
