# ACCEPTANCE PACKET — Wave 27 hardening

**Status: CAPPED.** Code review and muse-security both rejected the first cut; blockers were fixed and re-gated. No second critic round.

Receipts: 1521/0 tests; tsc clean; build 434 modules; secret scan clean. Crypto: GCM AAD + key id, Ed25519 domain-separated signatures, strict tenant/branch names, 0600/0700 files, overlay merge through the three-way resolver with audit.

Residual: `TECHNICAL_DEBT-wave27.md` (chain truncation/TOFU, key rotation, semantic merge poisoning, scope:client not wired, overlay GC, branch identity from store.dir).
