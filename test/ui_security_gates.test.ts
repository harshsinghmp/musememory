import { describe, test, expect } from "bun:test";
import { startUiServer, projectMemoryForUi } from "../src/ui.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";
import { openStore, propose, confirm } from "../src/store.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("Wave 5 - Task 2: UI Optimizer Gate & Read Route Projections (T-004, T-400)", () => {
  describe("T-004: UI Optimizer Gate (dry-run default & localhost/token protection)", () => {
    test("POST /api/optimize defaults to dryRun: true when dryRun is omitted", async () => {
      const { root, memoryDir } = setupFixtureRoot();
      const store = openStore(memoryDir);
      const srv = await startUiServer({ port: 0, memoryDir, store });

      const res = await fetch(`http://localhost:${srv.port}/api/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.report.dryRun).toBe(true);

      srv.close();
      cleanup(root);
    });

    test("POST /api/optimize allows dryRun: false with valid token or local origin", async () => {
      const { root, memoryDir } = setupFixtureRoot();
      const store = openStore(memoryDir);
      const srv = await startUiServer({
        port: 0,
        memoryDir,
        store,
        token: "secret-ui-token-123",
      });

      // Without token when token is required -> 403 Forbidden
      const resNoToken = await fetch(`http://localhost:${srv.port}/api/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      });
      expect(resNoToken.status).toBe(403);

      // With token -> 200 OK
      const resWithToken = await fetch(`http://localhost:${srv.port}/api/optimize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-muse-token": "secret-ui-token-123",
        },
        body: JSON.stringify({ dryRun: false }),
      });
      expect(resWithToken.status).toBe(200);
      const json = await resWithToken.json();
      expect(json.success).toBe(true);
      expect(json.report.dryRun).toBe(false);

      srv.close();
      cleanup(root);
    });
  });

  describe("T-400: UI Read Routes Projection Allowlist", () => {
    test("projectMemoryForUi strips unprojected metadata and preserves canvas fields", () => {
      const rawEntry: MemoryEntry & { unprojected_secret?: string; raw_internal_state?: any } = {
        id: "m_123456",
        title: "Test Architecture Decision",
        content: "Store decisions cleanly",
        type: "architecture",
        status: "confirmed",
        project: "musememory",
        tags: ["arch", "security"],
        salience: 0.8,
        verification: {
          level: "authoritative",
          method: "test",
          verified_at: "2026-10-15T12:00:00Z",
        },
        related_memory_ids: ["m_123455"],
        created_at: "2026-10-15T10:00:00Z",
        updated_at: "2026-10-15T11:00:00Z",
        unprojected_secret: "hidden-value",
        raw_internal_state: { memory_dump: true },
      };

      const projected = projectMemoryForUi(rawEntry);
      expect(projected.id).toBe("m_123456");
      expect(projected.title).toBe("Test Architecture Decision");
      expect(projected.content).toBe("Store decisions cleanly");
      expect(projected.tags).toEqual(["arch", "security"]);
      expect(projected.verification?.level).toBe("authoritative");
      expect((projected as any).unprojected_secret).toBeUndefined();
      expect((projected as any).raw_internal_state).toBeUndefined();
    });

    test("GET /api/memories and GET /api/snapshot return projected items", async () => {
      const { root, memoryDir } = setupFixtureRoot();
      const store = openStore(memoryDir);

      const mem = propose(store, {
        title: "Secret Invariant Memory",
        content: "High level invariant with internal details",
        type: "constraint",
        project: "testproject",
        tags: ["rule"],
      });
      // Inject dummy extra field into memory
      (mem as any).internal_debug_trace = "leaked-trace";
      confirm(store, mem.id);

      const srv = await startUiServer({ port: 0, memoryDir, store });

      const memRes = await fetch(`http://localhost:${srv.port}/api/memories`);
      expect(memRes.status).toBe(200);
      const mems = await memRes.json();
      expect(mems.length).toBeGreaterThan(0);
      for (const m of mems) {
        expect(m.id).toBeDefined();
        expect(m.title).toBeDefined();
        expect(m.content).toBeDefined();
        expect((m as any).internal_debug_trace).toBeUndefined();
      }

      const snapRes = await fetch(`http://localhost:${srv.port}/api/snapshot`);
      expect(snapRes.status).toBe(200);
      const snap = await snapRes.json();
      expect(snap.entries.length).toBeGreaterThan(0);
      for (const e of snap.entries) {
        expect((e as any).internal_debug_trace).toBeUndefined();
      }

      srv.close();
      cleanup(root);
    });
  });
});
