import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, save, get } from "../src/store.ts";
import { broadcastKnowledge, ingestKnowledge, loadPeers } from "../src/sync/index.ts";
import { validateSyncPacket } from "../src/sync/packet.ts";
import { validateHttpAuth } from "../src/mcp/http.ts";
import type { IncomingMessage } from "node:http";
import type { MemoryEntry } from "../src/types.ts";

function entry(id: string, content: string, updatedAt: string): MemoryEntry {
  return {
    id,
    title: `Memory ${id}`,
    content,
    project: "app",
    status: "confirmed",
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

function mockReq(headers: Record<string, string>): IncomingMessage {
  return {
    headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
  } as unknown as IncomingMessage;
}

/**
 * Regressions for the 2026-11-26 security audit.
 *
 * Two classes are locked here because both are invisible in a code review:
 * a prototype-chain lookup that turns any string into a "known peer", and CI
 * expressions that reach a shell.
 */
describe("security audit 2026-11 regressions", () => {
  describe("sync peer trust is own-property only", () => {
    let rootA: string;
    let rootB: string;
    let storeA: ReturnType<typeof openStore>;
    let storeB: ReturnType<typeof openStore>;

    beforeEach(() => {
      delete process.env.MUSE_ATTESTATION_PUBLIC_KEY;
      rootA = mkdtempSync(join(tmpdir(), "muse-sec-a-"));
      rootB = mkdtempSync(join(tmpdir(), "muse-sec-b-"));
      storeA = openStore(join(rootA, ".memory"));
      storeB = openStore(join(rootB, ".memory"));
    });

    afterEach(() => {
      delete process.env.MUSE_ATTESTATION_PUBLIC_KEY;
      rmSync(rootA, { recursive: true, force: true });
      rmSync(rootB, { recursive: true, force: true });
    });

    test("a prototype-inherited sender id cannot borrow peer trust", () => {
      const old = new Date(Date.now() - 120_000).toISOString();
      save(storeB, entry("m_proto", "the operator's confirmed rule", old));
      save(storeA, entry("m_proto", "attacker-supplied replacement", new Date().toISOString()));

      const packet = broadcastKnowledge(storeA, rootA, { agentId: "agent_stranger" });
      // "toString" is not in the intake reject-list, so it reaches the trust
      // lookup exactly as the pre-fix code did; the null-prototype peers record
      // and Object.hasOwn are what stop it.
      (packet as { sender_id: string }).sender_id = "toString";
      expect(validateSyncPacket(packet).valid).toBe(true);

      const result = ingestKnowledge(storeB, rootB, packet, "agent_nexus");

      expect(get(storeB, "m_proto")?.content).toBe("the operator's confirmed rule");
      expect(result.conflict_count).toBe(1);
      expect(result.ingested_count).toBe(0);
    });

    test("__proto__ is rejected at packet intake", () => {
      const packet = broadcastKnowledge(storeA, rootA, { agentId: "agent_stranger" });
      (packet as { sender_id: string }).sender_id = "__proto__";
      const check = validateSyncPacket(packet);
      expect(check.valid).toBe(false);
      expect(check.error).toContain("sender_id");
    });

    test("loadPeers has no prototype to inherit from", () => {
      expect(Object.getPrototypeOf(loadPeers(join(rootB, ".memory")))).toBeNull();
    });
  });

  describe("token identity beats a peer header", () => {
    test("a mapped token cannot claim another peer via the header", () => {
      const res = validateHttpAuth(
        mockReq({ authorization: "Bearer t-bob", "mcp-peer-id": "alice" }),
        { bearerTokens: ["bob:t-bob"], allowedPeers: ["bob"] },
      );
      expect(res.authenticated).toBe(false);
      expect(res.status).toBe(403);
      expect(res.errorMessage).toContain("does not match the token identity");
    });

    test("an unmapped token may still name its peer", () => {
      const res = validateHttpAuth(
        mockReq({ authorization: "Bearer shared", "mcp-peer-id": "alice" }),
        { bearerToken: "shared", allowedPeers: ["alice"] },
      );
      expect(res.authenticated).toBe(true);
      expect(res.peerId).toBe("alice");
    });
  });

  describe("workflow supply chain", () => {
    const dir = join(import.meta.dir, "..", ".github", "workflows");
    const files = readdirSync(dir).filter((f) => f.endsWith(".yml"));

    test("every action is pinned to a full commit SHA with a version comment", () => {
      for (const file of files) {
        const text = readFileSync(join(dir, file), "utf8");
        const uses = text.split("\n").filter((l) => /\buses:/.test(l));
        expect(uses.length).toBeGreaterThan(0);
        for (const line of uses) {
          // One `org/repo` is not the shape: `github/codeql-action/upload-sarif`
          // is an action that lives below a repository root, and the old
          // two-segment pattern let every sub-path action through unchecked.
          expect(line).toMatch(/uses:\s+[\w.-]+(?:\/[\w.-]+)+@[0-9a-f]{40}\s+#\s+v\d/);
        }
      }
    });

    test("no expression is interpolated into a run block", () => {
      for (const file of files) {
        const text = readFileSync(join(dir, file), "utf8");
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.startsWith("run:") && trimmed.includes("${{")) {
            throw new Error(`${file}: expression inside run: ${trimmed}`);
          }
        }
      }
    });

    test("no pull_request_target and every workflow declares permissions", () => {
      for (const file of files) {
        const text = readFileSync(join(dir, file), "utf8");
        expect(text).not.toContain("pull_request_target");
        expect(text).toContain("permissions:");
      }
    });
  });
});
