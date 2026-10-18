import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.ts";
import { recordAdr } from "../src/adrs/engine.ts";
import { buildPageIndex, assertBareFilename } from "../src/pageindex/engine.ts";

describe("T-364: Unique-ID Seam Collision Prevention", () => {
  let tmpDir: string;
  let memoryDir: string;
  let store: ReturnType<typeof openStore>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-id-seam-test-"));
    memoryDir = join(tmpDir, ".memory");
    store = openStore(memoryDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("produces 100% unique IDs for ADRs created in a tight loop", () => {
    const ids = new Set<string>();
    const count = 25;

    for (let i = 0; i < count; i++) {
      const adr = recordAdr(store, tmpDir, {
        project: "testproj",
        title: `Decision ${i}`,
        context_and_drivers: ["Need decision"],
        decision: `Adopt pattern ${i}`,
        consequences: { positive: ["Scalable"] },
      });
      expect(ids.has(adr.id)).toBe(false);
      ids.add(adr.id);
    }

    expect(ids.size).toBe(count);
  });

  it("produces 100% unique IDs for PageIndex documents built in a tight loop and passes assertBareFilename", () => {
    const ids = new Set<string>();
    const count = 25;

    for (let i = 0; i < count; i++) {
      const doc = buildPageIndex(`# Document ${i}\n\nContent for section ${i}`, {
        project: "testproj",
        title: "Same Title Document",
        memoryDir,
      });

      expect(ids.has(doc.id)).toBe(false);
      ids.add(doc.id);
      expect(() => assertBareFilename(doc.id)).not.toThrow();
    }

    expect(ids.size).toBe(count);
  });
});
