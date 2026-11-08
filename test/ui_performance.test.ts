import { describe, test, expect } from "bun:test";
import { openStore } from "../src/store.ts";
import { startUiServer } from "../src/ui.ts";
import { cleanup, setupFixtureRoot } from "./helpers.ts";

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

describe("T-468: UI performance benchmark", () => {
  test("cached projections stay sub-10ms and the client is idle-safe", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const srv = await startUiServer({ port: 0, memoryDir, store });
    try {
      const base = `http://localhost:${srv.port}`;

      await fetch(`${base}/api/memories`);
      const memorySamples: number[] = [];
      for (let i = 0; i < 25; i++) {
        const start = performance.now();
        const res = await fetch(`${base}/api/memories`);
        expect(res.headers.get("x-cache")).toBe("HIT");
        await res.text();
        memorySamples.push(performance.now() - start);
      }
      expect(median(memorySamples)).toBeLessThan(10);

      await fetch(`${base}/api/stats`);
      const statsSamples: number[] = [];
      for (let i = 0; i < 25; i++) {
        const start = performance.now();
        const res = await fetch(`${base}/api/stats`);
        expect(res.headers.get("x-cache")).toBe("HIT");
        await res.text();
        statsSamples.push(performance.now() - start);
      }
      expect(median(statsSamples)).toBeLessThan(10);

      // Client-side idle guarantees: energy-gated loop, no polling timers.
      const js = await (await fetch(`${base}/assets/studio.js`)).text();
      expect(js).toContain("graphEnergy < SETTLE_ENERGY");
      expect(js).toContain("visibilitychange");
      expect(js).not.toContain("setInterval");
    } finally {
      srv.close();
      cleanup(root);
    }
  });
});
