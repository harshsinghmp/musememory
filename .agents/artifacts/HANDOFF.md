# HANDOFF — 2026-10-22T17:55:00Z
branch: dev | phase: Waves 23, 24 and 25 landed on `dev` via PR #315 (v3.0.2 on `package.json`; the work sits under `[Unreleased]`)

## Next Step
Cut the release. The engine changes are merged but unreleased: `package.json`
is still `3.0.2` and `CHANGELOG.md` carries T-320, T-321 and the Wave 25
surface completion under `[Unreleased]`. Per `.agents/standards/workflows.md`,
release cutting is principal-confirmed only — do not tag or publish
unprompted.

## In-Flight
- **PR #315 merged** into `dev` at `8092ae6`. It landed:
  - **Wave 23 / T-320** — the contradiction engine now compares *polarity
    claims* (subject, relation, target, scope) instead of seven bare regex
    pairs. Measured 8/10 realistic non-contradictory pairs flagged before,
    0/10 after. Calibration fixture `test/calibration/contradiction_calibration.json`
    (21 pairs) gated at precision/recall ≥ 0.9. Dry-run surfaces:
    `memory conflicts [--dry-run]`, `propose({conflictDryRun})`,
    `detectConflict(…, {dryRun})`.
  - **Wave 24 / T-321** — the health gate is scoped to one memory project.
    `listForProject()` (`src/store.ts`) owns the filter decision; the report
    carries `scope` (`filter`, `projects`, `entry_count`, `code_scope`) and
    never guesses a project label.
  - **Wave 25** — the project filter plumbed through the five surfaces that
    still ignored it (`memory_anchor_audit`, `memory_drift_audit`,
    `/api/drift`, `/api/cognition/clusters`, `/api/cognition/debt`) and a
    labelled **Project Scope** control added to the studio header.
- `origin/dev` (v3.0.2, the website rebuild) was merged into the branch
  first; conflicts were in `.agents/context/current.md`, `CHANGELOG.md` and
  the generated `claims.json`, and all three were resolved by keeping both
  sides.

## Decisions
- **Code-side metrics stay workspace-wide.** Source code is shared between
  memory projects and cannot be attributed to one, so `scope.code_scope`
  always reads `workspace` rather than implying a per-project number.
- **The "−0.8 rank" note was wrong and is corrected.** `STATUS_PENALTY`
  maps `conflicted: -0.8` (`src/types.ts:342`) and both retrieval paths
  apply it. What is true is that it is a soft discount, not a filter.
- **The two new gaps are filed as issues, not fixed here**: #313 (T-405,
  conflicted memories still injected into agent prompts) and #314 (T-406,
  case-sensitive `--project` fails silently). Both change retrieval or
  filter semantics and need their own ticket and test pass.

## Open Issues
- **#313 (T-405, HIGH)** — conflicted memories are still served into agent
  prompts with no badge. The gap is wider than recorded: three retrieval
  paths, not one (`src/retrieval.ts:1686-1701`,
  `src/retrieval/ranking.ts:272-273`, `src/orchestrator/context.ts:144-147`).
  Changes retrieval output and therefore the golden recall fixtures.
- **#314 (T-406, LOW)** — `--project` matches case-sensitively; `--project
  ALPHA` returns an empty report whose label still reads `ALPHA`.
- **Backlog, unblocked and ready**: T-316 (Hebbian → write-time
  `linked_memory_ids` seeding; the retrieval-expansion half already landed
  as T-307, so the premise is partly stale), T-318 (retrieval weight
  auto-tuner from ROI telemetry), T-319, T-323, T-328, T-332–T-335.
  **Still blocked**: T-317 (needs T-178), T-179, T-016, T-201–T-203.
- **Engineering debt** (counts corrected against the code in
  `docs/roadmap.md`): three per-type TTL tables across *two* files, nine
  token estimators across nine files plus six inline expressions, seven
  `clampLimit` sites in `src/mcp.ts`, twelve genuinely dead exports (74 are
  exported with no external caller).

## Verify
`bun test` 1385 pass / 0 fail (210 files) · `bunx tsc --noEmit` clean ·
`bun run build` clean · `bun run scripts/generate-claims.ts --check` up to
date · `bun run scripts/check-doc-links.ts` 137 links resolve ·
`bun run site:build` clean · axe-core a11y gate 25/25 ·
CI on `dev` at `8092ae6`: **success**
