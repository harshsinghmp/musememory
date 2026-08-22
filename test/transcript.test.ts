import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, list } from "../src/store.ts";
import { parseJsonlTranscript, importTranscript } from "../src/harvest.ts";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "transcript-test-"));
}

describe("universal JSONL transcript ingestion", () => {
  test("parseJsonlTranscript extracts text from varied JSONL shapes", () => {
    const sampleJsonl = [
      JSON.stringify({ type: "USER_INPUT", content: "How do we handle OAuth token expiration?" }),
      JSON.stringify({ type: "PLANNER_RESPONSE", thinking: "The refresh token rotation strategy should be used." }),
      JSON.stringify({
        type: "PLANNER_RESPONSE",
        content: [
          { type: "text", text: "### Decision: Use Refresh Token Rotation\nWe implement automatic refresh token rotation on 401 errors." },
        ],
      }),
      JSON.stringify({ message: "### Fix: Handled Axios Interceptor Race Condition\nAdded retry queue with exponential backoff." }),
    ].join("\n");

    const blocks = parseJsonlTranscript(sampleJsonl);
    expect(blocks.length).toBe(4);
    expect(blocks.some((b) => b.includes("OAuth token expiration"))).toBe(true);
    expect(blocks.some((b) => b.includes("Refresh Token Rotation"))).toBe(true);
  });

  test("importTranscript ingests transcript file and creates structured memory units", () => {
    const root = temp();
    const store = openStore(root);
    const transcriptFile = join(root, "session.jsonl");

    const transcriptContent = [
      JSON.stringify({ content: "Debugging auth system" }),
      JSON.stringify({ content: "### Fix: Resolved JWT Signature Mismatch\nVerified HMAC secret padding in auth middleware." }),
      JSON.stringify({ content: "### Decision: Standardized on Ed25519 Tokens\nMigrated from RS256 to Ed25519 for faster token verification." }),
    ].join("\n");

    writeFileSync(transcriptFile, transcriptContent, "utf8");

    const res = importTranscript(store, transcriptFile, { project: "auth-service", confirmed: true });
    expect(res.imported).toBe(2);
    expect(res.errors.length).toBe(0);

    const memories = list(store);
    expect(memories.length).toBe(2);
    const titles = memories.map((m) => m.title);
    expect(titles.some((t) => t.includes("JWT Signature Mismatch"))).toBe(true);
    expect(titles.some((t) => t.includes("Ed25519 Tokens"))).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });

  test("importTranscript attaches sessionId and integrates with getSessionMemories", async () => {
    const { recordSessionStart, getSessionMemories } = await import("../src/sessions.ts");
    const root = temp();
    const store = openStore(root);

    const { sessionId } = recordSessionStart(store, "auth-service", "Refactoring session");

    const transcriptContent = [
      JSON.stringify({ content: "### Fix: Patched Race Condition\nAdded mutex lock around token swap." }),
    ].join("\n");

    const res = importTranscript(store, transcriptContent, {
      project: "auth-service",
      confirmed: true,
      sessionId,
    });

    expect(res.imported).toBe(1);
    const sessionMemories = getSessionMemories(store, sessionId);
    expect(sessionMemories.length).toBe(1);
    expect(sessionMemories[0].title).toContain("Patched Race Condition");
    expect(sessionMemories[0].session_id).toBe(sessionId);

    rmSync(root, { recursive: true, force: true });
  });
});

