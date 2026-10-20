# Contributing to Muse Memory

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
