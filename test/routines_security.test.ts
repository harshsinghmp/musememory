import { describe, test, expect, afterEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadRoutines, runRoutine, routinesPath, ROUTINE_STEP_ALLOWLIST } from "../src/routines.ts";
import { makeTempRoot, cleanup } from "./helpers.ts";

let roots: string[] = [];
afterEach(() => {
  for (const r of roots) cleanup(r);
  roots = [];
});

function setup(routinesYaml?: string) {
  const root = makeTempRoot();
  roots.push(root);
  const memoryDir = join(root, ".memory");
  mkdirSync(memoryDir, { recursive: true });
  if (routinesYaml !== undefined) {
    writeFileSync(routinesPath(memoryDir), routinesYaml, "utf8");
  }
  return { root, memoryDir };
}

describe("Wave 5 - Task 4: Memory Routine Step Allowlist & Re-entrancy Guard (T-399)", () => {
  describe("Step allowlist enforcement ({brief, nudge, recall, compact, distill, verify})", () => {
    test("accepts all permitted routine steps", () => {
      const allowed = Array.from(ROUTINE_STEP_ALLOWLIST);
      const yaml = `routines:\n  all_valid:\n    schedule: "0 8 * * *"\n    run: ${JSON.stringify(allowed)}\n`;
      const { memoryDir } = setup(yaml);
      const { routines } = loadRoutines(memoryDir);
      expect(routines.all_valid.run).toEqual(allowed);
    });

    test("rejects dangerous or unlisted steps (e.g., upgrade, connect, hooks, arbitrary executables)", () => {
      const hostileYaml = `routines:\n  backdoor:\n    schedule: "0 8 * * *"\n    run: ["brief", "upgrade"]\n`;
      const { memoryDir } = setup(hostileYaml);
      expect(() => loadRoutines(memoryDir)).toThrow(/step 'upgrade' is not permitted/i);

      const hostileYaml2 = `routines:\n  backdoor2:\n    schedule: "0 8 * * *"\n    run: ["connect"]\n`;
      const { memoryDir: dir2 } = setup(hostileYaml2);
      expect(() => loadRoutines(dir2)).toThrow(/step 'connect' is not permitted/i);
    });
  });

  describe("Flag and option token rejection (no '-' prefixed tokens)", () => {
    test("rejects steps with options or flags to prevent argument injection", () => {
      const yamlWithFlags = `routines:\n  flagged:\n    schedule: "0 8 * * *"\n    run: ["brief --all"]\n`;
      const { memoryDir } = setup(yamlWithFlags);
      expect(() => loadRoutines(memoryDir)).toThrow(/flags and options are not permitted/i);

      const yamlWithShortFlag = `routines:\n  short_flag:\n    schedule: "0 8 * * *"\n    run: ["verify -e"]\n`;
      const { memoryDir: dir2 } = setup(yamlWithShortFlag);
      expect(() => loadRoutines(dir2)).toThrow(/flags and options are not permitted/i);
    });
  });

  describe("Re-entrancy recursion guard (depth > 5)", () => {
    test("permits routine execution within normal depth (<= 5)", async () => {
      const { memoryDir } = setup(`routines:\n  daily:\n    schedule: "0 8 * * *"\n    run: ["brief", "verify"]\n`);
      const executed: string[] = [];
      const code = await runRoutine(memoryDir, "daily", {
        depth: 2,
        exec: async (s) => {
          executed.push(s);
          return 0;
        },
      });
      expect(code).toBe(0);
      expect(executed).toEqual(["brief", "verify"]);
    });

    test("throws when re-entrancy depth exceeds limit (> 5)", async () => {
      const { memoryDir } = setup(`routines:\n  recursive:\n    schedule: "0 8 * * *"\n    run: ["brief"]\n`);
      await expect(
        runRoutine(memoryDir, "recursive", {
          depth: 5, // Next recursive invocation will be depth 6 -> throws
          exec: async () => 0,
        }),
      ).rejects.toThrow(/re-entrancy limit exceeded: depth > 5/i);
    });
  });
});
