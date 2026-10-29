# Wave 29: Sovereign LifeOS Migration & Complete Decommissioning Implementation Plan

> **Goal:** Migrate all personal identity, telos, operational rules, and hardware terrain scanning out of `~/.config/LIFEOS` into sovereign `musememory` engines, standalone native Vibeguard secret scanning, and de-LifeOSify global agent governance so `~/.config/LIFEOS` can be safely retired.
>
> **Scope:** Tickets `T-444`, `T-445`, `T-446`, `T-447`, and `T-448`.  
> **Tech Stack:** TypeScript, Bun (`bun test`, `bun run build`, `tsc --noEmit`), SQLite 3.

---

## Proposed Changes & File Layout

### 1. Ingestion Engine (`T-444`)
- Create: `src/cli/import_lifeos.ts`
- Modify: `src/cli.ts` (expose `import-lifeos`, alias `lifeos-import`)
- Create: `test/import_lifeos.test.ts`
- Target: Read `~/.config/LIFEOS/USER/`, distill into `~/.memory/USER.md` and SQLite memory store, sanitize with Vibeguard.

### 2. Native Vibeguard Secret Scanner CLI (`T-445`)
- Create: `src/cli/secrets.ts`
- Modify: `src/cli.ts` (expose `scan-secrets`, alias `secrets-scan`, `vibe-scan`)
- Create: `test/cli_secrets.test.ts`
- Target: Standalone secret scanning CLI replacing `~/.config/LIFEOS/runtime/TOOLS/SecretScan.ts`.

### 3. Machine Terrain Collector (`T-446`)
- Create: `src/vault/system.ts`
- Create: `src/vault/index.ts`
- Modify: `src/cli.ts` (expose `terrain` command)
- Create: `test/vault_system.test.ts`
- Target: Collect OS/hardware/runtime/agent ecosystem terrain into deterministic workspace maps.

### 4. Global `~/.agents/AGENTS.md` De-LifeOSification (`T-447`)
- Modify: `/home/harsh/.agents/AGENTS.md`
- Target: Eliminate all `@LIFEOS` imports, replace SecretScan path with `muse scan-secrets`, bind Single Source of Truth to `~/.memory/USER.md` and Muse Memory MCP.

### 5. Retirement Gate & Verification (`T-448`)
- Create: `docs/lifeos_retirement.md`
- Create: `test/lifeos_decommission_gate.test.ts`
- Modify: `.agents/context/ticket-plan.md` (mark Wave 29 completed)
- Modify: `.agents/context/current.md` (record Wave 29 milestone)

---

## Execution Plan & Tasks

### Task 1: T-444 · Sovereign LifeOS Ingestion Engine (`src/cli/import_lifeos.ts`)
- [ ] Write failing tests in `test/import_lifeos.test.ts` testing extraction of identity, telos, rules, and notes from a mock LIFEOS USER tree.
- [ ] Run `bun test test/import_lifeos.test.ts` to confirm test failure.
- [ ] Implement `src/cli/import_lifeos.ts` with `importLifeos()` and `handleImportLifeosCommand()`.
- [ ] Wire `import-lifeos` into `src/cli.ts` USAGE and switch statement.
- [ ] Run `bun test test/import_lifeos.test.ts` and confirm passing.
- [ ] Commit `feat(cli): Add sovereign LifeOS ingestion engine (T-444)`.

### Task 2: T-445 · Native Vibeguard CLI (`src/cli/secrets.ts`)
- [ ] Write failing tests in `test/cli_secrets.test.ts` covering directory recursion, ignore rules, secret detection, and output formatting.
- [ ] Run `bun test test/cli_secrets.test.ts` to confirm failure.
- [ ] Implement `src/cli/secrets.ts` with `executeSecretScan()` and `handleScanSecretsCommand()`.
- [ ] Wire `scan-secrets` into `src/cli.ts` USAGE and switch statement.
- [ ] Run `bun test test/cli_secrets.test.ts` and confirm passing.
- [ ] Commit `feat(secrets): Standalone Vibeguard secret scanner CLI (T-445)`.

### Task 3: T-446 · Machine Terrain Collector in `src/vault/` (`src/vault/system.ts`)
- [ ] Write failing tests in `test/vault_system.test.ts` verifying hardware inspection, toolchain detection, and markdown formatting.
- [ ] Run `bun test test/vault_system.test.ts` to confirm failure.
- [ ] Implement `src/vault/system.ts` and `src/vault/index.ts`.
- [ ] Wire `terrain` into `src/cli.ts`.
- [ ] Run `bun test test/vault_system.test.ts` and confirm passing.
- [ ] Commit `feat(vault): Machine terrain collector and workspace map generator (T-446)`.

### Task 4: T-447 · Global `~/.agents/AGENTS.md` De-LifeOSification
- [ ] Backup current `~/.agents/AGENTS.md` to `~/.agents/AGENTS.md.bak`.
- [ ] Update `~/.agents/AGENTS.md`:
  - Remove all 6 `@LIFEOS/...` imports.
  - Point Principal Identity to `~/.memory/USER.md`.
  - Update pre-ship secret scan directive to `muse scan-secrets`.
  - Replace legacy LifeOS Routing and Claude migration sections with Sovereign Muse Memory governance.
- [ ] Verify `~/.agents/AGENTS.md` contains 0 `@LIFEOS` imports.
- [ ] Commit documentation / config updates.

### Task 5: T-448 · LifeOS Decommissioning & Retirement Gate
- [ ] Author `docs/lifeos_retirement.md` with migration audit, backup instructions, and decommissioning proofs.
- [ ] Create `test/lifeos_decommission_gate.test.ts` asserting end-to-end sovereignty:
  - Validates `USER.md` schema and content.
  - Validates `scan-secrets` command execution.
  - Validates `~/.agents/AGENTS.md` purity.
- [ ] Run full test suite: `bun test` and `bunx tsc --noEmit`.
- [ ] Update `.agents/context/ticket-plan.md` marking T-444 through T-448 complete.
- [ ] Update `.agents/context/current.md`.
- [ ] Commit `chore(lifeos): Complete Wave 29 LifeOS retirement gate and documentation (T-448)`.
