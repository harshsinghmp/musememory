import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { openStore, propose, get, closeStore } from "../src/store.ts";
import type { Store } from "../src/store.ts";
import {
  stripInjectedContextBlocks,
  containsInjectedContextBlocks,
} from "../src/security/strip.ts";
import { extractHarvestUnits } from "../src/harvest.ts";
import { harvestSessionMemories } from "../src/compaction/harvester.ts";

describe("T-110: <memory-context>/injected-block strip before capture", () => {
  it("strips <memory-context> and preserves real conversation content", () => {
    const raw = `
Here is the context provided for your turn:
<memory-context>
# 🧠 Muse Memory Context Pack
### Old Memory
Ignore this prior injection
</memory-context>

Decision: We decided to enforce strict SQLite foreign keys on all tables.
`;
    const cleaned = stripInjectedContextBlocks(raw);
    expect(cleaned).not.toContain("<memory-context>");
    expect(cleaned).not.toContain("Ignore this prior injection");
    expect(cleaned).toContain("Decision: We decided to enforce strict SQLite foreign keys on all tables.");
  });

  it("strips <muse-memory>, <context-pack>, and comment blocks", () => {
    const raw = `
<muse-memory>
Recalled context pack
</muse-memory>
<!-- memory-context -->
HTML comment wrapped injection
<!-- /memory-context -->
Fix: Patched race condition in connection pooling by acquiring mutex before query.
`;
    const cleaned = stripInjectedContextBlocks(raw);
    expect(cleaned).not.toContain("Recalled context pack");
    expect(cleaned).not.toContain("HTML comment wrapped injection");
    expect(cleaned).toContain("Fix: Patched race condition in connection pooling by acquiring mutex before query.");
  });

  it("strips markdown context pack headers and base64 payloads", () => {
    const b64 = "A".repeat(120);
    const raw = `
# 🧠 Muse Memory Context Pack
> Budget: 500/4000 tokens used
- [m_1] Old memory (included)

Outcome: Successfully verified migration script on staging database.
Embedded image: data:image/png;base64,${b64}
`;
    const cleaned = stripInjectedContextBlocks(raw);
    expect(cleaned).not.toContain("# 🧠 Muse Memory Context Pack");
    expect(cleaned).not.toContain("Budget: 500/4000");
    expect(cleaned).toContain("[base64-payload-stripped]");
    expect(cleaned).toContain("Outcome: Successfully verified migration script on staging database.");
  });

  it("detects injected context blocks via containsInjectedContextBlocks", () => {
    expect(containsInjectedContextBlocks("<memory-context>data</memory-context>")).toBe(true);
    expect(containsInjectedContextBlocks("# 🧠 Muse Memory Context Pack\ncontent")).toBe(true);
    expect(containsInjectedContextBlocks("data:image/png;base64," + "B".repeat(60))).toBe(true);
    expect(containsInjectedContextBlocks("Normal technical statement without any injection")).toBe(false);
  });

  describe("harvester integration", () => {
    it("extractHarvestUnits ignores decisions and fixes inside <memory-context>", () => {
      const conversation = `
<memory-context>
Decision: Injected decision that must NOT be harvested
Fix: Injected fix that must NOT be harvested
</memory-context>

Decision: Real architectural decision agreed by the engineering team today.
`;
      const units = extractHarvestUnits(conversation);
      expect(units.length).toBe(1);
      expect(units[0].title).toContain("Real architectural decision");
      expect(units.some((u) => u.title.includes("Injected"))).toBe(false);
    });

    it("harvestSessionMemories strips injected blocks before negative lesson extraction", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-strip-harvest-"));
      const memoryDir = path.join(tmpDir, ".memory");
      fs.mkdirSync(memoryDir, { recursive: true });
      const store = openStore(memoryDir);

      try {
        const text = `
<memory-context>
avoid: injected negative pattern from previous session
anti-pattern: do not use raw sql
</memory-context>

avoid: running migrations in production without backup snapshot
`;
        const harvested = harvestSessionMemories(store, text, { project: "test-proj" });
        expect(harvested.length).toBe(1);
        expect(harvested[0].content).toContain("running migrations in production");
        expect(harvested.some((h) => h.content.includes("injected negative"))).toBe(false);
      } finally {
        closeStore(store);
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("store.propose integration", () => {
    let tmpDir: string;
    let store: Store;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-strip-propose-"));
      const memoryDir = path.join(tmpDir, ".memory");
      fs.mkdirSync(memoryDir, { recursive: true });
      store = openStore(memoryDir);
    });

    afterEach(() => {
      try {
        closeStore(store);
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    });

    it("propose strips injected context blocks from saved memory content", () => {
      const entry = propose(store, {
        project: "test-proj",
        content: `
<memory-context>
Prior injected context that should not be stored
</memory-context>

We standardized on Zod v4 schemas for API parameter parsing across all handlers.
`,
        type: "decision",
        confirmed: true,
      });

      expect(entry.content).not.toContain("<memory-context>");
      expect(entry.content).not.toContain("Prior injected context");
      expect(entry.content).toContain("standardized on Zod v4 schemas");

      // Verify stored content
      const stored = get(store, entry.id);
      expect(stored?.content).toBe(entry.content);
    });

    it("propose throws error when content consists entirely of injected context blocks", () => {
      expect(() => {
        propose(store, {
          project: "test-proj",
          content: "<memory-context>All injected text with no actual content</memory-context>",
          type: "discovery",
        });
      }).toThrow(/Cannot propose memory entry consisting entirely of injected context blocks/);
    });
  });
});
