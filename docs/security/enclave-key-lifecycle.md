# Enclave Key Lifecycle Runbook

Scope: `.memory/enclaves/**` (AES-256-GCM client vaults). The key is store-wide;
there is no `scope: client` in the memory store (ADR-007).

## Files

| Path | Mode | Purpose |
|---|---|---|
| `.memory/enclave.keys/<key_id>.key` | 0600 | Versioned raw key (64 hex) |
| `.memory/enclave.active` | 0600 | Active key id |
| `.memory/enclave.key` | 0600 | Legacy single key (read-only fallback) |
| `.memory/enclaves/<client>/<division>.enc.json` | 0600 | Envelope with `key_id` + GCM AAD |

## Inspect

```bash
memory enclave keys
```

Output marks `active` and `referenced` (referenced = at least one envelope still
uses that key id). The active key is never unreferenced by definition.

## Rotate

```bash
memory enclave rotate                 # new key + re-encrypt every vault
memory enclave rotate --no-reencrypt  # switch active key, migrate lazily
```

Rotation is refused when `MUSE_ENCLAVE_KEY` is set (an env key cannot be
persisted). Every rotation writes an `enclave_rotate` audit event. Old keys
stay on disk for rollback.

## Prune

```bash
memory enclave keys
memory enclave prune --dry-run
memory enclave prune
```

`prune` removes only keys that are **not active and not referenced by any
envelope**. If a vault still references an old key, prune keeps it. Re-run
`rotate` (with re-encryption) and then prune.

## Backup

Copy these together — a vault without its key is unrecoverable:

```bash
tar -czf muse-enclaves-$(date +%F).tgz \
  .memory/enclaves .memory/enclave.keys .memory/enclave.active .memory/enclave.key
chmod 600 muse-enclaves-*.tgz
```

Restore into a fresh memory dir, then verify with `memory enclave list <client>`.
The backup/restore path is covered by `test/enclaves.test.ts`.

## Compromise

1. Rotate immediately: `memory enclave rotate` (re-encrypts all vaults).
2. Verify the old key id is no longer `referenced`: `memory enclave keys`.
3. `memory enclave prune` to delete the compromised key.
4. Revoke any attestation key that could sign handoffs; rotate it with
   `memory attest keygen --force` (this invalidates old attestations).
5. Preserve `enclave_rotate` / `enclave_prune` audit entries for incident review.

## Limits

- One store key decrypts every client vault. Isolation is at the file/AAD level,
  not per-client keys.
- There is no envelope archive GC or scheduled rotation.
- A lost key + no backup = permanent data loss.
