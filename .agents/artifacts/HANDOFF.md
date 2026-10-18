# HANDOFF — 2026-10-19T02:12:00Z
branch: dev @ 22002ba | phase: Wave 15 complete; dev green 948/0

## Next Step
Advance to Wave 16 (Temporal Transitions, Contradiction Engine & Verbs: T-082–T-086).

## In-Flight
- Wave 15 landed on dev via Ticket=Issue=Branch=PR=Merge (PRs #200–#216):
  - T-072: FTS5-tokenizer-matched abstention gate (PR #200)
  - T-073: no_confident_match result mode across retrieval & MCP (PR #202)
  - T-074: Materialized decay_score & importance-gated half-lives (PR #204)
  - T-076: Bayesian corroboration confidence C(n) = 1 - 0.7^n (PR #206)
  - T-077: Trust-tier-keyed half-life T1 365d → T4 30d (PR #208)
  - T-078: Per-type default expires_at (fix 90d, op 180d, arch 365d, disc 30d) (PR #210)
  - T-079: Stamped expiry status, expired_at, and expired_by rule name (PR #212)
  - T-080: Pin-capable first-match-wins expiry policy YAML engine (PR #214)
  - T-081: Optional Weibull per-type hazard curves R(t) = exp(-(t/λ)^k) (PR #216)
- Docs pass: docs/expiry-decay-and-confidence.md, user-guide.md, README.md (948 passed).

## Decisions
- Calibration invariant: λ = t_half / (ln 2)^(1/k) guarantees R(t_half) = 0.5 for all k.
- OWASP ASI06 defense: untrusted sources decay at 30d half-life; pin exemptions never expire.

## Verify
`bun test` 948/0 + `bunx tsc --noEmit` + `bun run build`
