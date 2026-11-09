import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";

export interface Attestation {
  version: 2;
  algorithm: "ed25519";
  signer: string;
  key_id: string;
  audience: string;
  seq: number;
  packet_hash: string;
  prev_hash?: string;
  chain_hash: string;
  created_at: string;
  /** Terminal marker: a chain is truncated unless its last record is a head. */
  head: boolean;
  signature: string;
}

export interface KeyPairPem {
  publicKey: string;
  privateKey: string;
}

const DOMAIN = "muse-attestation-v2\0";

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonicalJson: non-finite number");
    if (!Number.isSafeInteger(value) && Number.isInteger(value)) throw new Error("canonicalJson: unsafe integer");
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value !== "object") throw new Error(`canonicalJson: unsupported ${typeof value}`);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("canonicalJson: only plain objects are supported");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function hashPacket(packet: unknown): string {
  return createHash("sha256").update(canonicalJson(packet)).digest("hex");
}

export function keyIdFromPublicKey(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex").slice(0, 16);
}

export function generateAttestationKeypair(): KeyPairPem {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function payloadOf(attestation: Omit<Attestation, "signature">): string {
  return DOMAIN + canonicalJson({
    version: attestation.version,
    algorithm: attestation.algorithm,
    signer: attestation.signer,
    key_id: attestation.key_id,
    audience: attestation.audience,
    seq: attestation.seq,
    packet_hash: attestation.packet_hash,
    prev_hash: attestation.prev_hash,
    chain_hash: attestation.chain_hash,
    created_at: attestation.created_at,
    head: attestation.head,
  });
}

/** Sign a packet hash; `previous` extends a chain and forbids extending a head. */
export function signPacket(
  packet: unknown,
  privateKeyPem: string,
  options: { signer?: string; previous?: Attestation; audience?: string; head?: boolean; keyId?: string } = {},
): Attestation {
  if (options.previous?.head) throw new Error("Cannot extend a chain after its head attestation");
  const packet_hash = hashPacket(packet);
  const prev_hash = options.previous?.chain_hash;
  const seq = (options.previous?.seq ?? -1) + 1;
  const chain_hash = createHash("sha256").update(`${prev_hash ?? "genesis"}:${seq}:${packet_hash}`).digest("hex");
  const createdAt = new Date().toISOString();
  const publicKey = createPublicKey(privateKeyPem);
  const key_id = options.keyId ?? createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex").slice(0, 16);
  const unsigned = {
    version: 2 as const,
    algorithm: "ed25519" as const,
    signer: options.signer ?? "musememory",
    key_id,
    audience: options.audience ?? "musememory",
    seq,
    packet_hash,
    prev_hash,
    chain_hash,
    created_at: createdAt,
    head: options.head === true,
  };
  const signature = sign(null, Buffer.from(payloadOf(unsigned)), privateKeyPem).toString("base64");
  return { ...unsigned, signature };
}

export interface VerifyOptions {
  expectedKeyId?: string;
  expectedAudience?: string;
}

export function verifyAttestation(
  packet: unknown,
  attestation: Attestation,
  publicKeyPem: string,
  options: VerifyOptions = {},
): boolean {
  if (attestation.algorithm !== "ed25519" || attestation.version !== 2) return false;
  if (hashPacket(packet) !== attestation.packet_hash) return false;
  if (attestation.key_id !== keyIdFromPublicKey(publicKeyPem)) return false;
  if (options.expectedKeyId && attestation.key_id !== options.expectedKeyId) return false;
  if (options.expectedAudience && attestation.audience !== options.expectedAudience) return false;
  try {
    return verify(
      null,
      Buffer.from(payloadOf(attestation)),
      publicKeyPem,
      Buffer.from(attestation.signature, "base64"),
    );
  } catch {
    return false;
  }
}

export interface ChainVerifyOptions extends VerifyOptions {
  /** Require the last record to be a signed head (default true). */
  requireHead?: boolean;
}

/** Verify sequence, linkage, signatures and (by default) a signed terminal head. */
export function verifyAttestationChain(
  chain: Attestation[],
  publicKeyPem: string,
  options: ChainVerifyOptions = {},
): boolean {
  if (!Array.isArray(chain) || chain.length === 0) return false;
  const expectedKeyId = options.expectedKeyId ?? keyIdFromPublicKey(publicKeyPem);
  const requireHead = options.requireHead !== false;
  let previous: Attestation | undefined;
  for (const [index, attestation] of chain.entries()) {
    if (attestation.version !== 2 || attestation.algorithm !== "ed25519") return false;
    if (attestation.seq !== index) return false;
    if (attestation.key_id !== expectedKeyId) return false;
    if (options.expectedAudience && attestation.audience !== options.expectedAudience) return false;
    if (attestation.prev_hash !== previous?.chain_hash) return false;
    const expected = createHash("sha256").update(`${attestation.prev_hash ?? "genesis"}:${attestation.seq}:${attestation.packet_hash}`).digest("hex");
    if (attestation.chain_hash !== expected) return false;
    // Only the final record may be a head.
    if (attestation.head && index !== chain.length - 1) return false;
    try {
      if (!verify(null, Buffer.from(payloadOf(attestation)), publicKeyPem, Buffer.from(attestation.signature, "base64"))) {
        return false;
      }
    } catch {
      return false;
    }
    previous = attestation;
  }
  if (requireHead && !chain[chain.length - 1].head) return false;
  return true;
}
