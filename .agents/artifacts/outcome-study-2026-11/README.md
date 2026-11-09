# Outcome Study — With/Without Memory (2026-11-09)

A ten-task, condition-blind study of whether recalled project conventions change
an agent's implementation output. This replaces the two-task pilot in
`docs/evidence/2026-11-outcome-pilot.md` as the evidence behind EVD-005/EVD-008.

## Design

- **Tasks**: ten small TypeScript functions (`formatMoney`, `parseDuration`,
  `formatBytes`, `toIsoDate`, `truncateText`, `slugify`, `compareSemver`,
  `cloneValue`, `formatPercent`, `csvField`). Each has a hidden Bun test that
  checks ordinary correctness *and* one non-obvious project convention.
- **Arms**: identical instructions in both arms. Every implementer was told to
  run `memory recall "<query>" --project outcome-study` before writing code.
  The *only* difference was whether the convention was seeded in the store:
  - `with`: all ten conventions (confirmed constraints) plus three decoys.
  - `without`: one generic decoy only.
- **Blinding**: implementers were not told a study existed, were not told which
  arm they were in, and never saw the hidden tests. Grading was mechanical.
- **Grading**: each solution was copied beside its hidden test and run with
  `bun test` under `TZ=America/New_York` (non-UTC, so the date convention is
  actually discriminating).
- **Model**: one model per arm, matching the pilot's single-model design.

## Result

| Task | With | Without | Failure without memory |
|---|---|---|---|
| `formatMoney` | pass | pass | — |
| `parseDuration` | pass | **fail** | returned milliseconds (500 for `"500ms"`) |
| `formatBytes` | pass | pass | — |
| `toIsoDate` | pass | **fail** | local calendar date (`2025-12-31` for a UTC `2026-01-01`) |
| `truncateText` | pass | pass | — |
| `slugify` | pass | **fail** | no 60-character cap (returned 80) |
| `compareSemver` | pass | pass | — |
| `cloneValue` | pass | pass | — |
| `formatPercent` | pass | pass | — |
| `csvField` | pass | **fail** | did not quote leading/trailing whitespace |

**with memory 10/10 (100%) · without memory 6/10 (60%)** — a 40-point gap,
four discriminating tasks, zero regressions (no task passed without memory and
failed with it).

Fisher's exact test, one-sided: **p = 0.043** (two-sided ≈ 0.087). The direction
is consistent, but n = 10 is small.

## Limits

- Ten tasks, one run per arm, one model. Not a productivity study.
- The task set was constructed so each task carries an unstated convention;
  that deliberately favours memory and makes 40 points an upper bound for
  ordinary work.
- The harness supplied the retrieval query; an agent choosing its own query
  (or not querying at all) is a different, untested condition.
- Five tasks did not discriminate: those conventions were either guessed
  correctly or did not affect the hidden test.

## Reproducing

- `tasks/<id>.md` — the exact implementer prompt for each task.
- `graders/<id>.test.ts` — the hidden test for each task.
- Rebuild fixtures and rerun with a fresh agent population; the seeds are the
  convention sentences in this directory's history. Do not reuse these graders
  for a second study against the same model without authoring new tasks.
