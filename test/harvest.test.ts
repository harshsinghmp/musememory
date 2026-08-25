import { describe, test, expect } from "bun:test";
import { openStore, propose, get, list } from "../src/store.ts";
import { extractHarvestUnits, defaultSalienceForType } from "../src/harvest.ts";
import { exportSnapshot, importSnapshot } from "../src/snapshot.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";

describe("harvest & agency network sync", () => {
  test("extractHarvestUnits filters outcomes, decisions, and fixes", () => {
    const rawConversation = `
User: We tried using a single thread but it crashed under load.
Assistant: I looked at the issue.
Fix: Increased worker thread pool size from 1 to 8 in backend configuration.
Decision: Use Redis pub/sub for real-time notification broadcast instead of polling.
Constraint: All database writes must complete within 200ms timeout.
`;
    const units = extractHarvestUnits(rawConversation);
    expect(units.length).toBe(3);

    const fixUnit = units.find((u) => u.type === "fix");
    expect(fixUnit).toBeDefined();
    expect(fixUnit!.salience).toBe(defaultSalienceForType("fix"));
    expect(fixUnit!.content).toContain("Increased worker thread pool size");

    const decisionUnit = units.find((u) => u.type === "decision");
    expect(decisionUnit).toBeDefined();
    expect(decisionUnit!.content).toContain("Use Redis pub/sub");

    const constraintUnit = units.find((u) => u.type === "constraint");
    expect(constraintUnit).toBeDefined();
    expect(constraintUnit!.salience).toBe(0.95);
  });

  test("extractHarvestUnits handles CRLF Windows line endings", () => {
    const rawConversation = "Fix: Patched socket timeout\r\nDecision: Keep keep-alive true\r\n";
    const units = extractHarvestUnits(rawConversation);
    expect(units.length).toBe(2);
    expect(units[0].title).toBe("Patched socket timeout");
    expect(units[1].title).toBe("Keep keep-alive true");
  });

  test("extractHarvestUnits handles bold bullets, varied headings, and conversational turn boundaries", () => {
    const rawConversation = `
User: What was the bug?
Assistant: Here is the summary:
- **Fix:** Switched database connection pool to max 20 connections
* **Decision:** Deprecated v1 auth endpoint
#### Architecture: Multi-tenant tenant schema isolation
User: Thanks, that helps a lot!
Assistant: You are welcome!
`;
    const units = extractHarvestUnits(rawConversation);
    expect(units.length).toBe(3);
    expect(units[0].title).toBe("Switched database connection pool to max 20 connections");
    expect(units[0].type).toBe("fix");
    expect(units[0].content).toBe("Switched database connection pool to max 20 connections");
    // Ensure subsequent chat dialogue ("Thanks, that helps a lot!") was not swallowed into architecture unit
    expect(units[2].title).toBe("Multi-tenant tenant schema isolation");
    expect(units[2].content).toBe("Multi-tenant tenant schema isolation");
  });

  test("importSnapshot detects secrets and rejects unsafe entries", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const snapshot = {
      entries: [
        {
          id: "m_1700000000001_safe",
          title: "Safe memory",
          content: "Clean content",
          project: "aria",
          status: "confirmed" as const,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          source: "manual",
          tags: ["clean"],
        },
        {
          id: "m_1700000000002_leaked",
          title: "Leaked key",
          content: "sk-proj-12345678901234567890123456",
          project: "aria",
          status: "confirmed" as const,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          source: "manual",
          tags: ["secret"],
        },
      ],
    };

    const res = importSnapshot(store, snapshot);
    expect(res.imported).toBe(1);
    expect(res.errors.length).toBe(1);
    expect(res.errors[0]).toContain("Secret detected");
    expect(get(store, "m_1700000000001_safe")).toBeDefined();
    expect(get(store, "m_1700000000002_leaked")).toBeNull();

    cleanup(root);
  });

  test("exportSnapshot and importSnapshot roundtrip", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const initialCount = list(store).length;
    const snapshot = exportSnapshot(store);
    expect(snapshot.total).toBe(initialCount);
    expect(snapshot.entries.length).toBe(initialCount);

    const targetDir = `${memoryDir}_target`;
    const targetStore = openStore(targetDir);

    const importRes = importSnapshot(targetStore, snapshot);
    expect(importRes.errors).toHaveLength(0);
    expect(importRes.imported).toBe(initialCount);
    expect(list(targetStore).length).toBe(initialCount);

    cleanup(root);
    cleanup(targetDir);
  });
});
