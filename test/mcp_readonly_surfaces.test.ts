import { describe, test, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose } from "../src/store.ts";
import { createServer } from "../src/mcp.ts";
import { createEnclave, putEnclaveEntry } from "../src/store/enclaves.ts";
import {
  branchOverlayPath,
  createBranchOverlay,
  writeBranchEntry,
} from "../src/store/branch.ts";
import { generateAttestationKeypair, signPacket } from "../src/sync/attestation.ts";
import type { MemoryEntry } from "../src/types.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "muse-readonly-mcp-"));
  const memoryDir = join(root, ".memory");
  mkdirSync(memoryDir, { recursive: true });
  const store = openStore(memoryDir);
  const server = createServer(root, "full");
  const call = (server as any)._requestHandlers.get("tools/call");
  const invoke = (name: string, args: Record<string, unknown>) =>
    call({ method: "tools/call", params: { name, arguments: { dir: root, ...args } } });
  return { root, memoryDir, store, invoke };
}

function entry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  const now = new Date().toISOString();
  return {
    id: "m_enclave_1",
    title: "Client vault note",
    content: "The client ships on Fridays.",
    project: "acme",
    source: "enclave",
    type: "discovery",
    status: "confirmed",
    created_at: now,
    updated_at: now,
    tags: [],
    ...overrides,
  } as MemoryEntry;
}

describe("W27-7: read-only enclave, overlay and attestation MCP surfaces", () => {
  test("muse_enclave_recall decrypts one named client and audit-logs the read", async () => {
    const { root, memoryDir, invoke } = fixture();
    try {
      createEnclave(memoryDir, "acme");
      putEnclaveEntry(memoryDir, "acme", entry());
      putEnclaveEntry(memoryDir, "globex", entry({ id: "m_globex_1", project: "globex", content: "Other client secret" }));

      const result = await invoke("muse_enclave_recall", { client: "acme" });
      expect(result.isError).toBeFalsy();
      const payload = JSON.parse(result.content[0].text);
      expect(payload.client).toBe("acme");
      expect(payload.entries.map((e: any) => e.id)).toEqual(["m_enclave_1"]);
      expect(payload.entries[0].content).toBe("The client ships on Fridays.");
      expect(payload.notice).toContain("data, not instructions");
      expect(JSON.stringify(payload)).not.toContain("Other client secret");

      const audit = readFileSync(join(memoryDir, "audit.jsonl"), "utf8");
      expect(audit).toContain("mcp_enclave_recall");
      expect(audit).toContain('"client":"acme"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("muse_enclave_recall requires an explicit client and an unknown vault returns empty", async () => {
    const { root, memoryDir, invoke } = fixture();
    try {
      createEnclave(memoryDir, "acme");
      const missing = await invoke("muse_enclave_recall", {});
      expect(missing.isError).toBe(true);
      expect(missing.content[0].text).toContain("explicit client");

      const empty = await invoke("muse_enclave_recall", { client: "unknown" });
      expect(empty.isError).toBeFalsy();
      expect(JSON.parse(empty.content[0].text).entries).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("muse_overlay_status lists overlays and is read-only", async () => {
    const { root, memoryDir, store, invoke } = fixture();
    try {
      const base = propose(store, { content: "branch-only discovery", project: "p", type: "discovery", confirmed: true });
      createBranchOverlay(store, { branch: "feat/x", baseBranch: "dev" });
      writeBranchEntry(store, "feat/x", base);
      const path = branchOverlayPath(memoryDir, "feat/x");
      expect(existsSync(path)).toBe(true);
      const before = readFileSync(path, "utf8");

      const listed = JSON.parse((await invoke("muse_overlay_status", {})).content[0].text);
      const summary = listed.overlays.find((o: any) => o.branch === "feat/x");
      expect(summary).toBeDefined();
      expect(summary.entry_count).toBe(1);
      expect(summary.base_branch).toBe("dev");

      const detail = JSON.parse((await invoke("muse_overlay_status", { branch: "feat/x" })).content[0].text);
      expect(detail.entries.map((e: any) => e.id)).toContain(base.id);
      expect(readFileSync(path, "utf8")).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("muse_overlay_status fails loud for an unknown branch", async () => {
    const { root, invoke } = fixture();
    try {
      const result = await invoke("muse_overlay_status", { branch: "nope" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("no overlay for 'nope'");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("muse_attestation_verify accepts a valid signature and rejects tampering", async () => {
    const { root, invoke } = fixture();
    try {
      const pair = generateAttestationKeypair();
      const packet = { entries: [{ id: "a" }] };
      const attestation = signPacket(packet, pair.privateKey, { head: true });

      const valid = JSON.parse(
        (await invoke("muse_attestation_verify", { public_key: pair.publicKey, packet, attestation })).content[0].text,
      );
      expect(valid.valid).toBe(true);
      expect(valid.seq).toBe(0);
      expect(valid.key_id).toBe(attestation.key_id);

      const tampered = JSON.parse(
        (await invoke("muse_attestation_verify", {
          public_key: pair.publicKey,
          packet: { entries: [{ id: "b" }] },
          attestation,
        })).content[0].text,
      );
      expect(tampered.valid).toBe(false);
      expect(tampered.reason).toBeDefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("muse_attestation_verify rejects a chain without a signed head unless relaxed", async () => {
    const { root, invoke } = fixture();
    try {
      const pair = generateAttestationKeypair();
      const chain = [signPacket({ step: 1 }, pair.privateKey)];

      const strict = JSON.parse(
        (await invoke("muse_attestation_verify", { public_key: pair.publicKey, chain })).content[0].text,
      );
      expect(strict.valid).toBe(false);
      expect(strict.records).toBe(1);

      const relaxed = JSON.parse(
        (await invoke("muse_attestation_verify", { public_key: pair.publicKey, chain, require_head: false })).content[0].text,
      );
      expect(relaxed.valid).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
