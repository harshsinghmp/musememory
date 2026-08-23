import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, propose } from "../src/store.ts";
import { estimateEntryTokens, search } from "../src/retrieval.ts";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "budget-test-"));
}

describe("dynamic prompt token budgeter", () => {
  test("estimateEntryTokens calculates proportional token count", () => {
    const shortEntry = {
      id: "test-short",
      title: "Short Title",
      content: "Short content",
      project: "proj",
      status: "active" as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const longEntry = {
      id: "test-long",
      title: "Long Title ".repeat(10),
      content: "Detailed paragraph about system design and architecture. ".repeat(20),
      project: "proj",
      status: "active" as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const shortTokens = estimateEntryTokens(shortEntry);
    const longTokens = estimateEntryTokens(longEntry);

    expect(shortTokens).toBeGreaterThan(0);
    expect(longTokens).toBeGreaterThan(shortTokens * 5);
  });

  test("search respects tokenBudget and packs top-ranked entries within budget", () => {
    const root = temp();
    const store = openStore(root);

    // Create 5 entries with ~30 tokens each
    for (let i = 1; i <= 5; i++) {
      propose(store, {
        project: "test-proj",
        title: `Architecture Decision ${i}`,
        content: `Architecture specifications for subsystem ${i}.`,
        confirmed: true,
      });
    }

    // Unlimited search returns all 5
    const fullRes = search(store, root, "architecture", { limit: 10 });
    expect(fullRes.results.length).toBe(5);

    // Search with token budget that fits ~2 entries (approx 70 tokens)
    const budgetRes = search(store, root, "architecture", { tokenBudget: 75, limit: 10 });
    expect(budgetRes.results.length).toBeLessThan(5);
    expect(budgetRes.results.length).toBeGreaterThan(0);
    expect(budgetRes.totalTokensUsed).toBeLessThanOrEqual(75);

    rmSync(root, { recursive: true, force: true });
  });
});
