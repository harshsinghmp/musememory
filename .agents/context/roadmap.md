# 🗺️ Muse Memory Roadmap & Backlog

---

## ✅ Completed Milestones
- **R14: Cross-Agent Knowledge Sync & P2P Gossip Protocol**: Sealed SyncPackets, vector clock causal tracking, filesystem shared pool drop-directory synchronization, contradiction tagging.
- **R15: Full Web Observability Studio**: Embedded visual web dashboard (`memory studio`) featuring 5-pillar health scorecards, ADR drift inspection, autonomous "Why" reasoner, and live mesh visualization.
- **R16: Multi-Repo & Monorepo Cross-Project Mesh**: Monorepo auto-discovery (pnpm, npm, bun, lerna), cross-project memory resolution with origin provenance, cross-package contract integrity auditing.
- **GAP-1 (2026-09-30): Write-Time Citation Verification** — hallucinated citations rejected at write; shipped in `src/anchors/verify-write.ts` + MCP `memory_anchor_create` gate. From the 2026-09 memory-mechanisms deep research (`.agents/context/deep-research-memory-mechanisms-2026-09.md` §14–15).
- **GAP-2 (2026-09-30): Claude Code Lifecycle Hook Pack** — SessionStart/PostToolUse/Stop hooks, hands-free capture & injection; `memory hooks install` / `memory connect --with-hooks`. Same research §14 (GAP-2).
- **GAP-3 (2026-09-30): Recall-Time Freshness Gate** — drifted/orphaned-anchor memories withheld from `muse_context` by default with explicit notices; `include_drifted` opt-in. Same research §14 (GAP-3). Remaining roadmap below.
- **R17: Deep Research & Architectural Audit (2026-10-14)**: Walrus Memory competitive teardown, SOTA memory-systems scan (Mem0 v3, Zep/Graphiti, Letta MemFS, Supermemory, Cognee, LangMem, A-MEM, HippoRAG, vendor-native), and a read-only source audit of the engine (30.8k LOC / 113 files) that surfaced 10 ranked defects, 4 advertised-but-dead features, 1 security path, 1 data-loss path. Deliverable: `.agents/research/research-brief-walrus-memory-architecture.md`.

---

## 🚀 Active Roadmap & Future Horizons (Agentic Cognitive OS Evolution)

### 0. **DX & Project Showcase Assets (Pending Triage)**
- **Production-Grade Showcase Demo Video & GIF**:
  - Re-record high-fidelity terminal demo video (`showreel.mp4`) and GIF (`muse-memory-demo.gif`) reflecting v3.0.0 capabilities.
  - Showcase real workflows: failure attribution with decaying strikes, negative fix-pair mining, HOT.md candidate compounding, `memory branch` / `checkout`, and MCP context recall.
  - Replace legacy inaccurate SVG render with an authentic, crisp terminal capture.

---

### 1. **R17: Tri-Cognitive Memory Architecture (Procedural Playbooks & Episodic Horizons)**
- **Procedural Playbook Engine (`ProceduralMemory`)**:
  - Capture executable tool-calling workflows, pre-conditions, step trajectories, verification assertions, and rollback recipes distilled from successful agent sessions.
  - Tool additions: `muse_playbook_recall`, `muse_playbook_record`, `memory playbook --run <id>`.
- **Episodic Causal Narrative Horizon**:
  - Transform flat observation streams into structured episodic sequences: `Goal ➔ Hypothesis ➔ Action Trajectory ➔ Verification ➔ Retrospective Insight`.
  - Enables agents to query historical causal chains ("Have we attempted this fix before, and what was the failure cascade?").
- **Bi-Temporal Validity Windows (Zep / Graphiti Temporal Pattern)**:
  - Dual timestamps: transaction assertion time (`asserted_at`) and valid world time (`valid_from` / `valid_until`).
  - Prevents historical regressions during git blame/code reviews of legacy branches without clobbering modern rules.
- **Ebbinghaus Utility-Reinforced Cognitive Forgetting Curve**:
  - Automated half-life decay for unverified candidate notes; exponential reinforcement for memories with verified green test runs and high reuse ROI.

---

### 2. **R18: AST Associative Callgraph Retrieval & Speculative Pre-Flight Recall**
- **Recursive SQLite CTE Associative Expansion (Zero-Daemon HippoRAG Pattern)**:
  - 2-hop associative graph traversal using in-process SQLite recursive CTEs (`WITH RECURSIVE call_tree AS (...)`).
  - Queries touching an entrypoint symbol automatically pull governing ADRs, test requirements, and negative anti-patterns anchored to downstream callees.
- **Speculative Pre-Flight Context Push**:
  - Git/editor hooks that pre-calculate the optimal token-budgeted memory knapsack upon file opening or branch switching (`feat/*`), eliminating agent context-query latency.
- **Cross-File Symbol Blast-Radius Risk Scoring**:
  - Correlates AST identifiers with route handlers, exported interfaces, and test files to provide instant pre-flight risk ratings for proposed changes.

---

### 3. **R19: Git-Branchable Memories & Multi-Tenant Agency Enclaves**
- **Git-Aware Branchable Memory Overlays (`memory branch`)**:
  - Branch-isolated working memory overlays that mirror git branch lifecycles (`feature/*`, `fix/*`).
  - Automated `memory branch-merge` command with interactive semantic contradiction resolution when merging feature branches into `main`.
- **Agency Multi-Tenant Enclaves (`scope: client`)**:
  - Cryptographically isolated client memory vaults tailored for multi-client agency delivery (Sol, Jasper, Crew, Nexus).
  - Enforces zero cross-client knowledge contamination while allowing global engineering invariants (`scope: global`) to propagate safely.
- **Zero-Knowledge Memory Attestation**:
  - Cryptographic SHA-256 signing of SyncPackets with tamper-evident audit chains for verifiable client handoffs.

---

### 4. **R20: Test-Driven Memory Reinforcement & Autonomous Regression Sentry**
- **Automated CI / Test Harness Integration Loop**:
  - Binds memory utility ROI directly to test outcomes (`bun test`, `vitest`, `jest`, `cargo test`).
  - Passing tests increment memory confidence and `successful_applications`; failing tests trigger automated dispute and regression tracking.
- **Negative Anti-Pattern Regression Sentry**:
  - Proactive watchdog matching test failure signatures and stack traces against known `BUG_PRONE_PATTERN` and `DO_NOT_USE` entries, generating immediate remediation playbooks.
- **Flaky Test & Environment Drift Detector**:
  - Correlates test intermittency with past dependency upgrades, node runtime versions, and environmental invariants.

---

### 5. **R21: Local Vector Embeddings & Hybrid Search Fusion (engine: llama.cpp)**
- **Local embedding engine — llama.cpp server (default)**:
  - `llama-server` with a small GGUF embedding model (e.g. bge-small / nomic-embed-text), CPU-only, started on demand — no background service.
  - One OpenAI-compatible `/v1/embeddings` adapter (zero npm deps, bun `fetch`): llama.cpp, Ollama, hosted providers, and a future Hermes embedding facade are the same code path behind a URL.
  - Embedding pipeline fingerprint (`model|dims|endpoint`) stored with the vector index; mismatch refuses reuse and requires `memory embed reindex` (qdrant-memory `init` pattern).
  - Vectors as float32 BLOBs in SQLite; brute-force cosine at current store scale — no ANN index until measured otherwise.
  - **Unblocks A12** (dense vectors, deferred in the October research): the re-evaluation condition — "zero-cost, zero-API-key local embedding" — is now met. Embeddings stay **opt-in / off by default**; the keyless lexical path remains the default.
- **Reciprocal Rank Fusion (RRF) Hybrid Engine**:
  - Mathematical fusion blending SQLite FTS5 BM25 lexical ranking, AST symbol proximity, and dense semantic vector similarity into a unified top-$K$ candidate set.

---

### 6. **R22: Agent Development Environment (ADE) & Meta-Cognitive Self-Reflection MCP**
- **Agent Self-Reflection MCP Tooling (`muse_reflect`)**:
  - End-of-session reflective pass allowing agents to critique their own trajectory, extract reusable lessons, and update `CURRENT.md` checkpoints.
- **Counterfactual Decision Reasoner (`muse_counterfactual`)**:
  - Records why alternative options were discarded during architecture reviews, preventing future agents from re-proposing rejected paths.
- **Autonomous Memory Consolidation & Synthesis (A-Mem Evolution Pattern)**:
  - Zero-daemon background consolidation that synthesizes related micro-memories into coherent macro-concepts and updates inter-memory links.

## 🧬 R23–R26: Production-Readiness & Versioned Memory Milestones

### 7. **R23: Versioned Memory + Access-Weighted Retention**
- **`Memory Versioning` (Git-branchable memory)**:
  - `mem_path` field: human-readable dotted-path addressing (e.g., `auth.session.jwt-expiry`).
  - `memory branch <name>`, `memory checkout <branch>`, `memory blame <id>` CLI verbs.
  - Branch-isolated `.memory/` + `~/.memory/<branch>` scope snapshots with `CURRENT_MD_SCOPE` switching.
  - Backwards-compatible: UUID `id` still works alongside `mem_path`.
- **`Access-Weighted Retention` (A15)**:
  - `last_accessed_at` and `access_count` columns added to SQLite; backfilled from existing `utility_roi`.
  - `staleness_policy` gains `half_life_days` field; decay curve: `0.5 ^ (days_since_last_use / half_life_days)`.
  - Memories used ≥2× in a session get +50% longevity extension.
  - Default half-lives: `fix` = 60d, `adr` = 365d, `anti_pattern` = permanent, `observation` = 7d.
- **Acceptance criteria**:
  - `last_accessed_at` updated on every successful `muse_context` / `get_context` recall.
  - `memory branch`/`checkout`/`blame` verbs work in non-git folders (single main branch).
  - Existing tests in `test/staleness.test.ts` continue to pass; new `test/retention.test.ts` and `test/branch.test.ts` cover the new behaviour.

---

### 8. **R24: Agent Plugin Registry**
- **`memory plugin install <agent>`**:
  - Thin plugin installers for 20+ agents (Claude Code, Cursor, Codex, Gemini CLI, OpenCode, Hermes, OpenClaw, VS Code, Cline, Windsurf, Zed).
  - Extends MCP registration to plugin registration; each plugin calls `muse_context` at session start + `create_observation` at stop.
- **`memory plugin init`**:
  - Scaffold for agent plugin developers (`.mcp.json` + hooks + skills template).
- **Acceptance criteria**:
  - `memory plugin list` shows supported agents.
  - `memory plugin install claude-code` produces a working hook setup.
  - Documentation at `/docs/plugins`.

---

### 9. **R25: Progressive Disclosure + Scoped Retrieval**
- **Progressive disclosure**:
  - `muse_context --include-abstract`: returns a one-line abstract per candidate plus a drill-down handle.
  - Agent scans cheaply, expands only winners.
- **Scoped retrieval**:
  - `muse_context --scope <subtree>`: RRF-fuse BM25 + graph walk within the subtree.
  - `/api/graph` route fix (bench-graph baseline F1–F7): returns only fields the canvas needs.
- **Acceptance criteria**:
  - `--include-abstract` reduces token usage on large stores by ~20%.
  - `--scope` sub-linear scaling at 10k memories.
  - `/api/graph` eliminates F1–F7 failures from bench-graph baseline.

---

### 🔟 **R26: Pro Plugin + Monetization Stack**
- **Pro Plugin (One-time purchase)**:
  - `memory dream`: overnight synthesis of related micro-memories into macro-concepts (opt-in, zero-LLM by default; local LLM optional).
  - Obsidian/Optimaze graph export.
  - Distributed via Gumroad/Polar at $49 one-time.
- **Team SaaS (Subscription)**:
  - Shared memory vault, cross-agent handoffs, per-user attribution.
  - `memory branch` workspace command for team isolation.
  - Team audit log with git-blame.
  - $9/user/mo (Stripe).
- **Enterprise SaaS (Quote)**:
  - SSO (SAML/OIDC), air-gapped deployment, compliance export (SOC 2, GDPR).
  - $29/user/mo.
- **Solo (Free, forever)**:
  - All current features, local-first, zero-LLM. $0.
- **Other production-readiness items**:
  - Self-hostable Plausible analytics (no GA, local-first).
  - Pricing page at `/pricing`.
  - `memory benchmark --median` publishing per-store medians.

---

## 📊 Current Status (as of v2.3.0)

| Area | Status | Next Milestone |
|---|---|---|
| **Speed & Observability** | ✅ Shipped (sub-2ms, <50µs hot cache, 527 tests) | R25 (--include-abstract, --scope) |
| **Hands-free hooks** | ✅ 3/6 events shipped (GAP-2) | R24 (full plugin registry) |
| **Trust gates** | ✅ Write-time verify + recall-time freshness gate (GAP-1, GAP-3) + calibrated contradiction engine (T-320) | R23 (extend to multi-repo) |
| **Version control** | ⚠️ No branch-aware memory | R23 (memory branch/checkout/blame) |
| **Compounding** | ✅ 7-state lifecycle + archival ladder | R23 (access-weighted retention, half-life decay) |
| **Team/SaaS** | ⚠️ Not yet built | R26 (pricing page, Plausible, SaaS prototype) |

---

### 11. **R27: Recall Quality Eval Harness (LoCoMo-style, CI-gated)**
- **Golden recall fixture**: labeled queries plus same-topic distractors covering the five LongMemEval-V2 abilities (static state recall, dynamic state tracking, workflow knowledge, environment gotchas, premise awareness). Muse already covers 3–4 of the 5; the fixture proves it.
- **CI gate**: `bun test` fails below a recall@5 threshold; p50 latency reported beside it. Current benchmarks measure speed only — recall quality is unmeasured.
- Reuses `src/benchmark/` and existing test infrastructure. Prerequisite for judging R21 and every future retrieval change.

### 12. **R28: Memory Poisoning Trust Tiers (OWASP ASI06)**
- **`trust: trusted | candidate | untrusted`** set by ingest source: known agent transcripts are candidates; web or external content is untrusted.
- `muse_context` filters untrusted by default and reports `withheld_memories` — mirrors the GAP-3 freshness gate pattern.
- Reuses `src/provenance.ts` and `src/orchestrator/freshness.ts`.

### 13. **R29: I/O Budget & NVMe Telemetry**
- **`memory io`**: bytes-written/day from `/proc/self/io` with an alert threshold — makes SSD wear visible instead of theoretical.
- YAML dual-write mirror becomes async-batched or opt-out (it currently doubles every write's amplification).
- Rotation caps for `audit.jsonl` / `observations.jsonl` via existing `src/retention.ts`; `wal_autocheckpoint` tuning note.

### 14. **R30: Tombstones & Scoped Deletion (extends A7 suppress)**
- **Content-hash tombstones on delete**: replayed events cannot resurrect deleted memories (qdrant-memory fence pattern; A7's suppress state already hides the bytes).
- `memory delete-all --scope <user|client> --confirm` with a fail-closed `recovery_required` state on interruption (agency client-data deletion).

### 15. **R31: Multi-Writer Merge (extends R19 + sync mesh)**
- Concurrent writers on one shared store: observations merge append-only; memory-level conflicts are flagged, never clobbered (existing contradiction invariant).
- Reuses `src/sync/` vector clocks and the contradiction engine. Single-writer remains the default; merge mode is opt-in. No distributed locks.

### 16. **R32: Studio Recall-Debug (extends R15 + A22)**
- Surface `ranking.ts` per-factor score breakdowns in the Observability Studio: *why* was this memory retrieved.
- Eval-harness (R27) results panel. Small diffs on `src/ui.ts`.


---

# 🗂️ 2026-10-14 Research Track (competitive + engine audits)

> Sections below were produced by the October research/audit program. They reference the **243-ticket implementation plan** in `.agents/context/ticket-plan.md` (IDs `T-###`) and the external-review artifact `.agents/plans/EVOLUTION_PLAN.md`. Product milestones R17-R32 above remain the spec-level roadmap; this track is the audit-backed execution plan derived from it plus ecosystem research.

## 🧬 R17b: Ecosystem Teardown Upgrades (2026-10-14)

69-URL principal-supplied competitor scan (Hermes plugin ecosystem + major OSS memory systems) + Hermes platform teardown + DB/transport research. Full evidence: `.agents/research/ecosystem-teardown-2026-10.md` (competition list + 50-item consolidated implementation catalog + explicit rejections). Decided waves:

- **P0 additions (v2.4.0, 22 items)**: idempotency keys + content-hash dedup; write outbox with stale-lock recovery; `on_pre_compress` fact extraction; wake gate (`wakeAgent:false`) for background passes; overnight loss guard; memory-pressure alerts; honest dual-measure token accounting; refuse-incomplete digest contract; circuit breaker around store calls; `atexit` bounded joins; read-path re-validation; safe FTS query construction; limit clamping; stale-read tags.
- **P1 additions (v2.5.0, 18 items)**: consolidated abstention gates; decay/forgetting engine (decay_score + veracity tiers + trust-tier half-life + stamped expiry + pin policy); bitemporal `valid_to_exact`/`as_of` discipline; conflicts-table-never-delete + federation handshake; veracity trust table + evidence-age stamping; TOON/manifest context packing + omission markers + reserved slots; linked_memory_ids + supersede-not-delete + prefer_observations dedup; provenance tables + hash-chained audit + index-time redaction; write gates (scoreRetain + corroboration-gated promotion + two-tier flush); recall hygiene (re-injection + echo suppression + seen-chunk TTL); ranking upgrades (soft-OR fusion + discrimination rerank + watermark staleness + intent bias); L0/L1 abstracts + resident INDEX; why_retrieved + usage telemetry + config-honesty audit; constitution contract; failure-visibility signals; embeddings (R21) + eval harness (R27); fix-pair mining.
- **P2 additions**: server mode (Streamable HTTP + per-tenant DB files + SyncPool-over-HTOP + git YAML distribution + Litestream backups); dashboard rehaul (recall-debug, lineage graph, eval panel, control tower, mesh view); always-on memory cadence; Hermes MemoryProvider adapter (qdrant branch becomes opt-in vector adapter); federation handshake; observer/observed team semantics; memory forking; gated graph retrieval; funded pools; marketplace.
- **Hard rejects**: daemon-backed stores, SaaS memory backends, AGPL/BSL/PolyForm code copies, multilingual stemming, auto-delete, full-file injection.

Engine verdict: Muse Memory's zero-daemon SQLite+FTS5+YAML+MCP architecture is the majority position of the field and ahead of the Hermes plugin long tail; the gap is shipping the convergent mechanisms (above), not architecture change.

### R17b Full Item List (source of truth: `.agents/research/ecosystem-teardown-2026-10.md` §10)

**P0 — reliability (v2.4.0)**
1. Query-cache self-destruction fix (`store.ts:281`)
2. Memoized file verification + precomputed token sets in ranking hot path
3. `openStore` dirty-gate for wiki recompile
4. Bounded FTS preflight; single-transaction writes; FTS↔row parity repair
5. `/bin/sh -c` removal in `memory verify`
6. Wire or delete 4 dead features (`dedup`, `recordRetrievals`, `maybeAutoOptimize`, `touchActivity`)
7. Tombstones + `memory_restore` + audit-replay restore
8. `Math.max` spread crash + IDF caching + redundant list() fixes
9. Idempotency keys + content-hash dedup on capture
10. Write outbox with stale-lock recovery
11. `on_pre_compress` fact extraction
12. Wake gate (`wakeAgent:false`) for background passes
13. Overnight loss guard
14. Memory-pressure alerts
15. Honest dual-measure token accounting
16. Refuse-incomplete digest contract
17. Circuit breaker around store calls
18. `atexit` bounded joins + generation-counter prefetch invalidation
19. Read-path re-validation for injection markup/credentials
20. Safe FTS query construction + compound-token expansion
21. Clamp model-supplied limits; dry-run-by-default destructive ops
22. Stale-read provenance tags

**P1 — memory quality (v2.5.0)**
23. Consolidated abstention gates (IDF relevance, dual thresholds, no_confident_match)
24. Decay/forgetting engine (decay_score, veracity tiers, trust-tier half-life, stamped expiry)
25. Bitemporal `valid_to_exact`/`as_of` discipline
26. Conflicts-table-never-delete + federation handshake
27. Veracity trust table + evidence-age stamping
28. TOON/manifest context packing + omission markers + reserved slots
29. linked_memory_ids + supersede-not-delete + prefer_observations dedup
30. Provenance tables + hash-chained audit + index-time redaction
31. Write gates (scoreRetain, corroboration-gated promotion, two-tier flush)
32. Recall hygiene (re-injection, echo suppression, seen-chunk TTL)
33. Ranking upgrades (soft-OR fusion, discrimination rerun, watermark staleness, intent bias)
34. L0/L1 abstracts + resident INDEX route-map
35. why_retrieved + usage telemetry + config-honesty audit
36. Constitution contract
37. Failure-visibility signals (degraded notes, ground-moved, loosening ladder)
38. Embeddings per R21 spec branch (SQLite BLOB brute-force, FTS5 floor)
39. Eval harness per R27 spec branch (recall-gate grading)
40. Fix-pair mining from transcripts

**P2 — team, server, UI**
41. Server mode (Streamable HTTP, per-tenant DB files, SyncPool-over-HTTP, git YAML distribution, Litestream backups)
42. Dashboard rehaul (recall-debug, lineage graph, eval panel, control tower, mesh view)
43. Always-on memory cadence (event-triggered consolidation, dual-trigger maintenance, wake gates)
44. Hermes MemoryProvider adapter (qdrant branch → opt-in vector adapter)
45. Federation handshake for mesh mode
46. Observer/observed team semantics
47. Memory forking/branching
48. Gated graph retrieval (behind the P1 eval harness)
49. Funded/shared memory pools (spec only)
50. Memory marketplace (spec only)

**Hard rejects:** daemon-backed stores, SaaS memory backends, AGPL/BSL/PolyForm code copies, multilingual stemming, auto-delete, full-file injection.

---

## 🧹 R18: Retirement & Hygiene Audit (2026-10-14)

Full evidence: `.agents/research/retirement-audit-2026-10.md` (two-lane audit, reconciled). Verdict summary — almost nothing is dead; the work is drift plus two security defects.

**Do first (security, outranks all features):**
1. Fix `verify.ts:23` `/bin/sh -c` on memory-supplied `test_command` — RCE-class, reachable via `memory_verify`/`memory_verify_strict`.
2. Fix studio UI XSS (`ui.ts:1510`, `ui.ts:1557` unescaped interpolation) + gate `/api/optimize`.

**Free drift fixes (no runtime risk):**
3. Remove 7 phantom names from `orchestrator/profiles.ts`.
4. Retire `connect.ts:9-50` allowlist (auto-approves 3 phantom tools, omits 61 real).
5. RETIRE: `maybeAutoOptimize` (0 callers), unreachable LSP tier (`lsp.ts:16`), 4 unused registry methods, 3 dead governor exports.

**Deprecations (visible externally, docs-level breakage only):**
6. Deprecate 20 of 24 migrator providers (only 4 adapters exist; delete detectors before adapters).
7. Freeze 20 dormant agent platforms; fix README "80+" → 52 claim; fix `daemon.ts` README (SSE, not WebSocket).
8. Flip YAML mirror read precedence to DB-first (`store.ts:174-202`, ~6 lines); keep the mirror.

**Hygiene:**
9. Real dispatch tests (or documented-untested status) for 12 circular + 20 full-profile-only tools.
10. Deprecate `recall` as a third retrieval path (alias only).

**Decisions deferred:** MCP profile default change to `core` (~5k tokens/session saved, but visible behavior change — belongs with the R17b P2 tool-packaging work); YAML full-delete (rejected, largest blast radius).

---

## 🏛️ v9: Realigned In-Line Feature Waves (2026-10-15)

Full senior developer and security audit: `.agents/artifacts/audit-and-realigned-roadmap-20261015.md`.
Exploded ticket plan: `.agents/context/ticket-plan.md` (269 tracked tickets, 21 landed on `dev`, 248 active).

### The In-Line Feature Waves
1. **Wave 0: Pre-Flight Integrity & Baseline Fixes (Immediate P0)**
   - `T-402`: `initSchema` column-order fix (prevents silent SQLite degradation on legacy stores)
   - `T-403`: Stored-command doctor sweep (sanitizes legacy non-template `test_command`s)
   - `T-404`: Stdin TTY decoupling in `src/hooks/pack.ts` (prevents terminal hangs)
   - `T-401`: Bunfig surface hardening (`bunfig.toml` timeout & runner isolation)
   - `T-370`: Documentation truth pass (52 platforms, 107 tools, version sync)

2. **Wave 1: Storage Engine, Outbox & Concurrency (In-Line Storage P0)**
   - `T-041`: Outbox state machine (`pending` → `processing` → `sent` / `held` / `failed`) via migration `v3`
   - `T-042`: Stale lock recovery sweep (300s) on store open
   - `T-044`: Append-only fsync JSONL event log + single-writer flock
   - `T-038`: `idempotency_key` column + UNIQUE constraint on capture
   - `T-040`: Normalized `content_hash` + dedup on propose
   - `T-056`: `atexit` bounded join for async write queue workers
   - `T-055`: Circuit breaker around store paths (5 failures → 120s cooldown)

3. **Wave 2: Write Admission, Trust & Anti-Poisoning (In-Line Trust P0/P1)**
   - `T-104`: `scoreRetain` 0.3 write gate (refuses junk writes with low informational density)
   - `T-105`: Corroboration-gated promotion (≥2 independent days, non-synthetic sources)
   - `T-105b`: Syntax-only promotion rule (AST syntax & invariant verification gate)
   - `T-075`: Ingest trust tiers (`trusted` | `candidate` | `untrusted`) by source type
   - `T-058`: Read-path re-validation (injection markup & credentials excluded from recall)
   - `T-103`: Index-time credential redaction keeping text searchable without secret leakage
   - `T-391`: Citation validation against live registry at write time

4. **Wave 3: Retrieval Optimization, Ranking & Token Economics (In-Line Retrieval P1)**
   - `T-035`: Replace `Math.max(...arr)` spread crash with iterative max
   - `T-036`: In-memory IDF caching across queries
   - `T-037`: Drop redundant full-list scan in `hybridSearch`
   - `T-060`: Safe FTS5 query token escaping
   - `T-061`: Compound-token expansion (camelCase / snake_case splitting)
   - `T-070`: IDF-weighted relevance gate before FTS5
   - `T-114`: Soft-OR evidence fusion formula `P = 1 - (1 - pv)(1 - pl)`
   - `T-115`: Low-discrimination conditional rerank
   - `T-117`: Watermark staleness tracking from `last_memory_seen_at`
   - `T-126`: Deterministic `why_retrieved` reason tokens

5. **Wave 4: Compaction, Ephemeral Observations & Distillation (In-Line Cognition P1)**
   - `T-045`: `on_pre_compress` fact extraction hook in compaction engine
   - `T-046`: Persisted digest-dedup set for extracted facts
   - `T-305`: Distillation body cap (prevents raw logs from bloating memory content)
   - `T-306`: Observation log atomic rotation and size cap in `observations.jsonl`
   - `T-053`: Honest dual-measure token accounting
   - `T-054`: Refuse-incomplete digest contract in `get_context`

6. **Wave 5: Security Hardening & UI Protection (In-Line Security P1)**
   - `T-002` / `T-003`: UI XSS escaping for `p.title`, `p.slug`, `r.entry_id`, `r.actor` interpolation
   - `T-004`: UI optimizer gate (`POST /api/optimize` dry-run default + localhost token check)
   - `T-388`: Hook `SessionStart` `<muse-memory>` block escaping
   - `T-389`: `recordObservation` metadata JSON credential scanning
   - `T-399`: Memory routine step allowlist + re-entrancy recursion guard
   - `T-400`: UI read route projection allowlist
   - `T-380`: Unit test suite for `escapeHtml`

7. **Wave 6: Semantic Embeddings & Eval Harness (In-Line Evals P2)**
   - `T-381`: Embeddings spike (validate local llama-cpp embedding generation E2E)
   - `T-071` / `T-136`–`T-139`: Local embeddings engine + brute-force SQLite BLOB cosine similarity
   - `T-140`–`T-143`: Recall evaluation harness (frozen corpus, precision/recall scoring, p50 latency)

8. **Wave 7: Team Slice (On-Demand / Opt-In P2)**
   - `T-150`: MCP Streamable HTTP transport
   - `T-151`: Transport security headers
   - `T-386`: Bearer-token authentication + per-peer allowlist
   - `T-153`: Multi-DB topology (shared team store + personal DBs)
   - `T-387`: Client configuration recipes & shared+personal scoping governance

