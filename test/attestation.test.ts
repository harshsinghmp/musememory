import { describe, test, expect } from "bun:test";
import {
  canonicalJson,
  generateAttestationKeypair,
  getSignatureVerifier,
  hashPacket,
  keyIdFromPublicKey,
  registerSignatureVerifier,
  signPacket,
  supportedSignatureAlgorithms,
  unregisterSignatureVerifier,
  verifyAttestation,
  verifyAttestationChain,
  verifyAttestationDetailed,
  type Attestation,
  type SignatureVerifier,
} from "../src/sync/attestation.ts";

describe("T-438: zero-knowledge packet attestation", () => {
  test("signs a hash, verifies, and rejects tampering", () => {
    const keys = generateAttestationKeypair();
    const packet = { project: "p", memories: [{ id: "m1", content: "secret" }] };
    const attestation = signPacket(packet, keys.privateKey, { signer: "alice" });

    expect(attestation.packet_hash).toBe(hashPacket(packet));
    expect(JSON.stringify(attestation)).not.toContain("secret");
    expect(attestation.seq).toBe(0);
    expect(attestation.key_id).toBe(keyIdFromPublicKey(keys.publicKey));
    expect(verifyAttestation(packet, attestation, keys.publicKey)).toBe(true);
    expect(verifyAttestation(packet, attestation, keys.publicKey, { expectedKeyId: "deadbeef" })).toBe(false);
    expect(verifyAttestation({ ...packet, project: "other" }, attestation, keys.publicKey)).toBe(false);
    expect(verifyAttestation(packet, { ...attestation, signature: "AAAA" }, keys.publicKey)).toBe(false);
  });

  test("chains attestations and detects reordering", () => {
    const keys = generateAttestationKeypair();
    const first = signPacket({ n: 1 }, keys.privateKey);
    const second = signPacket({ n: 2 }, keys.privateKey, { previous: first });
    const third = signPacket({ n: 3 }, keys.privateKey, { previous: second, head: true });

    expect(verifyAttestationChain([first, second, third], keys.publicKey)).toBe(true);
    expect(verifyAttestationChain([second, first, third], keys.publicKey)).toBe(false);
    // Truncation without a head is rejected by default.
    expect(verifyAttestationChain([first, second], keys.publicKey)).toBe(false);
    expect(verifyAttestationChain([first, second], keys.publicKey, { requireHead: false })).toBe(true);
  });

  test("canonical JSON is key-order independent and rejects non-I-JSON", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(() => canonicalJson(new Date(0))).toThrow();
    expect(() => canonicalJson(Number.NaN)).toThrow();
  });

  test("rejects empty chains and tampered algorithm", () => {
    const keys = generateAttestationKeypair();
    expect(verifyAttestationChain([], keys.publicKey)).toBe(false);
    const attestation = signPacket({ n: 1 }, keys.privateKey);
    expect(verifyAttestationChain([{ ...attestation, algorithm: "rsa" as any }], keys.publicKey)).toBe(false);
  });
});

describe("T-518: algorithm agility, the PQ envelope and the age bound", () => {
  test("an unknown algorithm is unsupported_algorithm, not a generic signature failure", () => {
    const keys = generateAttestationKeypair();
    const packet = { n: 1 };
    const attestation = signPacket(packet, keys.privateKey);
    const future = { ...attestation, algorithm: "ml-dsa-65" } as Attestation;

    const report = verifyAttestationDetailed(packet, future, keys.publicKey);
    expect(report.valid).toBe(false);
    expect(report.reason).toBe("unsupported_algorithm");
    expect(report.algorithm).toBe("ml-dsa-65");
    expect(report.message).toContain("supported: ed25519");
    // The boolean surface call sites still use reports the same rejection.
    expect(verifyAttestation(packet, future, keys.publicKey)).toBe(false);
    expect(supportedSignatureAlgorithms()).toEqual(["ed25519"]);
  });

  test("sig_scheme omitted still verifies (every existing v2 packet)", () => {
    const keys = generateAttestationKeypair();
    const packet = { project: "p", entries: [{ id: "m1" }] };
    const attestation = signPacket(packet, keys.privateKey);

    expect("sig_scheme" in attestation).toBe(false);
    expect(attestation.version).toBe(2);
    expect(verifyAttestationDetailed(packet, attestation, keys.publicKey)).toMatchObject({
      valid: true,
      algorithm: "ed25519",
    });
    expect(verifyAttestationChain([signPacket(packet, keys.privateKey, { head: true })], keys.publicKey)).toBe(true);
  });

  test("an explicit ed25519 verifies, and the field is not a downgrade vector", () => {
    const keys = generateAttestationKeypair();
    const packet = { n: 2 };
    const explicit = signPacket(packet, keys.privateKey, { scheme: "ed25519" });
    expect(explicit.sig_scheme).toBe("ed25519");
    expect(verifyAttestation(packet, explicit, keys.publicKey)).toBe(true);

    // ...and, because the default is normalised out of the signed bytes, adding
    // or removing the explicit "ed25519" spelling is a no-op either way. A
    // non-default scheme *is* covered — see the registry test below.
    const legacy = signPacket(packet, keys.privateKey);
    expect(verifyAttestation(packet, { ...legacy, sig_scheme: "ed25519" }, keys.publicKey)).toBe(true);
    // A scheme that disagrees with `algorithm` is rejected outright.
    const mismatch = verifyAttestationDetailed(packet, { ...legacy, sig_scheme: "ml-dsa-65" } as Attestation, keys.publicKey);
    expect(mismatch.reason).toBe("scheme_mismatch");
    const stripped = { ...explicit, sig_scheme: undefined } as Attestation;
    expect(verifyAttestation(packet, stripped, keys.publicKey)).toBe(true);
  });

  test("maxAgeDays rejects a stale signed packet and accepts a fresh one", () => {
    const keys = generateAttestationKeypair();
    const packet = { n: 3 };
    const fortyDaysAgo = new Date(Date.now() - 40 * 86_400_000);
    const stale = signPacket(packet, keys.privateKey, { at: fortyDaysAgo });

    // Off by default: age alone never invalidates an attestation.
    expect(verifyAttestation(packet, stale, keys.publicKey)).toBe(true);
    expect(verifyAttestation(packet, stale, keys.publicKey, { maxAgeDays: 30 })).toBe(false);
    const report = verifyAttestationDetailed(packet, stale, keys.publicKey, { maxAgeDays: 30 });
    expect(report.reason).toBe("expired");
    expect(report.ageDays).toBeGreaterThan(39);
    expect(report.ageDays).toBeLessThan(41);

    const fresh = signPacket(packet, keys.privateKey);
    expect(verifyAttestation(packet, fresh, keys.publicKey, { maxAgeDays: 30 })).toBe(true);
    expect(verifyAttestationChain([signPacket(packet, keys.privateKey, { head: true })], keys.publicKey, { maxAgeDays: 30 })).toBe(true);
    // The bound reaches chains too, and it is applied to the head.
    const staleChain = [signPacket({ step: 1 }, keys.privateKey, { at: fortyDaysAgo, head: true })];
    expect(verifyAttestationChain(staleChain, keys.publicKey, { maxAgeDays: 30 })).toBe(false);
    expect(() => verifyAttestation(packet, fresh, keys.publicKey, { maxAgeDays: -1 })).toThrow();
  });

  test("a tampered payload fails on the hash, an altered signed field on the signature", () => {
    const keys = generateAttestationKeypair();
    const packet = { entries: [{ id: "a" }] };
    const attestation = signPacket(packet, keys.privateKey);

    const tamperedPacket = verifyAttestationDetailed({ entries: [{ id: "b" }] }, attestation, keys.publicKey);
    expect(tamperedPacket.valid).toBe(false);
    expect(tamperedPacket.reason).toBe("packet_hash_mismatch");
    expect(tamperedPacket.reason).not.toBe("unsupported_algorithm");

    const tamperedField = verifyAttestationDetailed(packet, { ...attestation, signer: "mallory" }, keys.publicKey);
    expect(tamperedField.reason).toBe("signature_invalid");
    expect(tamperedField.reason).not.toBe("unsupported_algorithm");

    const badKey = verifyAttestationDetailed(packet, attestation, "not a pem");
    expect(badKey.reason).toBe("public_key_invalid");
  });

  test("a future verifier plugs into the registry without changing call sites", () => {
    const keys = generateAttestationKeypair();
    const packet = { n: 7 };
    const base = signPacket(packet, keys.privateKey);
    const ed25519 = getSignatureVerifier("ed25519");
    if (!ed25519) throw new Error("the ed25519 verifier must be registered");
    const payloads: string[] = [];
    const stub: SignatureVerifier = {
      algorithm: "test-stub",
      keyId: () => base.key_id,
      verify: (payload, signature) => {
        payloads.push(payload);
        return signature === "c3R1Yg==";
      },
    };
    const alias: SignatureVerifier = { algorithm: "test-alias", keyId: ed25519.keyId, verify: ed25519.verify };
    registerSignatureVerifier(stub);
    registerSignatureVerifier(alias);
    try {
      expect(() => registerSignatureVerifier(stub)).toThrow();
      const dispatched = { ...base, algorithm: "test-stub", signature: "c3R1Yg==" } as Attestation;
      expect(verifyAttestation(packet, dispatched, keys.publicKey)).toBe(true);
      expect(payloads).toHaveLength(1);
      expect(payloads[0]).toContain('"algorithm":"test-stub"');
      expect(verifyAttestation(packet, { ...dispatched, signature: "AAAA" }, keys.publicKey)).toBe(false);
      expect(supportedSignatureAlgorithms()).toEqual(["ed25519", "test-alias", "test-stub"]);

      // A genuine Ed25519 record relabelled as another *registered* scheme does
      // not verify: a non-default identifier is part of the signed bytes, so it
      // cannot be swapped, stripped or downgraded after signing.
      const relabelled = { ...base, algorithm: "test-alias", sig_scheme: "test-alias" } as Attestation;
      expect(verifyAttestationDetailed(packet, relabelled, keys.publicKey).reason).toBe("signature_invalid");
    } finally {
      expect(unregisterSignatureVerifier("test-stub")).toBe(true);
      expect(unregisterSignatureVerifier("test-alias")).toBe(true);
    }
    expect(supportedSignatureAlgorithms()).toEqual(["ed25519"]);
  });
});
