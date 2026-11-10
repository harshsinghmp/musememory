# With/Without Memory — Ten-Task Outcome Study (2026-11-09)

Supersedes the two-task pilot (`2026-11-outcome-pilot.md`) as the evidence
behind EVD-005/EVD-008.

## Design

Ten small TypeScript implementation tasks, each with a hidden Bun test and one
non-obvious project convention. Both arms received identical instructions,
including "consult project memory with `memory recall`". The only variable was
whether the convention was seeded in the store: the `with` arm held all ten
conventions plus decoys; the `without` arm held one generic decoy. Implementers
never saw the hidden tests, and grading was mechanical.

## Result

| Condition | Tasks passed |
|---|---|
| with memory | **10/10** |
| without memory | **6/10** |

The four discriminating tasks and their exact failures:

| Task | Without-memory failure |
|---|---|
| `parseDuration` | returned milliseconds (`"500ms"` → 500, not 0.5) |
| `toIsoDate` | used the local calendar date (`2026-01-01Z` → `2025-12-31` in `America/New_York`) |
| `slugify` | did not apply the 60-character cap (returned 80) |
| `csvField` | did not quote a value with leading/trailing whitespace |

No regressions: no task failed with memory and passed without it. Fisher's
exact test, one-sided: **p = 0.043** (two-sided ≈ 0.087).

## Limits

- n = 10 tasks, one run per arm, one model; the direction is clear but the
  sample is small.
- The tasks were built to carry unstated conventions, so the 40-point gap is an
  upper bound relative to ordinary work.
- The harness supplied the retrieval query; agent-chosen retrieval is untested.
- Five tasks did not discriminate.

Full method, task prompts and graders:
`.agents/artifacts/outcome-study-2026-11/`.
