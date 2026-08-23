import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { searchTranscriptWithBookends } from "../src/transcript.ts";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "trans-search-test-"));
}

describe("Transcript Search with Bookends & Context Window", () => {
  const sampleTranscript = [
    JSON.stringify({ type: "USER_INPUT", content: "How do we configure database connection pooling for PostgreSQL?" }),
    JSON.stringify({ type: "PLANNER_RESPONSE", content: "Let's review the PostgreSQL pool settings in database.ts." }),
    JSON.stringify({ type: "TOOL_CALL", tool_name: "view_file", path: "src/database.ts" }),
    JSON.stringify({ type: "TOOL_RESULT", content: "max_connections = 10, idle_timeout = 30000" }),
    JSON.stringify({ type: "PLANNER_RESPONSE", content: "We should increase pool max_connections to 50 for high concurrency." }),
    JSON.stringify({ type: "USER_INPUT", content: "What about the Redis caching layer?" }),
    JSON.stringify({ type: "PLANNER_RESPONSE", content: "Redis cache TTL is currently configured for 3600 seconds." }),
    JSON.stringify({ type: "PLANNER_RESPONSE", content: "Database pooling and Redis caching optimizations are complete and tested." }),
  ].join("\n");

  test("returns start and end conversation bookends along with matching snippet and window context", () => {
    const root = temp();
    const filePath = join(root, "session.jsonl");
    writeFileSync(filePath, sampleTranscript, "utf8");

    const result = searchTranscriptWithBookends(filePath, "PostgreSQL pool settings", { windowSize: 1 });

    expect(result.totalTurns).toBe(8);
    expect(result.bookendStart).toContain("How do we configure database connection pooling");
    expect(result.bookendEnd).toContain("Database pooling and Redis caching optimizations are complete");
    expect(result.matches.length).toBe(1);

    const match = result.matches[0];
    expect(match.matchedTurn).toContain("Let's review the PostgreSQL pool settings in database.ts.");
    expect(match.before.length).toBe(1);
    expect(match.before[0]).toContain("How do we configure database connection pooling");
    expect(match.after.length).toBe(1);
    expect(match.after[0]).toContain("src/database.ts");

    expect(result.formattedSummary).toContain("### Conversation Overview");
    expect(result.formattedSummary).toContain("[Start Bookend]");
    expect(result.formattedSummary).toContain("[End Bookend]");
    expect(result.formattedSummary).toContain("Matches for \"PostgreSQL pool settings\"");

    rmSync(root, { recursive: true, force: true });
  });

  test("handles multi-word queries across turns", () => {
    const result = searchTranscriptWithBookends(sampleTranscript, "Redis cache TTL");
    expect(result.matches.length).toBe(1);
    expect(result.matches[0].matchedTurn).toContain("3600 seconds");
  });

  test("returns clean overview when no matches are found", () => {
    const result = searchTranscriptWithBookends(sampleTranscript, "nonexistent-keyword-xyz");
    expect(result.matches.length).toBe(0);
    expect(result.formattedSummary).toContain("No matches found for query \"nonexistent-keyword-xyz\"");
    expect(result.formattedSummary).toContain("[Start Bookend]");
  });
});
