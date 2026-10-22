# 📚 Standards Index

> **Reading order**: the root [`AGENTS.md`](../../AGENTS.md) is the router. It
> links the standards that apply to this repository. Everything else in this
> folder is retained but **not routed** — see "Unrouted standards" below.
>
> Load a standard on demand, not up front. Each one states what it governs and
> when to open it.

## Routored from `AGENTS.md`

| Standard | Governs |
| :--- | :--- |
| [`execution-kernel.md`](./execution-kernel.md) | Judgment laws, refactoring discipline, code-complete standards, byte-capping. |
| [`security-vibeguard.md`](./security-vibeguard.md) | Secret isolation, the Destructive Command Gate, untrusted tool output. |
| [`system-design.md`](./system-design.md) | Domain modelling, resilience, migration rehearsal, schemas. |
| [`workflows.md`](./workflows.md) | Scaled tiers, the 5-phase pipeline, PR-per-feature and the post-merge sequence. |
| [`git-workflow.md`](./git-workflow.md) | Branch lifecycle, commit standards, SemVer. |
| [`dox-hierarchy.md`](./dox-hierarchy.md) | Reading order, child document shape, the closeout checklist, the pruning loop. |
| [`council-roles.md`](./council-roles.md) | Muse / Sol / Jasper / Crew / Nexus responsibilities and subagent dispatch policy. |
| [`memory-context.md`](./memory-context.md) | Context hygiene, the `.memory` store lifecycle, durable proposals. |
| [`frontend-astro.md`](./frontend-astro.md) | The `apps/website` stack: the `/musememory` base-path rule, generated assets, the a11y and visual gates. |

The brand and accessibility standards live in [`../brand/`](../brand/) and are
routed from the same place: `design.md`, `bem-conventions.md`, `a11y.md` and
`screenshots/README.md`.

## Unrouted standards (retained, not applicable)

These files are kept for the day the stack changes. They are **not** linked
from `AGENTS.md` because following them today would lead an agent to build
something this repository does not have.

| Standard | Why it is not routed |
| :--- | :--- |
| [`frontend-nextjs.md`](./frontend-nextjs.md) | The site is Astro with static output. There is no Next.js, no React Server Components, and no SSR adapter in this repository. |
| [`backend-workers-hono.md`](./backend-workers-hono.md) | Hono is not a dependency. The engine is a Bun/TypeScript CLI and an MCP stdio server; there is no HTTP worker tier. |
| [`tech-stacks.md`](./tech-stacks.md) | A general catalogue of stacks rather than a standard. Useful when choosing a new dependency, not when implementing in this one. |

If a future change adopts one of these stacks, re-link the file from
`AGENTS.md` **and** rewrite it against the real codebase before it is used —
most generic standards assume a different layout than this repository has.
