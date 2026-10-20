import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, getStorageLayout, resolveDbFilename, save } from "../src/store.ts";
import { resolveTenantDbPath, isTenantDb, listTenantDatabases } from "../src/root.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("T-153: Multi-DB topology (shared team store + per-member local DBs)", () => {
  let tmpDir: string;
  let memoryDir: string;
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.MUSE_TENANT_ID;
    delete process.env.MUSE_TENANT;
    tmpDir = mkdtempSync(join(tmpdir(), "muse-tenant-test-"));
    memoryDir = join(tmpDir, ".memory");
  });

  afterEach(() => {
    process.env = { ...origEnv };
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe("resolveDbFilename & helpers", () => {
    test("maps tenant configurations to expected database filenames", () => {
      expect(resolveDbFilename()).toBe("memory.db");
      expect(resolveDbFilename({ isTeam: true })).toBe("team.db");
      expect(resolveDbFilename({ tenantId: "team" })).toBe("team.db");
      expect(resolveDbFilename({ tenantId: "alice" })).toBe("tenant_alice.db");
      expect(resolveDbFilename({ tenantId: "tenant_bob" })).toBe("tenant_bob.db");
      expect(resolveDbFilename({ dbName: "custom.db" })).toBe("custom.db");
      expect(resolveDbFilename({ dbName: "custom" })).toBe("custom.db");

      process.env.MUSE_TENANT_ID = "env_tenant";
      expect(resolveDbFilename()).toBe("tenant_env_tenant.db");
    });

    test("root helpers resolve and identify tenant databases", () => {
      expect(resolveTenantDbPath(memoryDir)).toBe(join(memoryDir, "memory.db"));
      expect(resolveTenantDbPath(memoryDir, "team")).toBe(join(memoryDir, "team.db"));
      expect(resolveTenantDbPath(memoryDir, "charlie")).toBe(join(memoryDir, "tenant_charlie.db"));

      expect(isTenantDb("memory.db")).toBe(true);
      expect(isTenantDb("team.db")).toBe(true);
      expect(isTenantDb("tenant_alice.db")).toBe(true);
      expect(isTenantDb("tenant_team_member_1.db")).toBe(true);
      expect(isTenantDb("other.txt")).toBe(false);
      expect(isTenantDb("malicious..db")).toBe(false);
    });
  });

  describe("Multi-DB store isolation", () => {
    test("operates concurrent isolated SQLite databases within the same root without cross-talk", () => {
      // 1. Open Team store
      const teamStore = openStore(memoryDir, { isTeam: true });
      expect(teamStore.layout?.dbPath).toBe(join(memoryDir, "team.db"));
      expect(teamStore.tenantId).toBe("team");

      // 2. Open Member Alice store
      const aliceStore = openStore(memoryDir, { tenantId: "alice" });
      expect(aliceStore.layout?.dbPath).toBe(join(memoryDir, "tenant_alice.db"));
      expect(aliceStore.tenantId).toBe("alice");

      // 3. Open Member Bob store
      const bobStore = openStore(memoryDir, { tenantId: "bob" });
      expect(bobStore.layout?.dbPath).toBe(join(memoryDir, "tenant_bob.db"));
      expect(bobStore.tenantId).toBe("bob");

      // 4. Open Default local store
      const localStore = openStore(memoryDir);
      expect(localStore.layout?.dbPath).toBe(join(memoryDir, "memory.db"));

      // 5. Insert entries into different stores
      const teamEntry: MemoryEntry = {
        id: "mem-team-1",
        title: "Team Architecture Convention",
        content: "Shared conventions across all 5 team members",
        type: "architecture",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["team", "architecture"],
        project: "agency",
      };
      save(teamStore, teamEntry);

      const aliceEntry: MemoryEntry = {
        id: "mem-alice-1",
        title: "Alice Personal Scratchpad",
        content: "Alice local invariant and experiment note",
        type: "discovery",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["personal"],
        project: "agency",
      };
      save(aliceStore, aliceEntry);

      const bobEntry: MemoryEntry = {
        id: "mem-bob-1",
        title: "Bob Personal Decision",
        content: "Bob local testing decision",
        type: "decision",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["personal"],
        project: "agency",
      };
      save(bobStore, bobEntry);

      // 6. Verify strictly isolated visibility
      // Team DB has team entry only
      const teamMems = teamStore.db?.query<{ id: string }>("SELECT id FROM memories").all();
      expect(teamMems?.map((m) => m.id)).toEqual(["mem-team-1"]);

      // Alice DB has alice entry only
      const aliceMems = aliceStore.db?.query<{ id: string }>("SELECT id FROM memories").all();
      expect(aliceMems?.map((m) => m.id)).toEqual(["mem-alice-1"]);

      // Bob DB has bob entry only
      const bobMems = bobStore.db?.query<{ id: string }>("SELECT id FROM memories").all();
      expect(bobMems?.map((m) => m.id)).toEqual(["mem-bob-1"]);

      // Local DB has 0 entries
      const localMems = localStore.db?.query<{ id: string }>("SELECT id FROM memories").all();
      expect(localMems?.length).toBe(0);

      // 7. Verify all files exist in filesystem and listTenantDatabases discovers them
      expect(existsSync(join(memoryDir, "team.db"))).toBe(true);
      expect(existsSync(join(memoryDir, "tenant_alice.db"))).toBe(true);
      expect(existsSync(join(memoryDir, "tenant_bob.db"))).toBe(true);
      expect(existsSync(join(memoryDir, "memory.db"))).toBe(true);

      const dbs = listTenantDatabases(memoryDir);
      expect(dbs).toContain("team.db");
      expect(dbs).toContain("tenant_alice.db");
      expect(dbs).toContain("tenant_bob.db");
      expect(dbs).toContain("memory.db");
    });
  });
});
