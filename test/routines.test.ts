import { describe, test, expect, afterEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadRoutines, runRoutine, crontabLine, routinesPath } from "../src/routines.ts";
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

describe("SOW-102b routines", () => {
  test("missing routines.yaml = zero routines", () => {
    const { memoryDir } = setup();
    expect(loadRoutines(memoryDir).routines).toEqual({});
  });

  test("loads and validates a well-formed file", () => {
    const { memoryDir } = setup(
      `routines:\n  morning:\n    schedule: "0 8 * * *"\n    run: ["brief", "nudge"]\n`,
    );
    const { routines } = loadRoutines(memoryDir);
    expect(routines.morning).toEqual({ schedule: "0 8 * * *", run: ["brief", "nudge"] });
  });

  test("throws on missing schedule or empty run", () => {
    const { memoryDir } = setup(`routines:\n  bad:\n    run: ["brief"]\n`);
    expect(() => loadRoutines(memoryDir)).toThrow(/missing schedule/);

    const { memoryDir: dir2 } = setup(`routines:\n  bad2:\n    schedule: "0 8 * * *"\n    run: []\n`);
    expect(() => loadRoutines(dir2)).toThrow(/non-empty array/);
  });

  test("crontabLine format", () => {
    expect(crontabLine("morning", { schedule: "0 8 * * *", run: ["brief"] })).toBe(
      "0 8 * * * memory routine run morning # musememory routine",
    );
  });

  test("runRoutine executes steps in order via injected executor", async () => {
    const { memoryDir } = setup(`routines:\n  daily:\n    schedule: "0 8 * * *"\n    run: ["brief", "nudge"]\n`);
    const calls: string[] = [];
    const code = await runRoutine(memoryDir, "daily", {
      exec: async (step) => {
        calls.push(step);
        return 0;
      },
    });
    expect(code).toBe(0);
    expect(calls).toEqual(["brief", "nudge"]);
  });

  test("runRoutine returns nonzero when any step fails but still runs the rest", async () => {
    const { memoryDir } = setup(`routines:\n  daily:\n    schedule: "0 8 * * *"\n    run: ["a", "b"]\n`);
    const calls: string[] = [];
    const code = await runRoutine(memoryDir, "daily", {
      exec: async (step) => {
        calls.push(step);
        return step === "a" ? 1 : 0;
      },
    });
    expect(code).toBe(1);
    expect(calls).toEqual(["a", "b"]);
  });

  test("runRoutine throws on unknown routine", async () => {
    const { memoryDir } = setup();
    await expect(runRoutine(memoryDir, "nope")).rejects.toThrow(/unknown routine/);
  });
});
