# Roadmap

> The delivery board for Muse Memory. Work moves through four deterministic
> phases and ships as a pull request from `dev` to `main`, with a GitHub
> milestone per sprint.
>
> Live tracking: [GitHub Issues & Milestones](https://github.com/harshsinghmp/musememory/issues).
> Released history: [CHANGELOG](../CHANGELOG.md).

## Phases

```
[ 📋 Requested ] ──► [ 📅 Planned ] ──► [ ⚡ In Progress ] ──► [ ✅ Done ]
 (Issues / PRs)     (Sprint Backlog)    (Active PR / Milestone)  (Shipped to Main)
```

## Versioning protocol (`vX.Y.Z`)

| Part | Meaning |
| --- | --- |
| `X` (Major) | Breaking architectural changes, core schema shifts, protocol overhauls. |
| `Y` (Feature) | Substantive new agent capabilities, MCP tools, CLI subcommands. |
| `Z` (Minor / Hotfix) | Bug remediations, security patches, performance work, urgent hotfixes. |

---

## 📋 Phase 1 — Requested (backlog)

Incoming community proposals, agent adapters and feature requests pending sprint triage.

- [ ] Production-grade showcase demo — re-record a high-fidelity terminal demo reflecting v3.0.0 capabilities (failure attribution, `HOT.md` compounding, memory branch/checkout, MCP context recall)
- [ ] Multi-agent consensus verification protocol (cross-agent memory agreement)
- [ ] Continuous background memory compaction and pruning cron
- [ ] Export to a local GGUF embedding index

## 📅 Phase 2 — Planned

Confirmed high-leverage features scheduled for upcoming sprints.

- [ ] **Tiered retrieval engine** — deterministic Tier 0 (manifest), Tier 1 (invariants), Tier 2 (bounded bodies) knapsack retrieval
- [ ] **Provenance and claim ledgers** — direct memory citations with `[RAW]`, `[FETCH]`, `[SEARCH]` and `[INFER]` confidence tagging
- [ ] **Frozen context snapshots** — immutable SHA-256 state tracking for reproducible agent execution
- [ ] **Native prompt registry** — declarative prompt library and runner (`.memory/prompts/*.md`, `memory prompt run`)
- [ ] **Temporal compounding** — multi-scale day → week → quarter wiki rollups and the `.memory/HOT.md` cache
- [ ] **Gauntlet iteration ledger** — multi-turn improvement loop with plateau detection
- [ ] **Strict health gate** — comprehensive `memory verify --strict` referential, link and secret validator

## ⚡ Phase 3 — In progress

Currently under active development on dedicated feature branches.

- *(none — sprint SOW-200 completed and shipped)*

## 🔧 Engineering debt (audited, deliberately deferred)

Found by the 2026-10-21 cross-file invariant audit. Each item is a real
duplication with a behaviour consequence; each was deferred because collapsing
it changes runtime behaviour and therefore needs its own test pass.

### 1. Three divergent per-type TTL tables

| Table | Location | `adr` | `constraint` | `negative` |
| :--- | :--- | :--- | :--- | :--- |
| `DECAY_POLICIES.stale_after_days` | `src/retention.ts` | 90 | 90 | 90 |
| `DEFAULT_EXPIRY_DAYS_BY_TYPE` | `src/retention.ts` | 365 | never | 180 |
| `DEFAULT_BUILTIN_EXPIRY_POLICY` | `src/retention/expiry_policy.ts` | 365 | pinned (never) | 180 |

`src/retention.ts` claims *"Both live here so they cannot drift apart again"* —
and they already have. The consequence: a `constraint` is written with
`expires_at = never` yet `memory nudge` and `memory stale` still report it as
"stale by policy (90d limit)". **Fix:** one table, one owner, and derive the
stale policy from the expiry policy rather than restating it.

### 2. Nine separate token estimators

`src/compress.ts`, `src/compaction/tokens.ts`, `src/orchestrator/context.ts`
(two — one text, one per-entry), `src/benchmark/suite.ts`, `src/retrieval.ts`,
`src/retrieval/tree-index.ts`, `src/retrieval/tiered.ts`,
`src/store/sidecars.ts`, `src/pageindex/engine.ts` — and
`src/retrieval/ranking.ts` / `src/retrieval/engine.ts` use *different field
sets* (content-only vs title+content). Two "identical" budgets can therefore
mean different token counts depending on the path. Six further inline
estimator expressions (no named function) sit in `src/store/sidecars.ts`,
`src/pageindex/engine.ts`, `src/retrieval.ts`, `src/retrieval/engine.ts` and
`src/retrieval/ranking.ts`.

**Fix:** one `estimateTokens(text)` in `src/compaction/tokens.ts`, imported
everywhere — **but the collapse is not behaviour-neutral.**
`src/orchestrator/context.ts` deliberately consumes the *pessimistic* measure
(`dualMeasureTokens(...).conservativeTokens`), so folding it onto the standard
`chars/4` measure would change tier-0/1 budgets and the golden recall
fixtures. The pessimistic measure has to be part of the shared contract, not
discarded by it.

### 3. Divergent limit-clamping ceilings

`src/retrieval.ts` clamps to 500; `src/retrieval/engine.ts` and
`src/retrieval/ranking.ts` clamp to 200; `src/mcp.ts` uses 5–50, 10–100 and
50–500 in **seven** separate places (four distinct ranges across the repo).
`muse_context` cannot return more than 200
results while `get_context` can return 500, from the same store and the same
query. **Fix:** one exported limit policy, referenced by every retrieval path.

### 4. Twelve exports with zero callers

`src/sqlite.ts::deleteMemoryById`, `src/graph.ts::detectGraphProvider`,
`src/types.ts::MAX_TITLE_LENGTH` *(now used)*, `src/types.ts::MAX_TAGS`
*(now used)*, `src/circuit.ts::resetAllCircuitBreakers`,
`src/retrieval.ts::computeApplicability`, `src/consolidate.ts::topicSlug`,
`src/agents/detect.ts::clearBinaryCache`,
`src/retrieval/tree-index.ts::loadPartition` / `loadShard` / `deleteTreeIndex`,
`src/retrieval/embedders.ts::SEMANTIC_COSINE_MAX_THRESHOLD`,
`src/settings/watcher.ts::watchSettings`, `src/settings/migration.ts::migrateSettingsStore`.
`MAX_TITLE_LENGTH` and `MAX_TAGS` were resolved in this pass (the store and
harvester now use the constants, and `MAX_DRAFT_TITLE_LENGTH` was added for
the 140-character draft title). The remainder are candidates for deletion, but
some may be intended public API for library consumers — **fix:** confirm
intent per symbol before removing.

> **Count correction (2026-10-22).** The heading above was "Fourteen"; the
> list is 12 dead exports plus 2 already resolved, so the dead set is
> **twelve**. The wider figure — exports with no caller *outside their own
> file* — is **74** (12 dead plus 62 that are internal-only but still
> `export`ed, e.g. `src/plasticity.ts::loadHebbianGraph`,
> `src/sqlite.ts::rowToMemoryEntry`, `src/store.ts::recordAccess`). Use the
> narrower 12 when the intent is deletion; use 74 when the intent is to stop
> advertising internals as public API.

## ✅ Phase 4 — Done (shipped to production)

| Milestone / feature | Shipped release / tracker |
| :--- | :--- |
| **SOW-201**: Live runtime file & symbol verification gate (`STRONG`/`WEAK`/`STALE`) | shipped v1.8.0 |
| **SOW-202**: Deterministic relevance cutoff gate (hard score threshold ≥ 0.45) | shipped v1.8.0 |
| **SOW-203**: Git code-drift scanner CLI (`memory drift` / `memory check`) | shipped v1.8.0 |
| **SOW-204**: Gradient-free Hebbian co-activation plasticity | shipped v1.8.0 |
| **SOW-205**: Semantic memory prompt compression (`memory compress`) | shipped v1.8.0 |
| Turnkey agent skills suite (`muse-ground`, `muse-capture`, …) | shipped v1.7.0 |
| AST symbol graph integration (CodeGraph / Graphify) | [#35](https://github.com/harshsinghmp/musememory/issues/35) / v1.7.0 |
| Zero-friction installation lifecycle fix | shipped v1.7.1 |
| Proactive nudges & check-ins (`memory nudge`) — SOW-102 | [#28](https://github.com/harshsinghmp/musememory/issues/28) |
| Daily briefing & routines scheduler (cron-invoked, no daemon) — SOW-102 | [#29](https://github.com/harshsinghmp/musememory/issues/29) |
| Open-loop / task extraction from transcripts — SOW-103 | [#30](https://github.com/harshsinghmp/musememory/issues/30) |
| Calendar / time-aware follow-ups (`due_at` / `expires_at`) — SOW-104 | [#31](https://github.com/harshsinghmp/musememory/issues/31) |
| muse-agents ↔ musememory integration contract (`--for-agent`) — SOW-106 | [#33](https://github.com/harshsinghmp/musememory/issues/33) |
| Dynamic prompt token budgeter (`--token-budget N`) | shipped v1.1.0 |
| Scene-based hierarchical consolidation (`memory consolidate`) | [#1](https://github.com/harshsinghmp/musememory/issues/1) |
| Autonomous verification oracle (`memory verify <id>`) | [#2](https://github.com/harshsinghmp/musememory/issues/2) |
| Multi-hop causality graph tracer (`memory trace <id>`) | [#3](https://github.com/harshsinghmp/musememory/issues/3) |
| In-place core memory partitioning (`memory core`) | [#4](https://github.com/harshsinghmp/musememory/issues/4) |
| Automated post-turn transcript harvester hook | [#5](https://github.com/harshsinghmp/musememory/issues/5) |
| Real-time agency SSE hub (`memory daemon`) | [#6](https://github.com/harshsinghmp/musememory/issues/6) |
| Local offline hybrid vector engine | [#7](https://github.com/harshsinghmp/musememory/issues/7) |
| Delete deprecated `MemoryStore` shim | [#8](https://github.com/harshsinghmp/musememory/issues/8) / v1.5.0 |
| Self-evolving skill distillation | [#9](https://github.com/harshsinghmp/musememory/issues/9) |
| 3-layer progressive disclosure | [#10](https://github.com/harshsinghmp/musememory/issues/10) |
| Bi-temporal reinforcement feedback | [#11](https://github.com/harshsinghmp/musememory/issues/11) |
| Ambient open-loop tracker | [#12](https://github.com/harshsinghmp/musememory/issues/12) |
| Knowledge graph UI v2 | [#13](https://github.com/harshsinghmp/musememory/issues/13) |

---

See also: the wave-by-wave delivery history in
[`.agents/context/current.md`](../.agents/context/current.md) and the full
release history in the [CHANGELOG](../CHANGELOG.md).
