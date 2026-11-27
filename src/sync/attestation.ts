import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";

/**
 * Wire identifier of the legacy signature scheme, and the only one that ships
 * today. NIST IR 8547 final (2026-10-27) deprecates Ed25519 after 2030-12-31 and
 * disallows it after 2035-12-31, so the identifier is a registry key, never a
 * literal: see `docs/crypto-inventory.md` and issue #518.
 */
export const DEFAULT_SIGNATURE_SCHEME = "ed25519";

export interface Attestation {
  version: 2;
  /**
   * Legacy scheme identifier (v2 wire field). It must name the same scheme as
   * `sig_scheme` when both are present.
   */
  algorithm: string;
  /**
   * Optional signature scheme. Absent means `"ed25519"`, which is how every v2
   * packet written before this field existed keeps verifying byte for byte.
   * When it names a non-default scheme the value is covered by the signature,
   * so it cannot be added, stripped or downgraded after signing.
   */
  sig_scheme?: string;
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

/**
 * One algorithm the attestation envelope can be verified with. A verifier owns
 * everything that is algorithm-specific: how a key id is derived from a public
 * key, and how a signature over the canonical payload is checked. Adding a
 * scheme (for example ML-DSA-65) is a `registerSignatureVerifier` call — no
 * call site changes, because `verifyAttestation` dispatches on the identifier.
 */
export interface SignatureVerifier {
  /** Registry identifier, exactly as it appears in `sig_scheme` / `algorithm`. */
  readonly algorithm: string;
  /** Derive the advertised key id from an SPKI public key PEM. */
  keyId(publicKeyPem: string): string;
  /** Verify a base64 signature over the canonical payload string. */
  verify(payload: string, signatureB64: string, publicKeyPem: string): boolean;
}

const VERIFIERS = new Map<string, SignatureVerifier>();

/** Add a verifier to the registry. Re-registering an identifier is a bug, not a migration. */
export function registerSignatureVerifier(verifier: SignatureVerifier): void {
  if (typeof verifier?.algorithm !== "string" || verifier.algorithm.length === 0) {
    throw new Error("registerSignatureVerifier: the verifier must declare an algorithm identifier");
  }
  if (typeof verifier.keyId !== "function" || typeof verifier.verify !== "function") {
    throw new Error(`registerSignatureVerifier: '${verifier.algorithm}' must implement keyId() and verify()`);
  }
  if (VERIFIERS.has(verifier.algorithm)) {
    throw new Error(`registerSignatureVerifier: '${verifier.algorithm}' is already registered`);
  }
  VERIFIERS.set(verifier.algorithm, verifier);
}

/** Remove a verifier (tests, and operators retiring a scheme ahead of a release). */
export function unregisterSignatureVerifier(algorithm: string): boolean {
  return VERIFIERS.delete(algorithm);
}

/** Every algorithm the envelope can currently verify, sorted. */
export function supportedSignatureAlgorithms(): string[] {
  return [...VERIFIERS.keys()].sort();
}

export function getSignatureVerifier(algorithm: string): SignatureVerifier | undefined {
  return VERIFIERS.get(algorithm);
}

/**
 * The scheme a record asks to be verified with: `sig_scheme` when present, else
 * the legacy `algorithm` field, else the default.
 */
export function signatureSchemeOf(attestation: { algorithm?: string; sig_scheme?: string }): string {
  return attestation.sig_scheme ?? attestation.algorithm ?? DEFAULT_SIGNATURE_SCHEME;
}

const ED25519_VERIFIER: SignatureVerifier = {
  algorithm: "ed25519",
  keyId(publicKeyPem: string): string {
    const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
    return createHash("sha256").update(der).digest("hex").slice(0, 16);
  },
  verify(payload: string, signatureB64: string, publicKeyPem: string): boolean {
    try {
      return verify(null, Buffer.from(payload), publicKeyPem, Buffer.from(signatureB64, "base64"));
    } catch {
      return false;
    }
  },
};

registerSignatureVerifier(ED25519_VERIFIER);

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

export function keyIdFromPublicKey(publicKeyPem: string, algorithm: string = DEFAULT_SIGNATURE_SCHEME): string {
  const verifier = getSignatureVerifier(algorithm);
  if (!verifier) throw new Error(`keyIdFromPublicKey: no verifier registered for '${algorithm}'`);
  return verifier.keyId(publicKeyPem);
}

export function generateAttestationKeypair(): KeyPairPem {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function payloadOf(attestation: Omit<Attestation, "signature">): string {
  // `sig_scheme` enters the signed bytes only when it is not the legacy default.
  // Absence and an explicit "ed25519" therefore hash identically, which is what
  // keeps every pre-#518 v2 packet — and every chain built from one — valid,
  // while a non-default scheme stays covered by the signature.
  const sig_scheme = attestation.sig_scheme === DEFAULT_SIGNATURE_SCHEME ? undefined : attestation.sig_scheme;
  return DOMAIN + canonicalJson({
    version: attestation.version,
    algorithm: attestation.algorithm,
    sig_scheme,
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

export interface SignOptions {
  signer?: string;
  previous?: Attestation;
  audience?: string;
  head?: boolean;
  keyId?: string;
  /** Registry identifier to stamp into `sig_scheme`. Today only "ed25519" can sign. */
  scheme?: string;
  /** Override the signed `created_at` timestamp (deterministic tests, backfills). */
  at?: Date;
}

/** Sign a packet hash; `previous` extends a chain and forbids extending a head. */
export function signPacket(
  packet: unknown,
  privateKeyPem: string,
  options: SignOptions = {},
): Attestation {
  if (options.previous?.head) throw new Error("Cannot extend a chain after its head attestation");
  const scheme = options.scheme ?? DEFAULT_SIGNATURE_SCHEME;
  const verifier = getSignatureVerifier(scheme);
  if (!verifier) throw new Error(`signPacket: no signature scheme registered for '${scheme}'`);
  if (scheme !== DEFAULT_SIGNATURE_SCHEME) {
    throw new Error(`signPacket: signing with '${scheme}' is not implemented yet (register a signer with the verifier)`);
  }
  const packet_hash = hashPacket(packet);
  const prev_hash = options.previous?.chain_hash;
  const seq = (options.previous?.seq ?? -1) + 1;
  const chain_hash = createHash("sha256").update(`${prev_hash ?? "genesis"}:${seq}:${packet_hash}`).digest("hex");
  const createdAt = (options.at ?? new Date()).toISOString();
  const key_id = options.keyId ?? verifier.keyId(createPublicKey(privateKeyPem).export({ type: "spki", format: "pem" }).toString());
  const unsigned: Omit<Attestation, "signature"> = {
    version: 2,
    algorithm: DEFAULT_SIGNATURE_SCHEME,
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
  // Only an explicitly requested scheme is written, so an ed25519 attestation
  // produced without options keeps the exact pre-#518 JSON shape.
  if (options.scheme) unsigned.sig_scheme = options.scheme;
  const signature = sign(null, Buffer.from(payloadOf(unsigned)), privateKeyPem).toString("base64");
  return { ...unsigned, signature };
}

export interface VerifyOptions {
  expectedKeyId?: string;
  expectedAudience?: string;
  /**
   * Opt-in revocation proxy (issue #518): reject an attestation whose **signed**
   * `created_at` is older than this many days. Off by default (`undefined`).
   *
   * This is the practical way to stop trusting a key that was compromised after
   * it signed: re-verify with a bound instead of shipping a release. It bounds
   * replay of old packets, it does not revoke a key by itself — the long-term
   * answer is a rotation plus a shorter-lived envelope.
   */
  maxAgeDays?: number;
}

/** Machine-readable reason the first failing check produced. */
export type AttestationFailureReason =
  | "unsupported_algorithm"
  | "unsupported_version"
  | "scheme_mismatch"
  | "public_key_invalid"
  | "key_id_mismatch"
  | "packet_hash_mismatch"
  | "audience_mismatch"
  | "signature_invalid"
  | "expired";

export interface AttestationVerification {
  valid: boolean;
  /** The scheme the record was verified against — what `sig_scheme`/`algorithm` resolved to. */
  algorithm: string;
  /** First failing check; absent when `valid` is true. */
  reason?: AttestationFailureReason;
  /** Human-readable form of `reason`; absent when `valid` is true. */
  message?: string;
  /** Age of the signed timestamp in days, when it parses. */
  ageDays?: number;
}

const MS_PER_DAY = 86_400_000;

function failure(
  algorithm: string,
  reason: AttestationFailureReason,
  message: string,
  ageDays?: number,
): AttestationVerification {
  return { valid: false, algorithm, reason, message, ...(ageDays === undefined ? {} : { ageDays }) };
}

/**
 * Verify an attestation and report *why* it failed. This is the dispatcher:
 * the algorithm identifier selects a verifier from the registry, so an unknown
 * scheme is `unsupported_algorithm` — never a generic signature failure — and a
 * future scheme needs no change here or at any call site.
 */
export function verifyAttestationDetailed(
  packet: unknown,
  attestation: Attestation,
  publicKeyPem: string,
  options: VerifyOptions = {},
): AttestationVerification {
  if (options.maxAgeDays !== undefined && (!Number.isFinite(options.maxAgeDays) || options.maxAgeDays < 0)) {
    throw new RangeError("verifyAttestation: maxAgeDays must be a non-negative finite number");
  }
  if (!attestation || typeof attestation !== "object") {
    return failure(DEFAULT_SIGNATURE_SCHEME, "unsupported_version", "attestation is not an object");
  }
  const algorithm = signatureSchemeOf(attestation);
  if (attestation.version !== 2) {
    return failure(algorithm, "unsupported_version", `unsupported attestation version ${String(attestation.version)}; only 2 is accepted`);
  }
  if (attestation.sig_scheme !== undefined && attestation.algorithm !== undefined && attestation.sig_scheme !== attestation.algorithm) {
    return failure(
      algorithm,
      "scheme_mismatch",
      `sig_scheme '${attestation.sig_scheme}' disagrees with algorithm '${attestation.algorithm}'`,
    );
  }
  const verifier = getSignatureVerifier(algorithm);
  if (!verifier) {
    return failure(
      algorithm,
      "unsupported_algorithm",
      `no signature verifier is registered for '${algorithm}' (supported: ${supportedSignatureAlgorithms().join(", ")})`,
    );
  }
  let derivedKeyId: string;
  try {
    derivedKeyId = verifier.keyId(publicKeyPem);
  } catch {
    return failure(algorithm, "public_key_invalid", `the public key is not a valid ${algorithm} SPKI key`);
  }
  if (attestation.key_id !== derivedKeyId) {
    return failure(algorithm, "key_id_mismatch", `key_id '${attestation.key_id}' does not match the public key's '${derivedKeyId}'`);
  }
  if (options.expectedKeyId && attestation.key_id !== options.expectedKeyId) {
    return failure(algorithm, "key_id_mismatch", `key_id '${attestation.key_id}' is not the pinned '${options.expectedKeyId}'`);
  }
  if (options.expectedAudience && attestation.audience !== options.expectedAudience) {
    return failure(algorithm, "audience_mismatch", `audience '${attestation.audience}' is not the expected '${options.expectedAudience}'`);
  }
  let computedPacketHash: string;
  try {
    computedPacketHash = hashPacket(packet);
  } catch {
    return failure(algorithm, "packet_hash_mismatch", "the packet is not canonical JSON, so it cannot be hashed");
  }
  if (computedPacketHash !== attestation.packet_hash) {
    return failure(
      algorithm,
      "packet_hash_mismatch",
      `the packet hashes to ${computedPacketHash}, not the signed ${attestation.packet_hash}`,
    );
  }
  if (!verifier.verify(payloadOf(attestation), attestation.signature, publicKeyPem)) {
    return failure(algorithm, "signature_invalid", `the ${algorithm} signature does not verify over the signed payload`);
  }
  const createdAtMs = Date.parse(attestation.created_at);
  const ageDays = Number.isFinite(createdAtMs) ? (Date.now() - createdAtMs) / MS_PER_DAY : undefined;
  if (options.maxAgeDays !== undefined) {
    if (ageDays === undefined) {
      return failure(algorithm, "expired", `cannot enforce maxAgeDays: created_at '${String(attestation.created_at)}' is not a timestamp`);
    }
    if (ageDays > options.maxAgeDays) {
      return failure(
        algorithm,
        "expired",
        `attestation is ${ageDays.toFixed(1)} days old, past the ${options.maxAgeDays}-day bound`,
        ageDays,
      );
    }
  }
  return { valid: true, algorithm, ...(ageDays === undefined ? {} : { ageDays }) };
}

export function verifyAttestation(
  packet: unknown,
  attestation: Attestation,
  publicKeyPem: string,
  options: VerifyOptions = {},
): boolean {
  return verifyAttestationDetailed(packet, attestation, publicKeyPem, options).valid;
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
  if (options.maxAgeDays !== undefined && (!Number.isFinite(options.maxAgeDays) || options.maxAgeDays < 0)) {
    throw new RangeError("verifyAttestationChain: maxAgeDays must be a non-negative finite number");
  }
  // Key ids are derived per algorithm, once per chain.
  const keyIdsByAlgorithm = new Map<string, string | null>();
  const keyIdFor = (algorithm: string): string | null => {
    if (!keyIdsByAlgorithm.has(algorithm)) {
      const verifier = getSignatureVerifier(algorithm);
      if (!verifier) keyIdsByAlgorithm.set(algorithm, null);
      else {
        try {
          keyIdsByAlgorithm.set(algorithm, verifier.keyId(publicKeyPem));
        } catch {
          keyIdsByAlgorithm.set(algorithm, null);
        }
      }
    }
    return keyIdsByAlgorithm.get(algorithm) ?? null;
  };
  const requireHead = options.requireHead !== false;
  let previous: Attestation | undefined;
  for (const [index, attestation] of chain.entries()) {
    if (!attestation || typeof attestation !== "object" || attestation.version !== 2) return false;
    if (attestation.sig_scheme !== undefined && attestation.algorithm !== undefined && attestation.sig_scheme !== attestation.algorithm) {
      return false;
    }
    const algorithm = signatureSchemeOf(attestation);
    const verifier = getSignatureVerifier(algorithm);
    if (!verifier) return false;
    const expectedKeyId = options.expectedKeyId ?? keyIdFor(algorithm);
    if (expectedKeyId === null) return false;
    if (attestation.seq !== index) return false;
    if (attestation.key_id !== expectedKeyId) return false;
    if (options.expectedAudience && attestation.audience !== options.expectedAudience) return false;
    if (attestation.prev_hash !== previous?.chain_hash) return false;
    const expected = createHash("sha256").update(`${attestation.prev_hash ?? "genesis"}:${attestation.seq}:${attestation.packet_hash}`).digest("hex");
    if (attestation.chain_hash !== expected) return false;
    // Only the final record may be a head.
    if (attestation.head && index !== chain.length - 1) return false;
    if (!verifier.verify(payloadOf(attestation), attestation.signature, publicKeyPem)) return false;
    previous = attestation;
  }
  if (requireHead && !chain[chain.length - 1].head) return false;
  // A chain is only as trustworthy as its newest record, so the age bound is
  // applied to the head.
  if (options.maxAgeDays !== undefined) {
    const headMs = Date.parse(chain[chain.length - 1].created_at);
    if (!Number.isFinite(headMs)) return false;
    if ((Date.now() - headMs) / MS_PER_DAY > options.maxAgeDays) return false;
  }
  return true;
}
