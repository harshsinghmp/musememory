import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, save, get, list, listConflicts } from "../src/store.ts";
import { broadcastKnowledge, ingestKnowledge, loadPeers, savePeers, type SyncPacket } from "../src/sync/index.ts";
import { generateAttestationKeypair, signPacket, type Attestation } from "../src/sync/attestation.ts";
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

/** Attaches an attestation to a packet, signed over the packet body. */
function withAttestation(packet: SyncPacket, attestation: Attestation): SyncPacket {
  return { ...packet, attestation } as SyncPacket & { attestation: Attestation };
}

describe("Fix #456: sync ingest authenticates the sender before overwriting", () => {
  let rootA: string;
  let rootB: string;
  let storeA: ReturnType<typeof openStore>;
  let storeB: ReturnType<typeof openStore>;
  let memoryDirB: string;

  beforeEach(() => {
    delete process.env.MUSE_ATTESTATION_PUBLIC_KEY;
    delete process.env.MUSE_SYNC_POOL_DIR;
    rootA = mkdtempSync(join(tmpdir(), "muse-trust-a-"));
    rootB = mkdtempSync(join(tmpdir(), "muse-trust-b-"));
    storeA = openStore(join(rootA, ".memory"));
    storeB = openStore(join(rootB, ".memory"));
    memoryDirB = join(rootB, ".memory");
  });

  afterEach(() => {
    delete process.env.MUSE_ATTESTATION_PUBLIC_KEY;
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  });

  function installTrustAnchor(publicKeyPem: string): void {
    const dir = join(memoryDirB, "sync");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "attestation.pub"), publicKeyPem, "utf-8");
  }

  test("a forged attestation is rejected and nothing is written", () => {
    const trusted = generateAttestationKeypair();
    const rogue = generateAttestationKeypair();
    installTrustAnchor(trusted.publicKey);

    save(storeA, entry("m_forged", "poisoned instruction", new Date().toISOString()));
    const packet = broadcastKnowledge(storeA, rootA, { agentId: "agent_rogue" });
    // Signed by a key the operator never trusted, while claiming a verified packet.
    const forged = signPacket(packet, rogue.privateKey, { signer: "agent_rogue" });

    const result = ingestKnowledge(storeB, rootB, withAttestation(packet, forged), "agent_nexus");

    expect(result.success).toBe(false);
    expect(result.errors.join(" ")).toContain("attestation verification failed");
    expect(result.ingested_count).toBe(0);
    expect(get(storeB, "m_forged")).toBeFalsy();
    expect(list(storeB).length).toBe(0);
    // No peer was learned from a rejected packet either.
    expect(Object.keys(loadPeers(memoryDirB)).length).toBe(0);
  });

  test("an attestation is rejected when no trust anchor is configured", () => {
    const signer = generateAttestationKeypair();
    save(storeA, entry("m_unverifiable", "content", new Date().toISOString()));
    const packet = broadcastKnowledge(storeA, rootA, { agentId: "agent_unknown" });
    const attestation = signPacket(packet, signer.privateKey, { signer: "agent_unknown" });

    const result = ingestKnowledge(storeB, rootB, withAttestation(packet, attestation), "agent_nexus");

    expect(result.success).toBe(false);
    expect(result.errors.join(" ")).toContain("no trusted key is configured");
    expect(get(storeB, "m_unverifiable")).toBeFalsy();
  });

  test("an unattested packet from an unknown sender cannot overwrite a confirmed memory", () => {
    const old = new Date(Date.now() - 120_000).toISOString();
    save(storeB, entry("m_confirmed", "the rule the operator confirmed", old));
    save(storeA, entry("m_confirmed", "attacker-supplied replacement", new Date().toISOString()));

    const packet = broadcastKnowledge(storeA, rootA, { agentId: "agent_stranger" });
    const result = ingestKnowledge(storeB, rootB, packet, "agent_nexus");

    expect(result.conflict_count).toBe(1);
    expect(result.ingested_count).toBe(0);
    expect(result.details.conflicted_ids).toContain("m_confirmed");
    // Stored content is untouched...
    expect(get(storeB, "m_confirmed")?.content).toBe("the rule the operator confirmed");
    // ...and the divergence is recorded rather than dropped.
    expect(listConflicts(storeB, { status: "open" }).length).toBeGreaterThan(0);
  });

  test("an attested packet from the trusted key still updates a confirmed memory", () => {
    const trusted = generateAttestationKeypair();
    installTrustAnchor(trusted.publicKey);

    const old = new Date(Date.now() - 120_000).toISOString();
    save(storeB, entry("m_attested", "old content", old));
    save(storeA, entry("m_attested", "verified new content", new Date().toISOString()));

    const packet = broadcastKnowledge(storeA, rootA, { agentId: "agent_signed" });
    const attestation = signPacket(packet, trusted.privateKey, { signer: "agent_signed" });
    const result = ingestKnowledge(storeB, rootB, withAttestation(packet, attestation), "agent_nexus");

    expect(result.success).toBe(true);
    expect(result.ingested_count).toBe(1);
    expect(result.conflict_count).toBe(0);
    expect(get(storeB, "m_attested")?.content).toBe("verified new content");
  });

  test("a known peer keeps newer-wins without an attestation", () => {
    const old = new Date(Date.now() - 120_000).toISOString();
    save(storeB, entry("m_peer", "old peer content", old));
    save(storeA, entry("m_peer", "new peer content", new Date().toISOString()));

    // A peer we have synced with before, and whose last sync is in the future, so
    // this is a plain newer-wins update rather than a concurrent write.
    const peers = loadPeers(memoryDirB);
    peers["agent_known"] = {
      agent_id: "agent_known",
      last_seen_at: new Date(Date.now() + 60_000).toISOString(),
      last_packet_id: "pkt_prev",
      vector_clock: { agent_known: 1 },
      total_packets_received: 1,
      total_memories_ingested: 1,
    };
    savePeers(memoryDirB, peers);

    const packet = broadcastKnowledge(storeA, rootA, { agentId: "agent_known" });
    const result = ingestKnowledge(storeB, rootB, packet, "agent_nexus");

    expect(result.ingested_count).toBe(1);
    expect(result.conflict_count).toBe(0);
    expect(get(storeB, "m_peer")?.content).toBe("new peer content");
    expect(existsSync(join(memoryDirB, "sync", "peers.json"))).toBe(true);
  });
});
