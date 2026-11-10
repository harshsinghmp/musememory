# Test-Failure Audit — Self-Triage on Repeated Red

> **Scope:** every agent working in this repository, and every project scaffolded from this template.
> **Authority:** routed from `AGENTS.md` (Working rules → Test-Failure Audit).

## The failure this rule exists to prevent

An agent ran the same failing test three times, each time applying a
symptom-level tweak, and reported "still investigating" without ever
checking whether its own previous change had landed, whether the test was
even exercising the new code, or whether the failure was a pre-existing
flaky/environment issue. The root cause is that repeated red was treated as
"try again" instead of as a signal to audit the agent's own outputs.

## The rule

When **the same test (or the same failure signature) fails on two or more
consecutive runs** during one task:

1. **Stop changing code.** No further edits until the audit below completes.
2. **Run the self-audit** over the agent's own outputs for this task:
   - Did the previous edit actually land on disk? (`git diff`, `git show --stat HEAD`)
   - Is the test even exercising the changed code path? (trace the call site)
   - Is the failure pre-existing on the clean tree? (`git stash` → run test → `git stash pop`)
   - Is it environment/flaky (timeout, network, sandbox)? Check exit codes and logs.
   - Did a guard get widened or a test get weakened? (re-read the test as the spec)
3. **Triage** the root cause into one of: (a) my change broke a contract,
   (b) pre-existing/inherited failure, (c) flaky/environment, (d) wrong
   assumption about the input. Record the triage verdict in the report.
4. **Only then** apply a fix targeted at the triaged root cause, and re-run
   the full suite (not just the one test).
5. **Report** the audit: the runs attempted, the triage verdict, the fix, and
   the final verification command + exit code.

## Verdict names

- `SELF-AUDIT COMPLETE` — audit ran, triage recorded, fix applied, suite green.
- `SELF-AUDIT PENDING` — red persists; no fix applied yet; do not claim progress.

Never report "still investigating" without the audit above.

## See also

- `AGENTS.md` — Working rules (Test-Failure Audit entry).
- `.agents/standards/execution-kernel.md` — systematic root-cause discipline.
- `.agents/standards/workflows.md` — the verification gates this audit re-enters.
