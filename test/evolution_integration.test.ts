import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { makeTempRoot, cleanup } from "./helpers.ts";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { main } from "../src/cli.ts";
import { openStore, propose, confirm } from "../src/store.ts";
import { createServer } from "../src/mcp.ts";

describe("Evolution Plan: CLI & MCP End-to-End Integration", () => {
  let root: string;
  let memoryDir: string;

  beforeEach(() => {
    root = makeTempRoot();
    memoryDir = join(root, ".memory");
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, "CURRENT.md"), "# Constraints\n- Invariant: Zero deps", "utf-8");
    writeFileSync(join(memoryDir, "USER.md"), "# Persona\nDeveloper", "utf-8");
  });

  afterEach(() => {
    cleanup(root);
  });

  describe("CLI Commands Integration", () => {
    test("memory source add & list CLI commands", async () => {
      let logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => logs.push(args.join(" "));

      try {
        const exitAdd = await main([
          "source",
          "add",
          "https://bun.sh/docs",
          "--title",
          "Bun Documentation",
          "--type",
          "documentation",
          "--dir",
          memoryDir,
        ]);
        expect(exitAdd).toBe(0);
        expect(logs.some((l) => l.includes("Recorded source"))).toBe(true);

        logs = [];
        const exitList = await main(["source", "list", "--dir", memoryDir]);
        expect(exitList).toBe(0);
        expect(logs.some((l) => l.includes("Bun Documentation"))).toBe(true);
      } finally {
        console.log = origLog;
      }
    });

    test("memory claim record & list CLI commands", async () => {
      let logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => logs.push(args.join(" "));

      try {
        const exitRec = await main([
          "claim",
          "record",
          "SQLite WAL mode improves concurrent writes",
          "--confidence",
          "RAW",
          "--dir",
          memoryDir,
        ]);
        expect(exitRec).toBe(0);
        expect(logs.some((l) => l.includes("Recorded claim"))).toBe(true);

        logs = [];
        const exitList = await main(["claim", "list", "--dir", memoryDir]);
        expect(exitList).toBe(0);
        expect(logs.some((l) => l.includes("[RAW]"))).toBe(true);
      } finally {
        console.log = origLog;
      }
    });

    test("memory context with --tier 0 and --tier 1 CLI flags", async () => {
      const store = openStore(memoryDir);
      const m1 = propose(store, {
        title: "Tiered Context Architecture",
        content: "Tier 0 is manifest, Tier 1 is routing set, Tier 2 is full bodies",
        project: "core",
        type: "architecture",
      });
      confirm(store, m1.id);

      let logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => logs.push(args.join(" "));

      try {
        const exitTier0 = await main(["context", "--tier", "0", "--dir", memoryDir]);
        expect(exitTier0).toBe(0);
        expect(logs.some((l) => l.includes("### Memory Manifest (Tier 0)"))).toBe(true);

        logs = [];
        const exitTier1 = await main(["context", "--tier", "1", "--dir", memoryDir]);
        expect(exitTier1).toBe(0);
        expect(logs.some((l) => l.includes("### Domain Routing Invariants (Tier 1)"))).toBe(true);
      } finally {
        console.log = origLog;
      }
    });

    test("memory freeze CLI command", async () => {
      let logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => logs.push(args.join(" "));

      try {
        const exitFreeze = await main([
          "freeze",
          "--task",
          "Run CI release build",
          "--run-id",
          "run_cli_1",
          "--dir",
          memoryDir,
        ]);
        expect(exitFreeze).toBe(0);
        expect(logs.some((l) => l.includes("Frozen execution snapshot"))).toBe(true);
      } finally {
        console.log = origLog;
      }
    });

    test("memory prompt list & show & run CLI commands", async () => {
      let logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => logs.push(args.join(" "));

      try {
        const exitList = await main(["prompt", "list", "--dir", memoryDir]);
        expect(exitList).toBe(0);
        expect(logs.some((l) => l.includes("morning-standup"))).toBe(true);

        logs = [];
        const exitRun = await main(["prompt", "run", "morning-standup", "--dir", memoryDir]);
        expect(exitRun).toBe(0);
        expect(logs.some((l) => l.includes("Morning Cognitive Standup"))).toBe(true);
      } finally {
        console.log = origLog;
      }
    });

    test("memory rollup CLI command", async () => {
      let logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => logs.push(args.join(" "));

      try {
        const exitRollup = await main([
          "rollup",
          "--period",
          "week",
          "--date",
          "2026-09-01",
          "--dir",
          memoryDir,
        ]);
        expect(exitRollup).toBe(0);
        expect(logs.some((l) => l.includes("Compiled weekly rollup"))).toBe(true);
      } finally {
        console.log = origLog;
      }
    });

    test("memory loop record & status CLI commands", async () => {
      let logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => logs.push(args.join(" "));

      try {
        const exitRec = await main([
          "loop",
          "record",
          "--index",
          "1",
          "--verdict",
          "pass",
          "--fix",
          "Clean refactor",
          "--tests",
          "100% pass",
          "--dir",
          memoryDir,
        ]);
        expect(exitRec).toBe(0);

        logs = [];
        const exitStat = await main(["loop", "status", "--dir", memoryDir]);
        expect(exitStat).toBe(0);
        expect(logs.some((l) => l.includes("Total iterations: 1"))).toBe(true);
      } finally {
        console.log = origLog;
      }
    });

    test("memory verify --strict CLI command", async () => {
      let logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => logs.push(args.join(" "));

      try {
        const exitStrict = await main(["verify", "--strict", "--dir", memoryDir]);
        expect(exitStrict).toBe(0);
        expect(logs.some((l) => l.includes("Strict Verification Passed"))).toBe(true);
      } finally {
        console.log = origLog;
      }
    });
  });

  describe("MCP Tools Integration", () => {
    test("MCP server exposes and executes evolution tools", async () => {
      const server = createServer(memoryDir);
      const listHandler = (server as any)._requestHandlers?.get("tools/list");
      expect(listHandler).toBeDefined();

      const toolsList = await listHandler({ method: "tools/list" });
      const toolNames = toolsList.tools.map((t: any) => t.name);

      expect(toolNames).toContain("memory_source_add");
      expect(toolNames).toContain("memory_source_list");
      expect(toolNames).toContain("memory_claim_record");
      expect(toolNames).toContain("memory_claim_list");
      expect(toolNames).toContain("memory_freeze_run");
      expect(toolNames).toContain("memory_prompt_list");
      expect(toolNames).toContain("memory_prompt_run");
      expect(toolNames).toContain("memory_rollup");
      expect(toolNames).toContain("memory_loop_record");
      expect(toolNames).toContain("memory_loop_status");
      expect(toolNames).toContain("memory_verify_strict");

      // Test executing a tool via call handler
      const callHandler = (server as any)._requestHandlers?.get("tools/call");
      expect(callHandler).toBeDefined();

      const sourceRes = await callHandler({
        method: "tools/call",
        params: {
          name: "memory_source_add",
          arguments: {
            url: "https://example.com/spec",
            title: "Evolution Spec",
            dir: memoryDir,
          },
        },
      });
      expect(sourceRes.isError).toBeFalsy();
      expect(sourceRes.content[0].text).toContain("Evolution Spec");
    });
  });
});
