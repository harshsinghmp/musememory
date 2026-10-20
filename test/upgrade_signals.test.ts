import { describe, test, expect } from "bun:test";
import { playPandaLoader, handleUpgradeCommand, type UpgradeStep } from "../src/cli/upgrade.ts";

describe("T-395: Upgrade failure signal and step error tracking", () => {
  test("playPandaLoader returns success=true and renders Complete! when all steps succeed", async () => {
    const outputLines: string[] = [];
    const mockStream = {
      write: (text: string) => {
        outputLines.push(text);
        return true;
      },
    };

    const steps: UpgradeStep[] = [
      {
        level: 1,
        title: "Step 1: Check Config",
        action: async () => {},
      },
      {
        level: 2,
        title: "Step 2: Sync Files",
        action: async () => {},
      },
    ];

    const result = await playPandaLoader(steps, {
      isTTY: false,
      stream: mockStream as any,
    });

    expect(result.success).toBe(true);
    expect(result.failedSteps.length).toBe(0);
    expect(outputLines.some((l) => l.includes("Complete!"))).toBe(true);
    expect(outputLines.some((l) => l.includes("[FAILED]"))).toBe(false);
  });

  test("playPandaLoader returns success=false and tracks failed steps when an action throws", async () => {
    const outputLines: string[] = [];
    const mockStream = {
      write: (text: string) => {
        outputLines.push(text);
        return true;
      },
    };

    const failingError = new Error("Disk quota exceeded");
    const steps: UpgradeStep[] = [
      {
        level: 1,
        title: "Failing Operation",
        action: async () => {
          throw failingError;
        },
      },
      {
        level: 2,
        title: "Subsequent Step",
        action: async () => {},
      },
    ];

    const result = await playPandaLoader(steps, {
      isTTY: false,
      stream: mockStream as any,
    });

    expect(result.success).toBe(false);
    expect(result.failedSteps.length).toBe(1);
    expect(result.failedSteps[0].step.title).toBe("Failing Operation");
    expect(result.failedSteps[0].error).toBe(failingError);

    // Verify output reflects failure
    expect(outputLines.some((l) => l.includes("[FAILED]"))).toBe(true);
    expect(outputLines.some((l) => l.includes("Completed with 1 error(s)"))).toBe(true);
    expect(outputLines.some((l) => l.includes("Complete!"))).toBe(false);
  });

  test("playPandaLoader handles TTY rendering for failed steps with failure glyph", async () => {
    const outputLines: string[] = [];
    const mockStream = {
      write: (text: string) => {
        outputLines.push(text);
        return true;
      },
      isTTY: true,
    };

    const steps: UpgradeStep[] = [
      {
        level: 1,
        title: "Step Failing TTY",
        action: async () => {
          throw new Error("TTY Error");
        },
      },
    ];

    const result = await playPandaLoader(steps, {
      isTTY: true,
      stream: mockStream as any,
    });

    expect(result.success).toBe(false);
    expect(outputLines.some((l) => l.includes("[FAILED]"))).toBe(true);
  });
});
