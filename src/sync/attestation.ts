import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";

export interface Attestation {
  version: 1;
  algorithm: "ed25519";
  signer: string;
  packet_hash: string;
  prev_hash?: string;
  chain_hash: string;
  created_at: string;
  signature: string;
}

export interface KeyPairPem {
  publicKey: string;
  privateKey: string;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

/** Content address of a packet; the attestation never needs the body again. */
export function hashPacket(packet: unknown): string {
  return createHash("sha256").update(canonicalJson(packet)).digest("hex");
}

export function generateAttestationKeypair(): KeyPairPem {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/** Attest only the content hash; the packet body is not embedded. */
export function signPacket(
  packet: unknown,
  privateKeyPem: string,
  options: { signer?: string; previous?: Attestation } = {},
): Attestation {
  const packet_hash = hashPacket(packet);
  const prev_hash = options.previous?.chain_hash;
  const chain_hash = createHash("sha256").update(`${prev_hash ?? "genesis"}:${packet_hash}`).digest("hex");
  const createdAt = new Date().toISOString();
  const payload = canonicalJson({ packet_hash, prev_hash, chain_hash, created_at: createdAt, signer: options.signer ?? "musememory" });
  const signature = sign(null, Buffer.from(payload), privateKeyPem).toString("base64");
  return {
    version: 1,
    algorithm: "ed25519",
    signer: options.signer ?? "musememory",
    packet_hash,
    prev_hash,
    chain_hash,
    created_at: createdAt,
    signature,
  };
}

function attestationPayload(attestation: Attestation): string {
  return canonicalJson({
    packet_hash: attestation.packet_hash,
    prev_hash: attestation.prev_hash,
    chain_hash: attestation.chain_hash,
    created_at: attestation.created_at,
    signer: attestation.signer,
  });
}

export function verifyAttestation(
  packet: unknown,
  attestation: Attestation,
  publicKeyPem: string,
): boolean {
  if (attestation.algorithm !== "ed25519" || attestation.version !== 1) return false;
  if (hashPacket(packet) !== attestation.packet_hash) return false;
  try {
    return verify(null, Buffer.from(attestationPayload(attestation)), publicKeyPem, Buffer.from(attestation.signature, "base64"));
  } catch {
    return false;
  }
}

/** Verify order and linkage of an attestation chain. */
export function verifyAttestationChain(chain: Attestation[], publicKeyPem: string): boolean {
  let previous: Attestation | undefined;
  for (const attestation of chain) {
    if (attestation.prev_hash !== previous?.chain_hash) return false;
    const expected = createHash("sha256").update(`${attestation.prev_hash ?? "genesis"}:${attestation.packet_hash}`).digest("hex");
    if (attestation.chain_hash !== expected) return false;
    try {
      if (!verify(null, Buffer.from(attestationPayload(attestation)), publicKeyPem, Buffer.from(attestation.signature, "base64"))) {
        return false;
      }
    } catch {
      return false;
    }
    previous = attestation;
  }
  return true;
}
