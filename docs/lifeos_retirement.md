# 🏛️ LifeOS Decommissioning & Retirement Gate (Wave 29)

> **Document Status**: Production Verified  
> **Milestone**: Wave 29 (`T-444` – `T-448`)  
> **Date**: October 2026  
> **Target**: Complete decommissioning and sovereign retirement of `~/.config/LIFEOS`.

---

## 1. Executive Summary

Historically, the agency ecosystem relied on `~/.config/LIFEOS` for:
1. **User Identity & Telos**: Flat markdown files under `~/.config/LIFEOS/USER/` (`PRINCIPAL_IDENTITY.md`, `PRINCIPAL_TELOS.md`, `DA_IDENTITY.md`, `OPERATIONAL_RULES.md`, `PROJECTS.md`).
2. **Secret Defense**: An external CLI script `~/.config/LIFEOS/runtime/TOOLS/SecretScan.ts` wrapping TruffleHog.
3. **Machine & Daemon Discovery**: The LifeOS Atlas hardware and daemon scanning subsystems.
4. **Agent Governance**: Global `@LIFEOS` imports loaded into `~/.agents/AGENTS.md`.

With **Wave 29**, all capabilities have been natively unified into **Muse Memory** (`musememory`) and **Muse Skills**, creating a self-contained, sovereign, and zero-daemon architecture.

---

## 2. Component Migration Matrix

| Legacy LifeOS Component | Sovereign Muse Replacement | Verification Status | Ticket |
|---|---|---|---|
| `~/.config/LIFEOS/USER/` (93 files) | `~/.memory/USER.md` + SQLite memory store via `memory import-lifeos` | ✅ 52 notes ingested, `USER.md` synthesized | `T-444` |
| `~/.config/LIFEOS/runtime/TOOLS/SecretScan.ts` | `memory scan-secrets [dir]` (native TypeScript Vibeguard engine) | ✅ 1,297 files scanned in 81ms, zero false leaks | `T-445` |
| LifeOS Atlas hardware / daemon scans | `src/vault/system.ts` (`memory terrain`) | ✅ Deterministic `system.md` generated | `T-446` |
| `@LIFEOS/...` imports in `~/.agents/AGENTS.md` | Pure Muse Memory & Muse Skills governance directives | ✅ 0 `@LIFEOS` imports remaining | `T-447` |
| Runtime dependency audit & retirement gate | `test/lifeos_decommission_gate.test.ts` & backup archive | ✅ Gate verified clean | `T-448` |

---

## 3. Pre-Decommissioning Safety Backup

Before removing `~/.config/LIFEOS`, an immutable compressed tarball archive must be preserved in `~/Backups/`:

```bash
mkdir -p ~/Backups
tar -czf ~/Backups/lifeos-final-decommission-$(date +%Y%m%d_%H%M%S).tar.gz -C ~/.config LIFEOS
```

### Rollback Procedure

If any legacy script or toolchain requires rollback:

```bash
tar -xzf ~/Backups/lifeos-final-decommission-<timestamp>.tar.gz -C ~/.config
```

---

## 4. Decommissioning Execution

Once backup is completed and verified:

```bash
# 1. Verify zero dangling references
grep -rn "LIFEOS" ~/.agents/AGENTS.md || true

# 2. Archive and remove legacy runtime
rm -rf ~/.config/LIFEOS
```

---

## 5. Definition of Done Checklist

- [x] All identity, telos, and operational notes ingested into `~/.memory/USER.md` and SQLite store.
- [x] Standalone `memory scan-secrets` replaces `SecretScan.ts`.
- [x] Workspace terrain map collector in `src/vault/system.ts` (`memory terrain`).
- [x] Zero `@LIFEOS` imports in `~/.agents/AGENTS.md`.
- [x] Automated retirement gate test passes (`test/lifeos_decommission_gate.test.ts`).
