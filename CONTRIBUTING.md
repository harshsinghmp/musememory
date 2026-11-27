# Contributing to aimm

## Branch & PR model
- **One PR per feature.** Branch `feat/*` or `fix/*` off `dev`. Never commit directly to `main`, `master`, or `dev`.
- **Execution granularity: one branch per ticket** (`fix/T-xxx`) — every commit must pass the full gate: `bun test`, `bunx tsc --noEmit`, `bun run build`.
- **Per-phase parallel work**: implementation phases dispatch multiple subagents, each in its own worktree. The orchestrator reconciles results into the ticket branch.

## After a feature merges to `dev`
Run in this order, end-to-end:
1. `updatedocs` skill — complete mode (docs ↔ code drift sync).
2. `updateagents` skill — all modes (AGENTS.md + `.agents/` context sync).
3. `git` skill — end-to-end, **stopping before release** (release is principal-confirmed).

Then update CHANGELOG.md, this file, and credits as needed (behavioral changes, dependencies, contributors, process changes).

## Commit format
`<type>(<scope>): <summary>` with Why / What / Verification blocks. English only. No secrets — ever (see `.agents/standards/security-vibeguard.md`).

## Test fixtures and secret-shaped strings
Tests that exercise redaction, attestation and credential handling need inputs that *look* like secrets. Those strings are the reason `.gitleaks.toml` allowlists `test/` and `docs/` — and they are also the easiest way to leak a real one. Four rules:

1. **Prefix synthetic values with `TEST_ONLY_`.** A reviewer and a scanner both read `TEST_ONLY_sk-ant-…` as a fixture, not as a credential someone pasted from `.env`.
2. **Compose token-shaped strings at runtime.** `"sk-ant-" + "x".repeat(24)`, not a single literal that matches a detector's pattern. The behaviour under test is identical and the committed source contains no complete token shape.
3. **Never copy a real credential, not even truncated, not even in a comment.** A prefix plus a suffix is still a credential to an attacker with the middle. If a real value reached a commit, rotate it — an allowlist entry is not a fix.
4. **Expect the scanner to report fixture hits.** The repo's own scan reports the synthetic corpus in `test/` **by design**; that visibility is the point, and a human reviews it. `src/` has no such exemption and must stay clean — a hit there is a finding, not noise.

The allowlist in `.gitleaks.toml` is path-scoped (`^test/`, `^docs/`) and extends the default rules rather than replacing them. Widening it to make a scan green is a security change disguised as a config change; don't.
