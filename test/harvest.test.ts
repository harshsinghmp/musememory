import { describe, test, expect } from "bun:test";
import { openStore, propose, get, list } from "../src/store.ts";
import { extractHarvestUnits, exportSnapshot, importSnapshot, defaultSalienceForType } from "../src/harvest.ts";
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
