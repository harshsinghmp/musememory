# 🚚 The Landing Gate — A Commit Is Not a Delivery

> **Doctrine**: Work is **LANDED** only when it is reachable from the
> integration branch **on the remote**. Until then it is **LOCAL**. A commit is
> an artifact, not a delivery.
>
> **Enforced by**: `scripts/check-landed.ts` (exits non-zero when the work
> cannot be proven delivered). Prose that an agent can forget is not a rule;
> this is a gate.

---

## 1. The failure this standard exists to prevent

On **2026-10-22**, two complete waves of work — `T-320` (contradiction engine
calibration) and `T-321` (per-project health gate scope) — were committed to a
local branch and a local `dev`, and the session ended.

| What happened | What it looked like from the outside |
| :--- | :--- |
| 6 commits, 2 waves, all code written | Complete |
| `bun test` green, `tsc` clean, build clean | Verified |
| A close-out document describing both waves as shipped | Shipped |
| Under a heading reading *"Recently Landed Waves (Verified on `dev`)"* | **On `dev`** |
| **No push. No pull request. No CI run.** | — |

`dev` did not contain the work. `origin/dev` had already moved to **v3.0.2**
while the branch sat local, so the branch had **diverged** and a direct push
would have been rejected. The work was invisible to review, invisible to the
release, and invisible to every agent that later read the close-out document
and believed it.

**The code was correct. Every test was green. The failure was not a coding
failure — it was a false claim about the remote that nothing had ever checked.**

The three sub-failures, in order:

1. **The gate was missing.** Nothing between "tests pass" and "the work is
   delivered" existed, so "delivered" became a matter of opinion.
2. **The claim was written before the fact.** The close-out document asserted
   remote state *before* the push — the sequence was reversed.
3. **The close-out document became the next session's source of truth.** A
   later session read "landed, verified on `dev`" and built on it.

---

## 2. The vocabulary is the gate

These words assert a fact about the remote. **They may only be used when
`check-landed.ts` has exited 0 in the same session:**

> landed · shipped · merged · released · published · deployed ·
> *verified on `dev`* · *on `dev`* · *in `dev`* · *upstreamed*

Until the gate has run, the only permitted words are:

> **local** · *committed locally on `<branch>` at `<sha>`* · *not yet pushed* ·
> *not yet reviewed* · *not yet landed*

**This applies to every artifact, not just chat:** commit messages, close-out
documents in `.agents/context/`, PR bodies, changelog entries, issue comments,
and the final report to the user. A doc that says "landed" is a doc that will
be read as truth by the next session — which is exactly how a six-commit
silent failure survived a close-out.

---

## 3. The gate

```bash
bun run check:landed                                        # is this LANDED?
bun run scripts/check-landed.ts --pr --branch <name>       # is this REVIEWABLE?
```

### Post-merge mode — `bun run check:landed`

Answers: *is this work on `origin/dev`?*

| Check | Fails when |
| :--- | :--- |
| `HEAD` is an ancestor of `origin/dev` | The work is committed but not on the integration branch. |
| Nothing unpushed | A commit exists that the remote has never seen. |
| PR state (informational) | — |

### Pre-review mode — `--pr --branch <name>`

Answers: *is this branch reviewable?*

| Check | Fails when |
| :--- | :--- |
| `origin/<name>` exists | The branch was never pushed. |
| A pull request exists and is `OPEN` | There is nothing to review. |
| No failing PR checks | The PR is already red. |

### Reading the result

```
RESULT: LANDED              → exit 0. The remote-state claims are earned.
RESULT: LOCAL               → exit 1. The work is LOCAL. Say so.
RESULT: REVIEWABLE          → exit 0. Pre-review mode only.
RESULT: NOT REVIEWABLE      → exit 1. Pre-review mode only.
```

> **The two verdicts never contain each other as substrings.** An earlier
> draft used `NOT LANDED` — which contains `LANDED`, so a report quoting the
> output, or a `grep "LANDED"`, could read a failure as a success. The
> failure verdicts are `LOCAL` and `NOT REVIEWABLE`. `test/landing_gate.test.ts`
> pins this.

The gate prints the **exact commands and SHAs** it used. **Quote that
evidence; do not restate it as an assertion.** A report that pastes the
command and its exit code is auditable. A report that says "landed on dev" is
not.

---

## 4. Where the gate MUST run

### 4.1 Before the close-out DOX pass

The close-out pass writes to `.agents/context/current.md` under a heading that
claims *"Recently Landed Waves (Verified on `dev`)"*. **Run the gate first.**

If the gate fails, the entry is not a "Landed Wave" — it belongs under
*Next Up* with the word **local** in it, and the report must say what is
missing (push / PR / CI / merge).

### 4.2 Before the final report to the user

A report that omits the remote state leaves the reader to assume the best
case. The report **must** carry the block in §5.

### 4.3 Before writing any remote-state claim

Anywhere. Any artifact. Including a commit message body that says "merged" or
a changelog entry that says "released".

### 4.4 After every push

Re-run it. A push that lands on a *feature* branch is not a delivery; the
PR and the merge are.

---

## 5. The report contract

Every final report carries this block. It is short, it is mechanical, and it
is the thing that makes "did you actually finish?" answerable at a glance.

```markdown
## Remote state

| | |
| :--- | :--- |
| Branch | `fix/T-321-per-project-health-gate` @ `983de69` |
| Integration | `origin/dev` @ `8092ae6` |
| Landed | ✅ `git merge-base --is-ancestor HEAD origin/dev` → exit 0 |
| Pull request | #315 — MERGED |
| Unpushed | none |
| Gate | `bun run check:landed` → `RESULT: LANDED` |
```

When the gate has **not** been run or has **failed**, the block reads:

```markdown
## Remote state

| | |
| :--- | :--- |
| Branch | `fix/x` @ `abc1234` |
| Landed | ❌ **LOCAL — not pushed, not reviewed, not landed** |
| Gate | `bun run check:landed` → `RESULT: LOCAL` |
| Remaining | push → `gh pr create` → CI → merge |
```

**Never omit this block.** A report without it is indistinguishable from a
report about work that shipped — which is the entire failure mode.

---

## 6. The staging rule (concurrent agents in one checkout)

The other half of the failure class: **a commit that does not contain the
work it claims to contain.**

A dispatched subagent writing into the same checkout, while the orchestrator
runs `git add -A`, produces a commit that silently absorbs the subagent's
in-progress edits. The commit message then describes work that is *not* in it.
This happened for real on 2026-10-22 and was only caught by the subagent
reporting it — nothing mechanical would have caught it.

### Rules

1. **Never `git add -A`. Never `git add .`.** Stage the exact paths you
   edited. There is no exception for "the tree looks clean".
2. **Run `git status --short` immediately before staging.** If you see files
   you did not touch, another agent is writing here — stop, coordinate, or
   wait.
3. **Never commit into a checkout another agent holds a lease on.** The lease
   protocol lives in `.agents/artifacts/WORKTREE-LEASE.md`.
4. **A commit's message must match its contents.** After committing, read
   `git show --stat HEAD`. If the file list does not match the message, the
   commit is wrong — fix it before pushing.
5. **One worktree per agent when they can overlap.** If two agents may touch
   the same files, give them separate worktrees and reconcile at the end.

---

## 7. Exceptions, and what to do instead

| Situation | What to do |
| :--- | :--- |
| No network / offline | Say **local**. Report the branch and SHA, state that the push is pending, and give the exact command. Never write "landed". |
| The principal asked for local-only work | Still run the gate and report the truth: *committed locally, deliberately not pushed*. |
| The integration branch does not exist yet | The gate fails. Create it, or report local with the reason. |
| The work genuinely belongs on a feature branch (a draft PR) | Use `--pr` mode. The report says **ready for review**, not landed. |
| The gate fails but you believe the work is fine | The gate is right and you are wrong, or the work is genuinely not delivered. Investigate; do not describe the work as landed. |

**There is no state in which the honest answer is silence.** If the gate did
not run, the report says the gate did not run.

---

## 8. Why this is a standard and not a habit

The failure was not a lapse of diligence. The agent was thorough — it wrote
a close-out document, ran the full test suite, verified the CLI by hand, and
documented the design decisions in detail. Every one of those steps was
performed **correctly**, and the work still never shipped.

Diligence applied to the wrong axis. The agent verified *the code* and
assumed *the delivery*. A standard that only says "be more careful" cannot
fix that, because the agent was already careful.

So this standard does three things that diligence alone did not:

1. **It names the exact state** — LOCAL or LANDED — so there is no ambiguity
   to resolve by feel.
2. **It replaces the judgement with a command** that exits non-zero.
3. **It forces the evidence into the report**, so the next reader (human or
   agent) can check instead of believing.

The rule exists because the cheapest possible fix for this class of failure
is not "try harder". It is "make the wrong thing impossible to say".

---

## 9. Related

- [Git Branching, Commits & SemVer](./git-workflow.md) — branch lifecycle, commit format, SemVer.
- [Agent Development Workflows & Phase Gates](./workflows.md) — the 5-phase pipeline; Phase 5 (Ship) depends on this gate.
- [DOX Hierarchy & Subtree Contracts](./dox-hierarchy.md) — the closeout checklist; step 5 runs this gate.
- [Execution & Cognitive Kernel](./execution-kernel.md) — judgment laws and the general evidence-before-claims doctrine.
