# TECHNICAL_DEBT — Wave 27 audit (2026-11-09)

| # | Finding | Location | Fix |
|---|---|---|---|
| W27-1 | ~~Attestation chain truncatable/TOFU~~ **done**: signed seq + head, key-id pinning, `verify-chain` requires a head | `src/sync/attestation.ts` | — |
| W27-2 | ~~No enclave key rotation~~ **done**: versioned keyring, `enclave rotate`, `keys`/`prune`, backup drill | `src/store/enclaves.ts` | — |
| W27-3 | ~~Semantic merge poisoning~~ **done**: untrusted/self-asserted supersession and content inflation rejected; protected constraints never auto-resolve | `src/quality/branch_merge.ts` | — |
| W27-4 | ~~`scope: client` not wired~~ **descoped** per ADR-007; ticket/docs corrected | — | — |
| W27-5 | Overlay `.merged`/`.dropped` archives accumulate; no GC/listing | `src/store/branch.ts` | Retention sweep + `overlay archives` |
| W27-6 | Branch identity can fall back to `store.dir` when CLI omits `--branch` | `src/store/branch.ts` | Thread `ctx.root` through store-layer creation |
| W27-7 | No MCP surfaces for enclave/attest/overlay | `src/mcp.ts` | Read-only MCP tools with explicit project/client scope |
| W27-8 | Enclave put is read-modify-write without a lock; O(n²) | `src/store/enclaves.ts` | `withStoreLock` + batched put |
| W27-9 | Overlay plaintext archives at 0600 but no size caps | `src/store/branch.ts` | Entry/size caps |
