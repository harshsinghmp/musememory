# 🧠 Muse Memory — Core Concepts & Architecture

> **Copywriting Framework**: **ACCA** (*Awareness* → *Comprehension* → *Conviction* → *Action*)  
> **Target Audience**: Technical Architects, Engineering Directors, and Senior Developers evaluating memory infrastructure for AI coding agents.

---

## 1. Awareness: The High-Context Amnesia Paradox

Modern Large Language Models have context windows exceeding two million tokens. Yet, every software engineering team experiences the same daily frustration: **AI coding agents suffer from chronic amnesia.**

The moment a chat window closes, a compaction event triggers, or a new subagent spawns:
- **Hard-won architectural decisions evaporate.** The agent suggests deprecated libraries or violates modular folder contracts.
- **Fixed bugs get reintroduced.** The agent silently deletes edge-case guards and regression tests it wrote three hours earlier.
- **Tokens are incinerated.** Developers spend 15 minutes of every hour re-prompting the model with the same database schemas, coding standards, and project constraints.

### Why Existing Solutions Break Down

| Traditional Approach | What Breaks in Production |
| :--- | :--- |
| **Flat Markdown Rules (`.cursorrules`, `CLAUDE.md`)** | Unranked and unbounded. As files grow, they consume 4,000+ tokens on every single turn, bloat context costs, and cause attention-degradation where models ignore instructions in the middle. |
| **Cloud Vector Databases (Pinecone, Chroma, Mem0)** | High latency (200–500ms network round-trips), mandatory cloud telemetry, recurring SaaS bills, and "semantic fuzziness" (vector embeddings match words that *sound* similar but lack technical precision). |
| **Local Background Daemons** | Heavy background Docker containers or resident Python daemons that consume gigabytes of RAM, fail silently on port conflicts, and break across OS upgrades. |

Muse Memory was engineered to replace these broken paradigms with an **in-process, dual-scope cognitive memory engine** that delivers deterministic retrieval with zero daemon processes and zero prompt overflow.

---

## 2. Comprehension: How Muse Memory Works

Muse Memory is built on six foundational engineering pillars:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MUSE MEMORY ENGINE                             │
├──────────────────────────────────────┬──────────────────────────────────────┤
│             LOCAL SCOPE              │             GLOBAL SCOPE             │
│        `<project>/.memory/`          │             `~/.memory/`             │
│  - Architecture Decision Records     │  - Personal Coding Conventions       │
│  - Active `CURRENT.md` Constraints   │  - Framework Preferences             │
│  - In-flight Session Checkpoints     │  - Cross-repo Tooling Invariants     │
└──────────────────────────────────────┴──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 DETERMINISTIC 7-STATE LIFECYCLE MACHINE                     │
│  [propose] ──► candidate ──► confirm() ──► confirmed ──► supersede()       │
│                     │                           │              │            │
│                     ▼                           ▼              ▼            │
│                  rejected                     stale        superseded       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│             MULTI-FACTOR SCORING & KNAPSACK TOKEN PACKING                   │
│   Score = Relevance + ExactAnchor + RecencyDecay + UtilityROI + Semantic    │
│           Greedy Knapsack Packing ──► Zero Prompt Token Overflow            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Pillar 1: Dual-Scope Isolation (Local vs. Global)

Project context and personal preferences must never contaminate each other:
- **Local Scope (`<project>/.memory/`)**: Repository-specific. Contains architectural decisions, bug-prone anti-patterns, active task checkpoints, and living ADRs. Checked into Git so your entire team shares project truth.
- **Global Scope (`~/.memory/`)**: Developer-specific. Contains your personal preferences (e.g., preferred test runner, formatting style, indentation) and cross-repo heuristics. Never checked into client repositories.

### Pillar 2: Guarded 7-State Lifecycle Machine

Unregulated write admission corrupts memory stores. If an agent records every passing hallucination as permanent fact, retrieval quality quickly collapses.

Muse Memory enforces an explicit, deterministic state machine:

```
  [propose] ──► candidate ──► confirm() ──► confirmed ──► supersede() ──► superseded
                    │                           │
                    ├──► markStale() ───────────┤
                    │         │                 │
                    │         ▼                 ▼
                    └──►    stale            rejected
                              │
                              └──► delete() ──► [Purged from Disk + audit.jsonl]
```

1. **`candidate`**: Freshly proposed memory extracted from conversational interactions or tool logs.
2. **`confirmed`**: Verified by developer approval, passed test executions, or explicit agent promotion.
3. **`superseded`**: Replaced by a newer architectural pattern via explicit supersession links (`superseded_by`). Old memories remain in lineage history but are excluded from active retrieval.
4. **`stale`**: Unused over an extended temporal window; flagged for compaction or re-verification.
5. **`rejected`**: Discarded during review.
6. **`deleted`**: Hard-purged from disk, with an immutable record recorded to `.memory/audit.jsonl`.

### Pillar 3: Multi-Factor Scoring & Knapsack Token Packing

When an agent needs context, sending *all* memories destroys the context window. Muse Memory dynamically evaluates every memory using a multi-factor ranking formula:

$$\text{Score} = 1.0 \times \text{LexicalBM25} + \text{ExactSymbolMatch} + \text{CodeAnchorProximity} + \text{VerificationBonus} + \text{SalienceBonus} + 0.3 \times e^{-\frac{\Delta t}{90\text{ days}}} + 0.5 \times \text{CosineSimilarity}$$

- **Exact Symbol & File Anchoring**: If your query mentions `src/auth/jwt.ts`, memories anchored directly to `jwt.ts` receive massive priority boosts over fuzzy matches.
- **Recency Decay**: Historical memories gently decay over a 90-day half-life unless reinforced by active application.
- **Utility ROI**: Memories that successfully prevented bugs or guided accepted PRs earn higher baseline rank.
- **Greedy Knapsack Packing**: Once ranked, memories are greedily packed into the exact requested `--token-budget` (e.g., 1,500 tokens). If a memory would cause an overflow, it is discarded or condensed, **guaranteeing zero prompt overflows**.

### Pillar 4: Live `CURRENT.md` Synchronization

Context compaction in coding agents (Claude Code, Cursor, Opencode) clears active thought chains. Muse Memory continuously synchronizes in-flight task states, hard constraints, and subagent checkpoints directly into **`CURRENT.md`**.

When an agent restarts or compacts, reading `CURRENT.md` instantly restores the exact operational baseline:
- High-level goal and architecture invariant.
- What is already implemented and verified.
- What is explicitly not done yet.
- The next immediate concrete task.

### Pillar 5: First-Class Code Anchors

Text-only memories drift as codebases evolve. Muse Memory attaches **structural code anchors** to memories:
- **Anchor Types**: `repository`, `file`, `module`, `symbol`, `route`, `test`.
- **Structural Hashes**: Normalizes whitespace and comments to create resilient code fingerprints.
- **Drift Detection**: When files are refactored or functions renamed, `memory doctor` detects orphaned anchors and prompts for automated reconciliation (`memory reconcile`).

### Pillar 6: Anti-Pattern Sentry (First-Class Negative Memories)

Knowing what **not** to do is often more critical than knowing what to do. Muse Memory natively stores negative patterns:
- **Types**: `DO_NOT_USE`, `FAILED_APPROACH`, `BUG_PRONE_PATTERN`.
- **Reproduction Commands**: Includes exact shell commands that trigger the failure.
- **Sentry Prioritization**: When an agent attempts a pattern tagged as a known bug, the Negative Sentry immediately elevates the warning to the top of the retrieval pack.

---

## 3. Conviction: Verifiable Engineering Proofs

Muse Memory is engineered with unyielding operational standards:

### 1. Zero Background Daemons
- Runs entirely in-process using SQLite WAL mode (`PRAGMA journal_mode = WAL;`).
- Zero long-running background daemons, zero resident services eating laptop battery, and zero port conflicts.
- Concurrency-safe across multi-agent processes via `PRAGMA busy_timeout = 5000;`.

### 2. Microsecond Retrieval Performance
- **L0 In-Process Hot Cache**: Lookups complete in **< 50 microseconds**.
- **L1 SQLite FTS5 BM25 Search**: Lexical indexing completes queries in **< 2 milliseconds**.
- **Dual Persistence**: SQLite serves lightning-fast queries, while human-readable Markdown/YAML files preserve Git diff transparency.

### 3. Vibeguard Zero-Credential Leakage Protocol
- Built-in multi-regex credential scanner blocks API keys (`sk-*`, `ghp_*`, `npm_*`), private keys, and passwords from ever entering memory stores or terminal logs.
- Automated TruffleHog verification audits documentation and memory stores prior to commit.

### 4. Rigorous Automated Test Suite
- **844 automated tests** passing across **135 test suites**.
- Strict TypeScript compilation (`tsc --noEmit`) with zero type errors.
- Template-gated execution security: no arbitrary shell piping or unverified code execution.

---

## 4. Action: Start in Under 60 Seconds

Experience persistent cognitive memory in your local project today:

### Step 1: Initialize Local Workspace Memory
Inside your project root:
```bash
npx musememory init
```
*Creates `<project>/.memory/`, establishes `CURRENT.md`, and provisions local SQLite stores.*

### Step 2: Connect Your Coding Agent
Launch the interactive configuration assistant:
```bash
npx musememory connect
```
Select your editor (Cursor, Opencode, Claude Code, Antigravity, or Windsurf) to generate ready-to-paste configurations.

### Step 3: Verify System Integrity
Run the comprehensive diagnostic suite:
```bash
npx musememory doctor
```
*Audits database WAL integrity, verifies code anchors, inspects token budgets, and validates MCP server readiness.*

---

### Related Documentation
- 📖 **[Developer User Guide](user-guide.md)** — The 3-phase daily coding workflow (Ground → Work → Capture).
- 👥 **[Team Quickstart & Deployment Guide](team-getting-started.md)** — Multi-developer team server setup.
- 🏛️ **[Team Architecture Specification](architecture/team-slice-wiring.md)** — In-process SQLite vs networked mounts.
