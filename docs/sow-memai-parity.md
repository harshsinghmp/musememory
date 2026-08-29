# SOW: Proactive Memory Layer & Competitive Parity Analysis

> **Scope**: Competitive analysis of 11 memory systems (mem.ai + 10 OSS repos) and the resulting
> Scope-of-Work items SOW-101…106 — a proactive "chief of staff" layer for Muse Memory that stays
> zero-daemon, file-backed, and local-first. Works **standalone** (musememory alone) or
> **composed** (muse-agents personas driving musememory via MCP).
>
> **Global non-goals** (explicitly out of scope for this project): cloud sync, mobile apps,
> voice capture, iMessage/WhatsApp channels, consumer positioning, daemon servers, external
> database dependencies.

---

## 1. Executive Summary

Eleven competitors were analyzed across consumer (mem.ai), graph/vector engines (mem0, cognee,
hindsight, supermemory, OpenViking), social-memory servers (honcho), curated context trees
(byterover-cli), embedded SQLite (mnemosyne), eval harnesses (autocontext), and markdown-brain
systems (gbrain).

**Muse Memory's defensible moat**: its *core engine* is pure file-backed, stdio-only, and
zero-daemon, with human-gated lifecycle governance (`candidate → confirmed → superseded/stale/rejected`),
an append-only audit ledger, deterministic multi-factor scoring with knapsack token budgeting,
and hard secret blocking on every write. Every competitor in the set (eval harnesses excluded)
requires at least one of: a daemon, a database, an LLM-key write path, or a cloud account for
its *storage layer*. Optional Muse Memory add-ons (embedded UI graph server, WebSocket hub) are
opt-in processes, not storage infrastructure.

**Biggest competitive risk**: [gbrain](https://github.com/garrytan/gbrain) (MIT) already ships
the entire proactive layer planned here — signal-detector open-loop extraction (≈SOW-103),
cron "dream cycle" routines (≈SOW-102), and gap-analysis briefings (≈SOW-101). However it is
designed around a 24/7 daemon, PGLite/Postgres, and a private GitHub repo as durable store —
none of which fit Muse Memory's constraints. The niche remains open: **proactive intelligence
without infrastructure**.

---

## 2. Master Comparison Table

| Project | License | Infra / Storage | Lifecycle & Audit | Retrieval | Overlaps Muse Memory | Out of Scope for Muse Memory |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| [mem.ai](https://get.mem.ai) | Cloud $0–$199/mo | Cloud SaaS | None | Deep Search; Heads-Up related-context panel | MCP connector; task extraction concept | Cloud/mobile/voice/iMessage/WhatsApp/consumer |
| [mem0](https://github.com/mem0ai/mem0) | Apache-2.0 · 64k★ | Vector DB (+graph/history DB); Docker server or cloud; LLM-key writes | CRUD + per-entry `history()`; no states | Fused semantic+BM25+entity, `top_k` | MCP server; CLI; transcript distillation; audit analog | Vector DBs, daemon server, LLM-required writes |
| [cognee](https://github.com/topoteretes/cognee) | Apache-2.0 · 30k★ | Knowledge graph + vector (embedded defaults); Python + LLM key | forget/improve ops; OTEL traceability; no states | Graph traversal + vector, search types, `top_k` | MCP; session-end sync ≈ harvester; UI graph | Neo4j/Postgres infra, Docker-MCP, API daemon |
| [honcho](https://github.com/plastic-labs/honcho) | AGPL-3.0 · 6.8k★ | FastAPI + Postgres/pgvector + deriver worker | LLM-derived conclusions; no explicit states | Hybrid BM25+vector; token-limited context bundling | MCP; peer modeling ≈ USER.md; MEMORY.md migration ≈ migrator | Postgres/Docker/daemon/cloud/JWT multi-tenancy |
| [byterover-cli](https://github.com/campfirein/byterover-cli) | Elastic-2.0 · 4.9k★ | `.brv/` context tree + **daemon** | Review pending/approve/reject ≈ confirm gate; curate history; git-like VC layer | Agentic LLM loop w/ iteration budgets | Dual-scope dirs; review gate; MCP; multi-agent support | Daemon, cloud sync/team spaces, webui backend, restrictive license |
| [supermemory](https://github.com/supermemoryai/supermemory) | MIT · 29k★ | Local binary = HTTP server :6767, or cloud | Fully automatic (contradiction resolution, date expiry); no human gates | Hybrid RAG+memory; SOTA LongMemEval; token-efficiency headline | MCP trio ≈ get_context/search/capture; profile injection ordering; container tags ≈ scoping | Cloud platform, connectors, multimodal extractors, HTTP server process |
| [mnemosyne](https://github.com/mnemosyne-oss/mnemosyne) | MIT · 2.7k★ | Single-file SQLite, zero-daemon ✅ | Importance score + `valid_until`; hygiene noise-scoring + secret detection | 50% vector + 30% FTS5 + 20% importance; halflife decay; `top_k` | Local-first pitch; persona tier ≈ USER.md; snapshot export; secrets-on-write | Sync server (VPS/Docker); SSE/HTTP transports |
| [autocontext](https://github.com/greyhaven-ai/autocontext) | Apache-2.0 · 1.3k★ | Filesystem runs/ + knowledge/; no DB | Evidence-gated promotion state machine; negative-result ledger | None (eval harness, not memory) | Lifecycle naming only; immutable-artifact philosophy | Model-training infra; RPC/TUI runtimes. **Not a competitor — adjacent harness** |
| [OpenViking](https://github.com/volcengine/OpenViking) | AGPLv3 · 32.9k★ | Server daemon + embedding provider required | Session-commit async extraction; retrieval trajectory logging | Tiered L0/L1/L2 directory drill-down | Agent detect+wiring Helper ≈ detect/connect; session distillation; token-economical loading | Daemon, embedding dependency, Docker/Helm, desktop app |
| [gbrain](https://github.com/garrytan/gbrain) | MIT · 29k★ | Markdown pages in private GitHub repo + PGLite embedded Postgres | Cron "dream cycle"; signal detector; per-page provenance; secrets scrubbed on ingest | pgvector+BM25+RRF+rerank; cost presets; `--explain` attribution; dedup hints | **Heavy**: transcript ingest+scrub ≈ harvester+Vibeguard; persona files; doctor; open-loop extraction (dup SOW-103); cron routines (dup SOW-102); gap-analysis briefings (dup SOW-101) | 24/7 daemon design, HTTP/OAuth multi-user, mobile capture, Telegram bot, Gmail/calendar ingestion |
| [hindsight](https://github.com/vectorize-io/hindsight) | MIT · 21k★ | Postgres+pgvector (embedded option) or in-process | Background consolidation → evidence-backed observations; Memory Defense (45 secret/PII patterns) | 4 parallel strategies (vec/BM25/graph/temporal) RRF+rerank, trimmed to token limit | Memory Defense ≈ Vibeguard; coding-agent detect/wire; per-repo bank from git history; token trimming | Postgres dependency, Docker/Helm ops, LLM-required writes, HTTP-only MCP |

---

## 3. Overlap vs Existing Features

Capabilities competitors ship that Muse Memory **already has** — no action needed:

| Existing Muse Memory feature | Duplicated by |
| :--- | :--- |
| Lifecycle state machine (candidate→confirmed→superseded/stale/rejected) | byterover review gate (partial); autocontext promotion gates (different domain) |
| Append-only `audit.jsonl` ledger | mem0 per-entry `history()`; byterover curate history; gbrain page provenance |
| Vibeguard secret blocking | hindsight Memory Defense (adds PII redaction); gbrain ingest scrubbing; mnemosyne hygiene scan |
| Multi-factor scoring + knapsack token budgeting | supermemory/hindsight token trimming (weaker); honcho token-limited context |
| Transcript harvester / bookend search | gbrain transcript ingest; cognee session-end sync; OpenViking session extraction |
| Dual-scope storage (.memory/ + ~/.memory/) | byterover .brv/global dirs; supermemory container tags; hindsight banks |
| Agent detect + zero-permission connect (80+) | OpenViking Helper; hindsight coding-agents npx (12 CLIs); byterover (22) |
| Migrator (24+ formats) | honcho MEMORY.md import (narrower) |
| Snapshot export/import | mnemosyne backup.json |
| USER.md persona engine | honcho peer cards; gbrain SOUL.md; mnemosyne persona tier |
| Exponential time decay in scoring | mnemosyne halflife; supermemory date expiry (single-axis) |

## 4. Overlap vs Planned SOW

| SOW item | Competitors already shipping equivalent |
| :--- | :--- |
| SOW-101 Proactive nudges/check-ins | **gbrain** gap analysis + staleness warnings; mem.ai check-ins (cloud) |
| SOW-102 Daily briefing + routines scheduler | **gbrain** cron dream cycle + next-day prep; mem.ai Custom Routines + briefing (cloud) |
| SOW-103 Open-loop/task extraction from transcripts | **gbrain** signal detector; mem.ai commitment extraction (cloud). Extends shipped #12 Ambient Open-Loop Tracker |
| SOW-104 Calendar/time-aware follow-ups | mem.ai calendar-aware reminders (cloud); supermemory `expires_at`; mnemosyne temporal KG as-of queries |
| SOW-105 Channel delivery | mem.ai Slack/email channels (cloud); gbrain Telegram bot (out of scope) |
| SOW-106 muse-agents integration contract | No competitor has an equivalent agent-roster integration — uncontested |

**Risk note**: gbrain ships SOW-101/102/103 equivalents but requires a resident daemon,
embedded Postgres, and a private GitHub repo as store. Shipping these as cron-invoked CLI
commands over plain YAML files keeps Muse Memory's constraint set intact and the niche unoccupied.

## 5. Adoption Candidates (ranked by fit)

1. **`due_at` / `expires_at` fields on memory entries** → feeds SOW-104; filtered at retrieval time (source: supermemory, mnemosyne `valid_until`).
2. **Benchmark adoption (MemoryBench-style eval)** → quantify knapsack retrieval quality; publish tokens-per-recall KPI (source: supermemory, mnemosyne benchmark discipline).
3. **Gap-analysis briefing format** → briefing output states what memory *doesn't* know + staleness warnings, not just summaries (source: gbrain) → SOW-101/102.
4. **Evidence-bound rejection records** → attach rationale/evidence digest to `rejected` entries (source: autocontext negative-result ledger).
5. **PII redact-instead-of-block mode** in Vibeguard for transcript harvesting paths (source: hindsight). Invariant: redact mode applies exclusively to harvester output pre-propose; blocking remains unconditional on all direct write paths (`store.propose`/`save`/`setUserProfile`).
6. **Per-entry `abstract:` field** (~100-token L0 summary) for cheap relevance gating before full read (source: OpenViking L0/L1/L2 tiers).
7. **Cross-project read-only memory sources** → scoped borrowing from sibling repos; feeds SOW-106 (source: byterover `brv source add`).
8. **Content-hash idempotent re-ingest** in the harvester — re-running a transcript never duplicates memories (source: gbrain).

---

## 6. SOW Items

### SOW-101: Proactive Nudges & Check-ins ☐

- **Problem**: Memories decay silently; agents never surface "this fix is 85 days old, likely stale" or "open loop #12 unresolved" without being asked.
- **Approach**: `memory nudge` CLI command. Scans for: stale-by-policy entries, overdue open loops, due constraints in CURRENT.md. Emits ranked nudge list to stdout (terminal-first). Deterministic — no LLM calls.
- **Standalone**: `memory nudge [--project P] [--global]` readable by any agent or human.
- **Composed**: muse-agents gate personas run `memory nudge` in Pre-flight and escalate material findings.
- **Acceptance criteria**: nudges derived from staleness policy table + open loops + CURRENT.md; exit code reflects nudge count; covered by tests.
- **Effort**: M · **Non-goals**: push notifications, LLM-generated prose, background watcher.

### SOW-102: Daily Briefing & Routines Scheduler ☐

- **Problem**: mem.ai/gbrain prove scheduled synthesis (briefings, routine jobs) is the core chief-of-staff primitive; Muse Memory has no scheduling story.
- **Approach**: `memory brief` produces a markdown daily briefing (fresh confirmed entries, stale warnings, open loops, upcoming dues). Routines declared in `.memory/routines.yaml` (name, schedule cron expr, command sequence); executed by any external cron invoking `memory routine run <name>` — **no daemon**.
- **Standalone**: `memory routine install` prints the exact crontab line for the user to install (no mutation of system crontab; avoids cron/launchd/systemd platform variance).
- **Composed**: muse-agents personas consume briefing output as morning context.
- **Acceptance criteria**: briefing renders from store alone; routines.yaml schema validated; cron-invoked run is idempotent; tests cover scheduler parsing.
- **Effort**: M · **Non-goals**: resident scheduler process, cloud job runner.

### SOW-103: Open-Loop / Task Extraction from Transcripts ☐

- **Problem**: Commitments made in agent sessions ("I'll fix X later", "TODO: migrate Y") vanish into transcripts.
- **Approach**: Extend the existing harvester (#5): detect commitment patterns during `harvest`/`import-transcript`, propose them as `type: operation` candidate memories tagged `open-loop`, linked to the session node. The shipped Ambient Open-Loop Tracker (#12) provides the read/surfacing surface; extraction itself is net-new write-path work. `memory nudge` (SOW-101) surfaces unresolved ones.
- **Standalone**: works on any `.jsonl` transcript via existing parser.
- **Composed**: muse-agents handoff sections reference open-loop IDs so successor agents inherit obligations.
- **Acceptance criteria**: extraction is deterministic pattern-based (no LLM); idempotent re-ingest via content hash; loops close via supersede/confirm; tests cover extraction patterns.
- **Effort**: M · **Non-goals**: LLM-based intent extraction, external ticket-system sync.

### SOW-104: Calendar / Time-Aware Follow-ups ☐

- **Problem**: "Remind me when the migration settles", "check back Friday" have no representation; decay is the only time axis today.
- **Approach**: Add optional `due_at` / `expires_at` fields to the YAML schema (validated by schema.ts). Retrieval applies due-date boost + expiry filtering alongside existing exponential decay. `memory nudge` reports overdue/due-soon entries. Defer/retry = update `due_at` (audited).
- **Standalone**: pure schema + retrieval change; no new commands beyond nudge integration.
- **Composed**: muse-agents escalation rules can read due dates to prioritize dispatch.
- **Acceptance criteria**: schema validation covers new fields; expired entries excluded from default context; due-date boost covered by scoring tests; migrations handle old files lacking fields.
- **Effort**: S–M · **Non-goals**: calendar-service integrations (Google Cal etc.), timezone-server sync.

### SOW-105: Channel Delivery (Opt-in) — ❌ REJECTED IN PLANNING

- **Status**: Cut during planning review (issue #32 closed). Terminal-first output remains the only delivery surface. Rationale: webhooks add env-secret surface area for marginal value while briefings are terminal/agent-consumed.

### SOW-106: muse-agents ↔ musememory Integration Contract ☐

- **Problem**: Sibling repo `../muse-agents` (17 core agents, static markdown roster) has zero memory integration; its personas cannot ground in project memory.
- **Approach**: Define frontmatter extension `memory:` in the muse-agents schema v1: `memory: { scope: project|global, types: [fix, architecture...], tags: [...] }`. musememory's `context` command accepts `--for-agent <name>` filtering by that contract. Agents work standalone (no `.memory/` present → no-op) or composed (grounded Top-K context per persona).
- **Standalone**: musememory unchanged behaviorally when flag absent.
- **Composed**: muse-agents adapters render the `memory:` field into harness formats; `connect` wires MCP per detected agent.
- **Acceptance criteria**: contract documented in both repos; `--for-agent` filter tested; missing field = backward-compatible default; muse-agents `build.sh --check` extended validation agreed upstream.
- **Effort**: M · **Non-goals**: runtime coupling, muse-agents fork changes beyond schema/docs.

### SOW-107: AST Symbol Graph Integration (CodeGraph / Graphify) ✅ (Shipped v1.6.1)

- **Problem**: The scoring formula's graph bonus was removed in the over-engineering audit (`19b22db`) because nothing ever populated `entry.graph.symbol_names` — it always scored 0. Competitors (Greplica, Engraphis) ship working AST-powered code-aware recall; this is a genuine parity gap.
- **Approach**: Provider abstraction in `src/graph.ts` (`detectProvider`/`getGraphStatus` already exist) supporting CodeGraph CLI and/or Graphify as pluggable providers. `memory graph index` runs the provider over the repo and caches a symbol→path map under `.memory/`. Capture/harvest stamp `entry.graph.symbol_names` (+ `affected_paths`) when content references indexed symbols. Restore `graphSymbolOverlapBonus` — now backed by real data. Coverage surfaces via the existing `memory graph status` CLI + `graph_status` MCP tool.
- **Standalone**: opt-in — without a provider installed, behavior is identical to today (no bonus, no index step).
- **Composed**: muse-agents personas can request `graph index` in Pre-flight for large refactors.
- **Acceptance criteria**: with a provider installed, captured memories referencing real symbols get non-empty `graph.symbol_names`; scoring bonus demonstrably ranks symbol-matching memories higher; without a provider, zero behavior change; provider invocation never blocks capture.
- **Effort**: M · **Non-goals**: shipping our own AST parser (delegate to provider), daemon indexer.

---

## 7. Delivery

Each item ships as feature branch → PR referencing its GitHub issue (`Closes #N`), per the
repo PR workflow. Issues carry the `planned` label; README roadmap rows flip ☐ → ◐ → ✅ in the
same PR.
