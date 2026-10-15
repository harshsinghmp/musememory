import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { makeTempRoot, cleanup } from "./helpers.ts";
import { openStore, repairFtsIndex } from "../src/store.ts";
import { insertOrReplaceMemory } from "../src/sqlite.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("T-103: Index-time credential redaction in memories_fts", () => {
  let root: string;
  let memoryDir: string;

  beforeEach(() => {
    root = makeTempRoot();
    memoryDir = `${root}/.memory`;
  });

  afterEach(() => {
    cleanup(root);
  });

  test("insertOrReplaceMemory redacts secrets before storing in memories_fts", () => {
    const store = openStore(memoryDir);
    const db = store.db!;

    const secretToken = "ghp_1234567890abcdef1234567890abcdef12345";
    const entry: MemoryEntry = {
      id: "m_103_secret_test",
      title: "Deployment instructions for cluster",
      content: `Use GitHub token ${secretToken} to push to registry.`,
      project: "infra",
      status: "candidate",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source: "manual",
      tags: ["deploy"],
    };

    insertOrReplaceMemory(db, entry);

    const ftsRow = db.query<{ id: string; title: string; content: string }>(
      `SELECT * FROM memories_fts WHERE id = ?`,
    ).get([entry.id]);

    expect(ftsRow).toBeDefined();
    expect(ftsRow!.content).not.toContain(secretToken);
    expect(ftsRow!.content).toContain("[REDACTED_SECRET]");
  });

  test("repairFtsIndex redacts secrets during full FTS rebuild", () => {
    const store = openStore(memoryDir);
    const db = store.db!;

    const secretKey = "sk-live-abcdef1234567890abcdef1234567890";
    const entry: MemoryEntry = {
      id: "m_103_rebuild_test",
      title: "OpenAI Config",
      content: `API key is ${secretKey} in production env.`,
      project: "ai",
      status: "confirmed",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source: "manual",
      tags: ["ai"],
    };

    // Insert directly into memories table simulating legacy unredacted state
    db.run(
      `INSERT INTO memories (id, title, content, project, type, status, created_at, updated_at, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.title,
        entry.content,
        entry.project,
        "discovery",
        entry.status,
        entry.created_at,
        entry.updated_at,
        JSON.stringify(entry),
      ],
    );

    repairFtsIndex(store);

    const ftsRow = db.query<{ id: string; title: string; content: string }>(
      `SELECT * FROM memories_fts WHERE id = ?`,
    ).get([entry.id]);

    expect(ftsRow).toBeDefined();
    expect(ftsRow!.content).not.toContain(secretKey);
    expect(ftsRow!.content).toContain("[REDACTED_SECRET]");
  });
});
