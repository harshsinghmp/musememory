# 🔒 Worktree Lease — Shared Checkout Protocol

> Referenced by `.agents/artifacts/handoff-20261015-143202.md` and by
> `.agents/standards/landing-gate.md` §6.

A **shared checkout** is a working directory where a second agent session, a
dispatched subagent, or a scheduled run may write files while you are in it.
Git has no lock for that; the lease is one file whose contents name the holder.

## Current lease

> Fill this block to take the lease. Clear it to release it.

| Field | Value |
| :--- | :--- |
| holder | _(none — free)_ |
| session | _(none)_ |
| task | _(none)_ |
| since | _(none)_ |

## 1. When the lease applies

Take the lease before any `git add`, `git commit`, `git checkout`, `git stash`,
`git merge`, `git rebase` or `git push` in a checkout where:

- You dispatched a subagent that may **write files** (a read-only reviewer
  does not need a lease; a builder does).
- A second agent session is running in the **same directory**, or you
  dispatched work through the `git` skill.
- A scheduled run may touch the tree while you work.
- A previous session was interrupted mid-mutation and may have left a lease.

**A separate `git worktree` per agent is the real fix.** The lease is the
fallback for when you were handed a shared checkout.

## 2. Taking the lease

One file: `.agents/artifacts/WORKTREE-LEASE.md`. **Its contents are the
lease** — the file always exists, so taking the lease means writing your claim
into the block above and releasing it means clearing that block. No lock file,
so no stale lock to reason about.

Record four facts and nothing else: the **holder**, the **session/agent id**,
the **task**, the **timestamp**. Worked example — the exact contents of the
block while the lease is held:

```markdown
| Field | Value |
| :--- | :--- |
| holder | orchestrator (Muse) |
| session | ses_9f2c41a7 |
| task | commit T-321 per-project health gate on `fix/T-321-per-project-health-gate` |
| since | 2026-10-22T14:32:02Z |
```

## 3. Releasing the lease

Clear the block back to `_(none — free)_` when the git mutations are done.
**Release after the push, not after the commit.** A local commit is not a
delivery — the work is delivered only when it is on the remote, so the lease
covers the push too. Run `bun run check:landed` before releasing; if it says
`LOCAL`, the work is still local and the lease is still yours.

## 4. The staging rule

> **Never `git add -A`. Never `git add .`.** In a checkout where another agent
> or subagent may be writing.

Stage only the exact paths you edited, and run `git status --short` immediately
before staging. If the output lists files you did not touch, another agent is
working in this tree — stop and coordinate before committing.

**Why:** a broad `git add` silently sweeps a concurrent agent's in-progress
edits into your commit. The message then describes work that is not in it — a
history that is wrong in a way that is very hard to detect later, because the
diff looks plausible and the tests still pass. This happened for real on
2026-10-22 and was caught only because a subagent reported it.

## 5. Do not

- Do not `git add -A` or `git add .` in a shared checkout.
- Do not commit while someone else holds the lease.
- Do not rewrite a shared branch's history — no `git reset --hard`, no
  `rebase` of a branch others are on, no force-push.
- Do not assume a clean `git status` means the tree is yours. It only means
  nobody has an uncommitted change *right now*.
