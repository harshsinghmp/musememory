# 🛠️ Muse Memory — Developer Daily User Guide

> **Copywriting Framework**: **QUEST** (*Qualify* → *Understand* → *Educate* → *Stimulate* → *Transition*)  
> **Target Audience**: Software Engineers, Agency Architects, and Builders pairing daily with AI coding agents (Cursor, Opencode, Claude Code, Antigravity, Windsurf).

---

## 1. Qualify: Is This Guide for You?

This guide is specifically for developers and software engineers who:
- Use AI coding assistants (Cursor, Opencode, Claude Code, Antigravity, Windsurf) for serious production engineering.
- Are exhausted from re-explaining the same architectural rules, tech stack decisions, and coding standards in every new conversation.
- Have watched an AI agent blissfully rewrite a delicate module and reintroduce a bug that was solved and tested yesterday.
- Want their AI tools to compound codebase intelligence over time rather than resetting to zero on every session restart.

If you want your agent to operate like a **senior staff engineer with total recall** instead of an amnesiac intern, welcome home.

---

## 2. Understand: The Hidden Tax of Context Loss

Every developer pairing with AI pays an invisible, compounding tax every day:

```
                     TRADITIONAL AI CODING LOOP (HIGH TAX)
  ┌────────────────┐     ┌────────────────┐     ┌────────────────┐     ┌────────────────┐
  │  Start New Chat│ ──► │ Spend 10 Mins  │ ──► │  Agent Writes  │ ──► │ Agent Breaks   │
  │   or Subagent  │     │  Re-prompting  │     │  Working Code  │     │ Past Invariant │
  └────────────────┘     └────────────────┘     └────────────────┘     └────────────────┘
                                                                               │
                         ┌─────────────────────────────────────────────────────┘
                         ▼
  ┌────────────────┐     ┌────────────────┐
  │ Chat Compacts  │ ──► │ Memory Lost,   │
  │ or Closes      │     │ Start Over     │
  └────────────────┘     └────────────────┘
```

When your chat window compacts or closes:
1. **Unspoken Invariants Disappear**: The agent forgets why you chose specific libraries, how your authentication flow is structured, or which mocking libraries you avoid.
2. **Context Compaction Destroys Focus**: Mid-refactor compaction wipes out active subagent states, causing the model to hallucinate or ask "What were we working on?".
3. **Knowledge Remains Trapped**: Hard-earned solutions discovered in one terminal window never transfer to your other windows or your teammates.

Muse Memory eliminates this tax completely.

---

## 3. Educate: The 3-Phase Daily Coding Workflow

With Muse Memory installed, your daily engineering workflow transforms into a clean, 3-phase compounding loop:

```
                         THE COMPOUNDING COGNITIVE LOOP
                              ┌──────────────────┐
                              │ 1. PRE-FLIGHT    │
                              │    GROUNDING     │
                              │ (`/muse-ground`) │
                              └────────┬─────────┘
                                       │
                                       ▼
                              ┌──────────────────┐
                              │  2. IN-FLIGHT    │
                              │   COORDINATION   │
                              │  (`CURRENT.md`)  │
                              └────────┬─────────┘
                                       │
                                       ▼
                              ┌──────────────────┐
                              │  3. POST-FIX     │
                              │    CAPTURE       │
                              │ (`/muse-capture`)│
                              └──────────────────┘
```

---

### Phase 1: Pre-Flight Grounding (Start of Every Session)

Before writing or modifying any code, ground your agent in active constraints and relevant past decisions.

#### Via Agent Slash Command:
```
/muse-ground
```
*Retrieves the top relevant architectural decisions, active working constraints, and negative warnings under your exact token budget.*

#### Via Direct CLI:
```bash
# Preview what your agent will see for an active task
musememory context --query "implement stripe webhook" --token-budget 1500
```

#### What Happens Under the Hood:
- The engine searches local `.memory/` and global `~/.memory/` using FTS5 BM25 and code anchor matching.
- Any negative anti-patterns (e.g. `DO_NOT_USE`) receive instant priority elevation.
- The results are greedily packed into your exact token budget with zero prompt overflow.

---

### Phase 2: In-Flight Coordination (`CURRENT.md`)

When working through complex tasks or long-running refactors, keep your agent synchronized with `CURRENT.md`.

#### The `CURRENT.md` Contract:
Your project root's `CURRENT.md` is the **single source of truth for in-flight execution**:

```markdown
# 📍 Active Task: Migrate Session Storage to Redis

### Invariants & Hard Constraints:
- Do not add external session middleware; use the internal Redis adapter.
- Must support fallback to in-process memory in local development.

### What is Done:
- [x] Provisioned Redis client connection pool in `src/redis.ts`.
- [x] Verified connection retry backoff with unit tests.

### What is Explicitly Not Done Yet:
- [ ] Session cookie serialization and TTL renewal.
- [ ] E2E integration test for redis disconnect.

### Next Concrete Task:
- Implement TTL renewal in `src/session/manager.ts`.
```

#### Why This Protects You:
If your editor compacts context or your terminal session crashes, the agent immediately re-reads `CURRENT.md` upon resume and continues with zero hesitation or drift.

---

### Phase 3: Post-Fix Capture & Compounding

When you solve a tricky bug, establish a design constraint, or make an architectural decision, capture it immediately so you never have to solve it again.

#### Via Agent Slash Command:
```
/muse-capture
```
*Prompts the agent to distill the recent fix into an atomic memory entry, automatically running Vibeguard secret scanning before saving.*

#### Via Direct CLI:
```bash
# Capture an architectural decision
musememory capture \
  --title "Use in-process SQLite WAL with busy_timeout 5000" \
  --type "decision" \
  --content "Prevent database locking under multi-agent load by setting busy_timeout to 5000ms." \
  --tags "sqlite,concurrency,wal"

# Capture a negative anti-pattern (What NOT to do)
musememory capture \
  --title "Do not mount SQLite over NFS/SMB network shares" \
  --type "anti_pattern" \
  --content "NFS network mounts corrupt SQLite WAL headers and cause split-brain states." \
  --reproduction "mount -t nfs host:/data ./db && sqlite3 ./db/test.db"
```

---

## 4. Power Tools & Utilities

| Command | Skill | What It Does for You |
| :--- | :--- | :--- |
| `musememory why "<symbol/path>"` | `/muse-why` | Explains **why** a function or file was designed this way before you refactor it. Synthesizes past ADRs, bug fixes, and constraints. |
| `musememory health` | `/muse-health` | Runs the 5-pillar health check (store integrity, code anchors, doc/code alignment, anti-pattern sentry, technical debt) before opening a PR. |
| `musememory doctor` | — | Validates database WAL files, checks MCP server readiness, and audits token allocations. |
| `musememory ui` | — | Launches the Web Observability Studio (`http://localhost:31337`) with live visual health scorecards, memory graphs, and optimization triggers. |
| `musememory optimize` | — | Prunes dead candidate memories, removes expired observations, and defragments SQLite WAL files. |

---

## 5. Stimulate: The 30-Day Payoff

Here is what happens after two weeks of using Muse Memory:

- **Zero Repetitive Prompting**: You never have to type "Remember to use TypeScript strict mode, don't use lodash, and always mock Redis" again.
- **Immunity to Recurring Bugs**: Every bug you fix once is permanently barred from returning. If an agent tries to reintroduce a flawed approach, the Negative Sentry blocks it.
- **Seamless Subagent Swarms**: You can spin up 5 parallel subagents (frontend, backend, testing) in separate terminals; all five read from the same `team.db` and `CURRENT.md` without collision.
- **Onboarding in Seconds**: New engineers or fresh AI instances run `musememory context` and instantly understand your codebase conventions with zero human handholding.

---

## 6. Transition: Get Started in 3 Steps

Transform your AI pair programming experience right now:

### Step 1: Install Muse Memory Globally
```bash
bun add -g musememory@latest
# or: npm install -g musememory@latest
```

### Step 2: Initialize Your Repository
Navigate to any codebase and initialize memory:
```bash
cd ~/Projects/my-app
musememory init
```

### Step 3: Connect Your Editor
Run the interactive connector:
```bash
musememory connect
```
Select your editor (Cursor, Opencode, Claude Code, Antigravity, or Windsurf) and copy the generated configuration into your editor's MCP settings.

---

### Related Documentation
- 🧠 **[Core Concepts & Architecture](concepts.md)** — In-depth architectural explanation (ACCA framework).
- ⚡ **[Retrieval Performance & Guardrails](retrieval-performance-and-limits.md)** — Hot-path WeakMaps, memoized anchors, dirty-gating, limit clamping, and dry-run safety.
- 🏛️ **[Living Architecture & Drift Auditing](living-architecture-and-drift.md)** — Binding ADRs to structural code anchors and automated drift sentry.
- ⚡ **[Real-Time Daemon & Observability](daemon-and-observability.md)** — SSE event bus, CI upgrade gates, and PageIndex depth controls.
- 👥 **[Team Quickstart & Deployment Guide](team-getting-started.md)** — Deploying a shared server for engineering teams.
- 🏛️ **[Team Architecture Specification](architecture/team-slice-wiring.md)** — In-process SQLite vs networked mounts.
