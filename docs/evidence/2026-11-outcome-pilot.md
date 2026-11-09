# With/Without Memory — Outcome Pilot (2026-11-09)

## Design

- Two independent implementation tasks in a fresh fixture: `formatMoney(cents)`
  and `normalizeTag(input)`.
- Two conditions, same model, same prompt shape:
  - **with memory**: the agent was required to run `memory recall` against a
    seeded store containing two project constraints.
  - **without memory**: no memory access, no convention lookup.
- Hidden Bun tests scored the results (not shown to either agent).

## Result

| Condition | Tasks passed | Failure |
|---|---|---|
| with memory | **2/2** | — |
| without memory | **1/2** | `normalizeTag` did not enforce the 32-character cap |

Both conditions independently produced the same money grouping and negative
format, so that task did not discriminate. The tag cap was an unstated project
convention recovered only through memory.

## Limits

- n = 2 tasks, one run per condition, one model. This is a pilot, not a study.
- The tasks were chosen to have an unstated convention; that overstates memory's
  effect relative to ordinary work.
- No wall-clock or token comparison was recorded.

## Conclusion

Memory demonstrably carried a non-obvious convention into an agent's output in
this pilot. This does **not** support the general claim "memory improves agent
task success"; a larger, blinded study is still required.
