import { describe, test, expect } from "bun:test";
import {
  canonicalJson,
  generateAttestationKeypair,
  hashPacket,
  signPacket,
  verifyAttestation,
  verifyAttestationChain,
} from "../src/sync/attestation.ts";

describe("T-438: zero-knowledge packet attestation", () => {
  test("signs a hash, verifies, and rejects tampering", () => {
    const keys = generateAttestationKeypair();
    const packet = { project: "p", memories: [{ id: "m1", content: "secret" }] };
    const attestation = signPacket(packet, keys.privateKey, { signer: "alice" });

    expect(attestation.packet_hash).toBe(hashPacket(packet));
    expect(JSON.stringify(attestation)).not.toContain("secret");
    expect(verifyAttestation(packet, attestation, keys.publicKey)).toBe(true);
    expect(verifyAttestation({ ...packet, project: "other" }, attestation, keys.publicKey)).toBe(false);
    expect(verifyAttestation(packet, { ...attestation, signature: "AAAA" }, keys.publicKey)).toBe(false);
  });

  test("chains attestations and detects reordering", () => {
    const keys = generateAttestationKeypair();
    const first = signPacket({ n: 1 }, keys.privateKey);
    const second = signPacket({ n: 2 }, keys.privateKey, { previous: first });
    const third = signPacket({ n: 3 }, keys.privateKey, { previous: second });

    expect(verifyAttestationChain([first, second, third], keys.publicKey)).toBe(true);
    expect(verifyAttestationChain([second, first, third], keys.publicKey)).toBe(false);
  });

  test("canonical JSON is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
});
