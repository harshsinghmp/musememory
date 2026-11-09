# TECHNICAL_DEBT — Wave 27 audit (2026-11-09)

| # | Finding | Location | Fix |
|---|---|---|---|
| W27-1 | ~~Attestation chain truncatable/TOFU~~ **done**: signed seq + head, key-id pinning, `verify-chain` requires a head | `src/sync/attestation.ts` | — |
| W27-2 | ~~No enclave key rotation~~ **done**: versioned keyring, `enclave rotate`, `keys`/`prune`, backup drill | `src/store/enclaves.ts` | — |
| W27-3 | ~~Semantic merge poisoning~~ **done**: untrusted/self-asserted supersession and content inflation rejected; protected constraints never auto-resolve | `src/quality/branch_merge.ts` | — |
| W27-4 | ~~`scope: client` not wired~~ **descoped** per ADR-007; ticket/docs corrected | — | — |
| W27-5 | ~~Overlay archives accumulate~~ **done**: `overlay prune --max-age-days` | `src/store/branch.ts` | — |
| W27-6 | ~~Branch identity from `store.dir`~~ **done**: resolves from the workspace root | `src/store/branch.ts` | — |
| W27-7 | ~~No MCP surfaces for enclave/attest/overlay~~ **done**: read-only `muse_enclave_recall` (client required, audited), `muse_overlay_status`, `muse_attestation_verify` (inline key only) | `src/mcp.ts` | — |
| W27-8 | **partially done**: `put` now holds `withStoreLock`; whole-vault rewrite remains | `src/store/enclaves.ts` | Batched put / per-entry files |
| W27-9 | Overlay plaintext archives at 0600 but no size caps | `src/store/branch.ts` | Entry/size caps |
