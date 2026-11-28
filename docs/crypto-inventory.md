# Cryptographic inventory

Every signature operation in musememory, the verifier behind it, its policy
position under NIST **IR 8547** (final, 2026-10-27), and the path to a
post-quantum scheme.

- **Owner:** [@harshsinghmp](https://github.com/harshsinghmp) (repository owner)
- **Review due:** **2027-01-31**, and again before any `feat(sync)` release
- **Scope:** the attestation envelope (`src/sync/attestation.ts`) and every
  caller — CLI, MCP, sync transport, tests
- **Source of truth:** the registry in
  [`src/sync/attestation.ts`](../src/sync/attestation.ts). If this page and the
  registry disagree, the registry wins and this page is wrong.

## Algorithm policy

NIST IR 8547 final removed the draft's exemption for 128-bit classical
parameters, so Ed25519 is **deprecated after 2030** and **disallowed after
2035** — it is no longer a "deprecated but exempt" curve of the kind the draft
would have let a deployment keep forever.

| Date (UTC) | Obligation | What it means here |
| --- | --- | --- |
| 2026-10-27 | IR 8547 final published | This inventory, the registry and the `sig_scheme` envelope exist (issue #518). Ed25519 remains the only registered scheme. |
| **2030-12-31** | **Ed25519 deprecated** | Stop issuing new Ed25519 attestations. Verification of records already signed must keep working. |
| **2031-01-01** | **Risk-acceptance obligation** | Any deployment that still depends on Ed25519 — including verify-only — must document the accepted risk and its migration date. The plan below is to have signing migrated before this date so the obligation is never triggered for new records. |
| **2035-12-31** | **Ed25519 disallowed** | Remove the `"ed25519"` entry from the verifier registry. After this date an Ed25519 attestation is `unsupported_algorithm`, by design. |

Policy in one sentence: **one scheme may sign at a time, verification may
outlive signing, and the identifier on the wire is what selects the verifier.**

## The registry

`src/sync/attestation.ts` dispatches on the algorithm identifier instead of
comparing against a string literal:

```ts
export interface SignatureVerifier {
  readonly algorithm: string;                  // exact wire identifier
  keyId(publicKeyPem: string): string;         // algorithm-scoped key id
  verify(payload: string, signatureB64: string, publicKeyPem: string): boolean;
}
```

`registerSignatureVerifier()` populates the map, `getSignatureVerifier()` reads
it, `supportedSignatureAlgorithms()` lists it, and both
`verifyAttestationDetailed()` and `verifyAttestationChain()` resolve the scheme
from `sig_scheme ?? algorithm ?? "ed25519"` and dispatch. An identifier with no
verifier returns the distinct reason **`unsupported_algorithm`** — never a
generic signature failure — so a caller can tell "this build is too old to judge
this record" from "the bytes are wrong".

The envelope gained one optional field, `sig_scheme`. Missing means `"ed25519"`,
which is why **every existing v2 packet and chain keeps verifying byte for
byte**: `created_at`, `key_id`, `chain_hash` and the signed payload are
unchanged, and `protocol_version`/`version: 2` was deliberately **not** bumped.
`sig_scheme` is signed whenever it names a non-default scheme, so it cannot be
added, stripped or downgraded after signing; the default spelling is normalised
out of the signed bytes, so omitting it and writing `"ed25519"` are equivalent.

## Inventory

| # | Use | Where | Verifier / primitive | Policy | Migration note |
| --- | --- | --- | --- | --- | --- |
| 1 | **Attestation signing** (new records) | `signPacket()` in `src/sync/attestation.ts`; `memory attest sign` in `src/cli/attest.ts` | Ed25519 — `node:crypto` `sign(null, data, pkcs8Pem)` | Allowed until 2030-12-31, deprecated after, disallowed 2035-12-31 | Needs a *signer*, not just a verifier: `signPacket({ scheme })` throws today for any scheme other than `"ed25519"`. |
| 2 | **Attestation verification** (single record) | `verifyAttestationDetailed()` / `verifyAttestation()` | `ED25519_VERIFIER.verify()` → `node:crypto` `verify(null, …)` | Verify-only keeps working past the 2030 deprecation; removed 2035-12-31 | New schemes are one `registerSignatureVerifier()` call; no call site changes. |
| 3 | **Attestation chain verification** | `verifyAttestationChain()` (`src/sync/attestation.ts`), `src/sync/engine.ts` | Ed25519 per record, resolved through the registry | Same as #2 | Key ids are derived per algorithm, once per chain, so a chain may mix schemes during a transition. |
| 4 | **Key id derivation** | `keyIdFromPublicKey()` / `SignatureVerifier.keyId()` | `SHA-256(SPKI DER)` truncated to 16 hex chars | Tied to the scheme, not to Ed25519 | Not a signature — it is a 64-bit-truncated digest used as a name. A future verifier must define its own derivation so two schemes cannot mint the same id for the same key bytes. |
| 5 | **Key generation** | `generateAttestationKeypair()`; `memory attest keygen [--force]` | `node:crypto` `generateKeyPairSync("ed25519")`, PKCS#8 + SPKI PEM, `0600` private key | Same as #1 | Rotation is `--force`; old attestations stop verifying, which is the intended (loud) behaviour. |
| 6 | **Sync peer trust anchor** | `src/sync/engine.ts` (`ingestKnowledge`) | `verifyAttestation` / `verifyAttestationChain` against `MUSE_SYNC_ATTESTATION_PUBLIC_KEY` or `<memory_dir>/sync/attestation.pub` | Same as #2 | An env var or a file, so the anchor can be rotated without a release. |
| 7 | **MCP surface** | `muse_attestation_verify` in `src/mcp/catalog.ts` + `src/mcp/dispatch.ts` | Read-only, inline public key only (never a model-supplied path) | Same as #2 | Returns the machine-readable `reason`, so `unsupported_algorithm` is visible over MCP, plus optional `max_age_days`. |
| 8 | **CLI surface** | `memory attest verify` / `verify-chain` in `src/cli/attest.ts` | Same as #2 | Same as #2 | Prints `valid (…, ed25519)` or `invalid (<reason>: <message>)`; `--max-age-days N` is the revocation proxy. |
| 9 | **Test surface** | `test/attestation.test.ts`, `test/sync_ingest_trust.test.ts`, `test/mcp_readonly_surfaces.test.ts` | Registry + Ed25519 | — | Mutation-verified per PR: removing the registry dispatch or the age bound turns the respective case red. |

### Not signature algorithms (recorded so the next audit need not re-derive it)

- **Packet and chain digests** — SHA-256 in `hashPacket()` and the chain hash.
  Collision resistance is the only property required; no migration needed.
- **Key ids** — a truncated digest, covered above.
- **Enclave storage** — AES-256-GCM with scrypt-derived keys
  (`src/store/enclaves.ts`). Symmetric confidentiality, not authentication of a
  peer, and not in scope for the PQ signature migration.
- **Bearer tokens** — the MCP/Studio tokens are opaque shared secrets compared
  in-process. There is **no JWT, no signed cookie and no HMAC token format** in
  the tree (`grep -rn 'createHmac\|jsonwebtoken' src/` is empty), so there is no
  Ed25519 token signing to migrate.

## Revocation proxy: `maxAgeDays`

An Ed25519 attestation is valid forever. That is a problem the day a key is
compromised: every packet it ever signed still verifies, and rotating the key
does not retroactively invalidate them.

`VerifyOptions.maxAgeDays` (and `ChainVerifyOptions.maxAgeDays`, applied to the
chain head) rejects an attestation whose **signed** `created_at` is older than
the bound. It is **off by default**, so nothing changes unless a caller asks:

```bash
memory attest verify packet.json attestation.json --pub attestation.pub --max-age-days 30
```

```jsonc
// muse_attestation_verify
{ "public_key": "-----BEGIN PUBLIC KEY-----…", "packet": {…}, "attestation": {…}, "max_age_days": 30 }
```

This is the practical way to distrust a compromised key **without shipping a
release**: the freshness policy lives in the caller's configuration (a cron, a
CI job, a peer's sync config), so tightening it from 365 days to 7 days is a
config change, not a version bump. It bounds replay of old packets; it does not
revoke a key by itself, and it cannot express "everything signed before
2026-11-01 12:00 is void". The durable answer remains a short-lived envelope
plus key rotation.

## Planned post-quantum path

| Phase | When | What ships | Gate |
| --- | --- | --- | --- |
| 0 | **Done** (issue #518) | Registry dispatch, optional `sig_scheme`, `maxAgeDays`, this inventory | Unknown algorithms are `unsupported_algorithm`; v2 packets unchanged |
| 1 | 2027 H1 | **ML-DSA-65 (FIPS 204) verifier** behind the registry, verify-only | Interop vectors from the FIPS 204 ACVP set; a recorded decision on the library (see below) |
| 2 | 2027 H2 | **Hybrid dual signing** — `sig_scheme: "ed25519+ml-dsa-65"`, both signatures over the same payload | Peers accept hybrid before anyone emits it; downgrade to `ed25519` alone is detected |
| 3 | 2029, before 2030-12-31 | ML-DSA-65 becomes the default signer; Ed25519 signing behind an explicit flag | New records no longer rely on a deprecated algorithm before the risk-acceptance date |
| 4 | 2031-01-01 | No further action expected; if any deployment still relies on Ed25519 (verify-only included), record a risk acceptance referencing this page | Documented risk acceptance, per IR 8547 |
| 5 | 2035-12-31 | Remove `"ed25519"` from the registry | Ed25519 records become `unsupported_algorithm` |

**No post-quantum dependency is added today.** `node:crypto` (OpenSSL 3.x) does
not expose ML-DSA, so phase 1 has to choose between a vetted dependency and a
Node release that ships it; that is a supply-chain decision with its own review,
and it must not be made implicitly by an attestation refactor. Phase 0 exists so
that decision can be made later without touching a single call site.

## What a future ML-DSA verifier must implement

1. **`algorithm`** — the exact wire string (`"ml-dsa-65"`, or the composite
   `"ed25519+ml-dsa-65"`). It is the registry key and the value compared against
   `sig_scheme`/`algorithm`; changing it later is a wire break.
2. **`keyId(publicKeyPem)`** — deterministic, algorithm-scoped, and documented
   in this table. It must not collide with an Ed25519 key id for the same key
   bytes (the Ed25519 derivation is `SHA-256(SPKI DER)[0..16]`, so a new scheme
   needs its own truncation or a domain prefix).
3. **`verify(payload, signatureB64, publicKeyPem)`** — receives the **exact**
   canonical payload string (`"muse-attestation-v2\0" + canonicalJson({…})`). It
   must not re-canonicalise, must accept the scheme's own signature encoding
   (base64 for a single signature; a documented composite such as
   `"<ed25519>.<ml-dsa-65>"` for a hybrid), must return `false` — never throw —
   on a malformed key, malformed signature or length mismatch, and must not
   consult ambient state.
4. **Registration** — one `registerSignatureVerifier()` call at module load,
   which then appears in `supportedSignatureAlgorithms()` (and therefore in the
   `unsupported_algorithm` message) with no change to `verifyAttestation`,
   `verifyAttestationChain`, the sync engine, the CLI or the MCP tool.
5. **Signing counterpart** — verification is not signing. `signPacket()` throws
   for a scheme with no signer, so issuing ML-DSA attestations also needs a
   signer registered (phase 2/3), plus a migration that re-signs chains rather
   than rewriting them (the chain hash covers `packet_hash`, `seq` and
   `prev_hash`, not the signature bytes).
6. **Policy tests** — an unknown-algorithm case, a hybrid-downgrade case, a
   `maxAgeDays` case and a tampered-payload case, the same four that gate this
   change in `test/attestation.test.ts`.
