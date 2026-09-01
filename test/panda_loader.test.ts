import { describe, it, expect, mock } from "bun:test";
import {
  formatPandaProgressBar,
  playPandaLoader,
  playGamifiedLoader,
  type UpgradeStep,
  type PandaLoaderOptions,
} from "../src/cli/upgrade.ts";

describe("Dynamic ASCII Panda Single-Line Loader", () => {
  describe("formatPandaProgressBar", () => {
    it("renders dynamic single-line panda moving towards 100%", () => {
      const bar0 = formatPandaProgressBar(0, 20);
      expect(bar0).toBe("[ʕ•ᴥ•ʔ────────────────────] 0%");

      const bar50 = formatPandaProgressBar(50, 20);
      expect(bar50).toBe("[━━━━━━━━━━ʕ•ᴥ•ʔ──────────] 50%");

      const bar100 = formatPandaProgressBar(100, 20);
      expect(bar100).toBe("[━━━━━━━━━━━━━━━━━━━━ʕ•ᴥ•ʔ] 100%");
    });

    it("clamps percentages below 0 and above 100", () => {
      const barNeg = formatPandaProgressBar(-25, 10);
      expect(barNeg).toBe("[ʕ•ᴥ•ʔ──────────] 0%");

      const barOver = formatPandaProgressBar(135, 10);
      expect(barOver).toBe("[━━━━━━━━━━ʕ•ᴥ•ʔ] 100%");
    });

    it("supports custom panda characters, trail, and track characters", () => {
      const customBar = formatPandaProgressBar(50, 10, {
        panda: "(•(ｪ)•)",
        trailChar: "=",
        trackChar: ".",
      });
      expect(customBar).toBe("[=====(•(ｪ)•).....] 50%");

      const emojiBar = formatPandaProgressBar(30, 10, {
        panda: "🐼",
        trailChar: "━",
        trackChar: "─",
      });
      expect(emojiBar).toBe("[━━━🐼───────] 30%");
    });

    it("supports end target goal (e.g. bamboo 🎋)", () => {
      const withTarget = formatPandaProgressBar(40, 10, {
        target: "🎋",
      });
      expect(withTarget).toBe("[━━━━ʕ•ᴥ•ʔ──────🎋] 40%");

      const atGoal = formatPandaProgressBar(100, 10, {
        target: "🎋",
      });
      expect(atGoal).toBe("[━━━━━━━━━━ʕ•ᴥ•ʔ🎋] 100%");
    });

    it("supports frame-based animation cycling for panda walking", () => {
      const frames = ["ʕ•ᴥ•ʔ", "ʕ •ᴥ•ʔ", "ʕ-ᴥ-ʔ"];
      const frame0 = formatPandaProgressBar(50, 10, { panda: frames, frame: 0 });
      const frame1 = formatPandaProgressBar(50, 10, { panda: frames, frame: 1 });
      const frame2 = formatPandaProgressBar(50, 10, { panda: frames, frame: 2 });
      const frame3 = formatPandaProgressBar(50, 10, { panda: frames, frame: 3 });

      expect(frame0).toBe("[━━━━━ʕ•ᴥ•ʔ─────] 50%");
      expect(frame1).toBe("[━━━━━ʕ •ᴥ•ʔ─────] 50%");
      expect(frame2).toBe("[━━━━━ʕ-ᴥ-ʔ─────] 50%");
      expect(frame3).toBe("[━━━━━ʕ•ᴥ•ʔ─────] 50%"); // cycles back to frame 0
    });
  });

  describe("playPandaLoader dynamic runner", () => {
    it("executes all steps sequentially on a single line and completes", async () => {
      const executed: number[] = [];
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
          title: "Pre-Flight Check",
          action: async () => {
            executed.push(1);
          },
        },
        {
          level: 2,
          title: "Synaptic Alignment",
          action: async () => {
            executed.push(2);
          },
        },
        {
          level: 3,
          title: "Final Completion",
          action: async () => {
            executed.push(3);
          },
        },
      ];

      await playPandaLoader(steps, {
        title: "PANDA LOADER TEST",
        isTTY: false,
        stream: mockStream as any,
      });

      expect(executed).toEqual([1, 2, 3]);
      expect(outputLines.some((line) => line.includes("100%"))).toBe(true);
      expect(outputLines.some((line) => line.includes("ʕ•ᴥ•ʔ"))).toBe(true);
    });

    it("handles errors in steps gracefully without terminating the loader prematurely", async () => {
      const errorsCaught: string[] = [];
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
          title: "Failing Step",
          action: async () => {
            throw new Error("Network timeout simulation");
          },
        },
        {
          level: 2,
          title: "Succeeding Step",
          action: async () => {
            errorsCaught.push("step2_ran");
          },
        },
      ];

      await playPandaLoader(steps, {
        isTTY: false,
        stream: mockStream as any,
      });

      expect(errorsCaught).toEqual(["step2_ran"]);
      expect(outputLines.some((l) => l.includes("Network timeout simulation"))).toBe(true);
    });

    it("aliases playGamifiedLoader to playPandaLoader seamlessly", async () => {
      let ran = false;
      const steps: UpgradeStep[] = [
        {
          level: 1,
          title: "Step 1",
          action: () => {
            ran = true;
          },
        },
      ];

      const mockStream = { write: () => true };
      await playGamifiedLoader(steps, { isTTY: false, stream: mockStream as any });
      expect(ran).toBe(true);
    });
  });
});
