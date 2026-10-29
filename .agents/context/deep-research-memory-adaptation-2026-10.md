# Deep research — memory adaptation shortlist (2026-10)

**Workstream**: A of the competitor-adaptation plan. **No implementation here.**
**Method**: primary sources (repos, specs, docs) plus the existing 86-system study in
`deep-research-memory-mechanisms-2026-09.md`. Every row names its source and marks what
Muse already ships, so nothing already built is re-proposed.

**Not re-proposed** (shipped and verified in `current.md` #35–37): write-time citation
verification, the recall-time freshness gate, and the 3-event hook pack.

## Scoring

Score = **impact × feasibility** (both 1–5). Impact is measured against the §14 gap
scorecard where Muse's weakest axis is hands-free use at 4/10 (trust 7/10, speed 15/16,
observability 8/8). Feasibility discounts anything requiring an LLM, an API key, a daemon,
or host support that does not exist yet.

---

## Scored adaptation table

| # | Candidate | Mechanism (primary source) | What Muse already has | Adaptation | Impact | Feas | Score |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | **Full hook coverage** | agentmemory fires 12 Claude Code lifecycle events (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PreCompact, Stop, SubagentStop, SessionEnd, …); the newer hosts expose 18–30. Claude Code's own docs list the full set. | 3 of them: SessionStart, PostToolUse, Stop (`src/hooks/pack.ts`) | Add **UserPromptSubmit** (per-prompt top-K injection), **PreCompact** (flush checkpoint + distill before context loss), **PreToolUse(Read)** (inject verified memory for the file about to be opened), **PostToolUseFailure**, **SubagentStop**, **SessionEnd**. | 5 | 4 | **20** |
| A2 | **"Starts full" install** | deja-vu `install --auto` indexes history already on disk at install time and writes guidance into each harness's *own* rules file, because hosts ignore bare MCP tool descriptions. | 24+ format migrator, transcript harvesters, `connect --with-hooks`, 80+ platform detection | At `connect`: (a) harvest existing transcripts before first session, (b) detect each host's rules file (AGENTS.md / CLAUDE.md / .cursor/rules) and write an idempotent memory-protocol block. | 5 | 4 | **20** |
| A3 | **Incremental symbol-index maintenance** | deja-vu keeps a per-file `manifest.gob` and only re-reads grown files; 17.6 s to index 19,195 sessions, ~0.2 s end-to-end lookups. | `loadGraphSymbolIndex()` reads and parses `.memory/graph-symbols.json` per call, no invalidation | Persist a per-file mtime+size manifest; load the index once per process keyed by manifest digest; invalidate on `indexGraph` write. | 4 | 5 | **20** |
| A4 | **Progressive-disclosure recall (L0/L1/L2)** | OpenViking writes generated `.abstract.md` (L0, ~100 tokens) and `.overview.md` (L1, ~2k tokens) beside every directory, so agents judge relevance before opening full content; measured −34.3–91.0% input tokens and −58.45–66.10% query latency on LoCoMo. | Wiki pages already expose an L1 detail level; L0 cache is *infrastructure*, not a disclosure tier | Return one-line L0 abstracts for ranked candidates plus a drill-down handle, so an agent can scan cheaply and expand only the winners — instead of one fused package for every call. | 4 | 4 | **16** |
| A5 | **PR-time staleness gate** | Kage's `kage pr check` warns before the PR when a cited file changed; 0% stale-served measured. | Recall-time freshness gate, drift engine, `memory pr-context`, `memory code-impact` | `memory pr check`: fail or warn when the diff touches files whose anchored memories drifted, with the drift list inline. Fits CI as a standalone step. | 4 | 4 | **16** |
| A6 | **Standing answers / mental models** | hindsight consolidates facts into **observations** (with evidence quotes and proof counts) and then **mental models** — standing answer pages read as a plain DB read with no retrieval and no LLM; agents boot with settled knowledge. | Distiller → candidates, wiki pages, ADRs, rollups | A derived `.memory/ANSWERS.md` of settled, high-utility confirmed facts, refreshed by the optimizer, injected at SessionStart — a read, not a query. | 4 | 3 | **12** |
| A7 | **Suppress, don't delete** | Vestige keeps an append-only hash-chained log; `suppress` removes an entry from every read while keeping the bytes, and `receipt replay` re-derives state to detect tampering. | Append-only audit trail, 7-state lifecycle, `deleteEntry` | Add a `suppressed` lifecycle state that hides without destroying, and make the audit trail hash-chained so state can be re-derived and verified. | 3 | 3 | **9** |
| A8 | **Graph-native multi-hop recall** | Vestige `causal_walk` traces a failure backward over *recorded* edges only (≤8 hops) to find the root cause rather than a lookalike. | `related_memory_ids`, mesh contracts, negative memories, "graph overlap" is 1 of the 11 ranking dimensions | A bounded walk over recorded edges from a failing anchor/symbol to surface the causal chain, exposed in the debugging profile. | 4 | 2 | **8** |
| A9 | **Savings ledger (`gains`)** | Kage `kage gains` and deja-vu `stats --card` quantify tokens and money avoided, traceable to logged events. | `memory benchmark` (latency/quality), utility ROI fields | A ledger that converts avoided re-explanation and avoided grep passes into tokens and dollars, sourced from logged events. Also the strongest **website** proof point available. | 3 | 3 | **9** |
| A10 | **Scoped retrieval** | OpenViking scopes semantic search to a project or memory subtree instead of a flat pool. | mesh resolution, project filters, path proximity in ranking | Scope recall to a subtree/package, with the scope reported in the result. | 3 | 3 | **9** |
| A11 | **Single-file portable store** | Memvid packs data, indexes, and crash recovery into one `.mv2` file you can commit, scp, or share; `@memvid/sdk` does BM25 + vector ranking from that file. | `.memory/` YAML + SQLite, `exportSnapshot`, sealed `SyncPacket` | Not adopted: Muse already ships repo-local files plus a sealed sync packet, and the portability win is smaller than the migration cost. | 2 | 2 | **4** |
| A12 | **Hybrid lexical + dense ranking** | agentmemory runs BM25 + local MiniLM vectors + structural graph with 3-way RRF: 14 ms p50, 95.2% R@5. | 11-dimension lexical + structural + graph ranking, keyless by design | Not adopted now: dense retrieval means an embedding model, which breaks the keyless, zero-model promise. Revisit only as an optional local reranker behind a flag. | 3 | 2 | **6** |
| A13 | **MCP resource subscriptions (push, not poll)** | MCP spec 2025-06-18 supports optional `resources/subscribe` with `notifications/resources/updated`, gated on `capabilities.resources.subscribe`. | stdio MCP server (2024-11-05), 69 tools, 6 profiles | Blocked: Claude Code has an open request for resource-subscription support (issue #7252), so the main host would not receive the pushes. Do not build on it yet; re-check host support before investing. | 3 | 1 | **3** |
| A14 | **Spaced-repetition decay + co-activation** | Vestige applies FSRS-6 decay (unused memories fade, use strengthens) and `dream_compile` strengthens co-activated edges. | recency decay, reinforcement counters, utility ROI, optimizer cadence | Partially covered today; the transferable piece is strengthening *co-activated* neighbours during consolidation rather than only the entry that was used. | 2 | 3 | **6** |

---

## Top 3 ranked adaptations

### 1. A1 — Full hook coverage (score 20)

**Why first**: hands-free use is Muse's weakest axis (4/10), and the pack that fixes it is
already shipped with 3 of the ~12 events the ecosystem uses. The three added events carry
most of the value: UserPromptSubmit removes the need for the agent to *choose* to recall,
PreCompact stops losing in-flight knowledge exactly when context is discarded, and
PreToolUse(Read) delivers memory at the moment it is provably relevant.

**Acceptance criteria**
- `memory hooks install` registers 6 events idempotently and preserves existing user hooks.
- Every handler stays fail-open: a throwing handler must not block the host.
- UserPromptSubmit returns top-K within its token budget, and returns nothing rather than
  overrunning it.
- PreCompact writes a CURRENT.md checkpoint and a distillation candidate before exit.
- PreToolUse(Read) injects only memories whose anchors verify against the file being opened.

**Tests to extend**: `test/hooks.test.ts` (per-event contracts, fail-open, idempotency),
`test/governor.test.ts` (PreCompact checkpoint), `test/freshness.test.ts` (PreToolUse must
not inject drifted memories).

### 2. A2 — "Starts full" install (score 20)

**Why second**: value on day one is the difference between a memory tool that compounds and
one that is abandoned before it has anything to recall. Two halves, both independently
useful: harvest what is already on disk, and tell each host *when* to call memory by editing
the rules file it actually reads.

**Acceptance criteria**
- `memory connect` (and `--with-hooks`) harvests existing transcripts before the first
  session, reporting the count and the sources it read.
- For each detected platform, the correct rules file is identified (AGENTS.md, CLAUDE.md,
  .cursor/rules, …) and a delimited memory-protocol block is written.
- The write is idempotent and never clobbers user-authored content outside its delimiters.
- `--dry-run` prints exactly which files would change.

**Tests to extend**: `test/hooks.test.ts` (installer contract), plus a new
`test/connect.test.ts` covering idempotency, delimiter safety, and dry-run output.

### 3. A3 — Incremental symbol-index maintenance (score 20)

**Why third**: it is the only candidate that is simultaneously a user-visible speedup and a
prerequisite for Workstream C. The baseline measured this pass shows the dashboard path is
*not* where the symbol index hurts; the retrieval path is, and C's first fix step assumes a
memoized, mtime-invalidated index that does not exist yet.

**Acceptance criteria**
- The symbol index is parsed once per process and reused; a second call re-reads nothing.
- A changed file (mtime or size) invalidates only its own entries, not the whole index.
- A deleted file's entries are dropped on the next load.
- Recall latency is unchanged from the measured sub-2 ms baseline on a warm store.

**Tests to extend**: `test/graph.test.ts` and `test/graph_ast.test.ts` (invalidation and
reuse assertions), plus a latency regression guard as C's step 1 lands.

---

## Notes on two notable non-adoptions

- **A13 (MCP subscriptions)** is the one candidate whose mechanism is attractive and
  standardised but whose delivery path is missing: the spec supports it, the host does not
  yet. Recording it here so it is not "discovered" and half-built later.
- **A12 (dense vectors)** is the clearest strategic conflict found. The competitor numbers
  are strong (95.2% R@5) but every one of them requires an embedding model. Muse's keyless,
  zero-model, sub-2 ms position is worth more than the recall delta, and the accepted
  tradeoff is explicit rather than accidental.
