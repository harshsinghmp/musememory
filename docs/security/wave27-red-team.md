# Wave 27 Red-Team Notes (2026-11-09)

Covered by automated tests:

| Attack | Test | Control |
|---|---|---|
| Client/division name collision | `test/enclaves.test.ts` lossy-name cases | Strict name grammar; reject, don't rewrite |
| Vault relabeling | same file, `client-b` read | GCM AAD + metadata assertion |
| Envelope tamper | ciphertext mutation | GCM auth tag failure |
| Missing key | lazy rotation + key deletion | typed `Missing enclave key` error |
| Cross-branch overlay collision | `test/branch_overlays.test.ts` | base64url filenames + identity check |
| Merge poisoning (inflation/supersession) | `test/branch_merge.test.ts` | strict extension + protected/trusted guards |
| Attestation truncation/key substitution | `test/attestation.test.ts` | signed seq/head + key-id pinning |
| Agent prompt injection via memory text | `test/security_context.test.ts` | sanitizer, data envelope, read-time redaction |

Open residual risks are tracked in `.agents/artifacts/TECHNICAL_DEBT-wave27.md`.
