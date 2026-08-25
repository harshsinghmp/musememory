import { describe, test, expect } from "bun:test";
import { openStore, propose } from "../src/store.ts";
import { setCurrent } from "../src/current.ts";
import { queryContext, formatPromptContext } from "../src/retrieval.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";

describe("unified context & retrieval engine", () => {
  test("queryContext ranks, filters, and applies token knapsack budget", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const e1 = propose(store, {
      title: "Authentication Token Handling",
      content: "Always use HttpOnly secure cookies for auth session tokens.",
      project: "aria",
      type: "decision",
      confirmed: true,
      tags: ["auth", "security"],
    });

    const e2 = propose(store, {
      title: "Database Indexing Strategy",
      content: "Ensure composite index on tenant_id and created_at.",
      project: "aria",
      type: "architecture",
      confirmed: true,
      tags: ["database", "perf"],
    });

    // Query for auth
    const authRes = queryContext(store, "auth tokens cookies", { project: "aria" });
    expect(authRes.results.length).toBeGreaterThan(0);
    expect(authRes.results[0].entry.id).toBe(e1.id);
    expect(authRes.results[0].score).toBeGreaterThan(0);

    // Query with token budget
    const budgetRes = queryContext(store, "auth database", { tokenBudget: 40, limit: 10 });
    expect(budgetRes.totalTokensUsed).toBeLessThanOrEqual(40);
    expect(budgetRes.results.length).toBe(1);

    cleanup(root);
  });

  test("formatPromptContext outputs structured Markdown with USER.md and CURRENT.md constraints", async () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const { setUserProfile } = await import("../src/user.ts");

    // Set user profile
    setUserProfile(memoryDir, "# Developer Profile\n- Tone: Ultra terse\n- Prefer strict TypeScript");

    // Set constraint in CURRENT.md
    setCurrent(memoryDir, "Zero-credential leakage policy strictly enforced.", "aria");

    propose(store, {
      title: "API Timeout Limit",
      content: "All downstream HTTP calls must timeout after 5000ms.",
      project: "aria",
      type: "constraint",
      confirmed: true,
      tags: ["http", "network"],
    });

    const formatted = formatPromptContext(store, memoryDir, "timeout limit", { project: "aria" });
    expect(formatted.userProfile).toContain("Developer Profile");
    expect(formatted.constraints.length).toBeGreaterThan(0);
    expect(formatted.markdown).toContain("### User Profile & Preferences (USER.md)");
    expect(formatted.markdown).toContain("Ultra terse");
    expect(formatted.markdown).toContain("### Active Working Constraints (CURRENT.md)");
    expect(formatted.markdown).toContain("Zero-credential leakage policy");
    expect(formatted.markdown).toContain("### Relevant Memories & Learned Patterns");
    expect(formatted.markdown).toContain("API Timeout Limit");
    expect(formatted.markdown).toContain("5000ms");
    expect(formatted.markdown).toContain("Memory Directive: When learning durable facts");

    cleanup(root);
  });
});
