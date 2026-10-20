# 🏛️ Living Architecture Decision Records & Drift Auditing

> **Copywriting Framework**: **ACCA** (*Awareness* → *Comprehension* → *Conviction* → *Action*)  
> **Target Audience**: Software Engineers, Tech Leads, and System Architects designing and maintaining production software with AI agents.

---

## 1. Awareness: The Silent Rot of Architecture Documentation

Every engineering organization starts with great intentions:
1. An engineer makes an architectural decision (e.g., *"Use SQLite WAL mode and zero-daemon background threads"*).
2. They write an Architecture Decision Record (ADR) or Wiki page.
3. Three weeks later, a new feature is merged or an AI agent refactors a service.
4. The documentation is never updated.

Within months, your documentation and your code live in two parallel universes:
```
TRADITIONAL ADR ROT:
┌───────────────────────────────┐               ┌───────────────────────────────┐
│       Documented ADR          │               │      Actual Codebase          │
│ "All handlers use Fastify"    │  ── Drift ──► │ Handlers rewritten in Hono    │
│ (Living in docs/adr/003.md)   │               │ (Nobody updated the markdown) │
└───────────────────────────────┘               └───────────────────────────────┘
                                        │
                                        ▼
                  AI AGENTS READ OUTDATED DOCS & HALLUCINATE
```

When AI agents like Cursor, Claude Code, or Antigravity read outdated docs, they happily hallucinate retired patterns, break active invariants, and reintroduce architectural anti-patterns that your team explicitly rejected.

---

## 2. Comprehension: The Living Decision Architecture

Muse Memory solves documentation rot by transforming static markdown into **living, executable architectural contracts** tied directly to structural code identity:

```
                      MUSE MEMORY LIVING ADR SYSTEM
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Living ADR (ADR-004)                             │
│  "Persist session tokens in Redis with 15-minute TTL; reject raw JWTs"      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Anchored at Write Time
          ┌────────────────────────────┴────────────────────────────┐
          ▼                                                         ▼
┌───────────────────────────────────┐     ┌───────────────────────────────────┐
│     File-Level Code Anchor        │     │       Symbol-Level Code Anchor    │
│  file_path: "src/auth/token.ts"   │     │  symbol_name: "validateSession"   │
│  base_path: "packages/auth"       │     │  structural_hash: "a4f89d..."     │
└───────────────────────────────────┘     └───────────────────────────────────┘
```

### The 4 Pillars of Living ADRs:
1. **Line-Independent Structural Code Anchors**: Anchors do not track line numbers (which change with every whitespace edit or comment). Instead, they capture normalized symbol signatures, AST bodies, and structural hashes.
2. **Write-Time Base Normalization (`base_path`)**: In monorepos and multi-package workspaces, code anchors record their exact origin package root (`base_path`). When auditors run from the monorepo root or another package, paths resolve accurately with zero missing-file false alarms.
3. **Strict Status Lifecycle**:
   - `proposed` / `candidate`: Under team review or RFC.
   - `accepted` / `confirmed`: Active standard; enforced by agents.
   - `superseded`: Replaced by a newer ADR with bidirectional hyperlinking.
   - `rejected` / `stale`: Decided against; prevented from polluting active agent memory.
4. **Atomic Save-Before-Supersede**: When creating an ADR that supersedes a prior one, the new record is safely persisted before mutating the predecessor, eliminating dangling references or corruption.

---

## 3. Conviction: Zero-Polluting Drift Auditing

How do you know if your codebase matches your architectural decisions? You run the **Documentation <-> Code Drift Engine**.

The drift auditor verifies both directions:
- **Docs ➔ Code**: Does the code cited in the ADR still exist and match its recorded structural hash?
- **Code ➔ Docs**: Are major exported symbols and modules documented in an active ADR or memory entry?

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          6-STATE DRIFT TAXONOMY                             │
├─────────────────┬───────────────────────────────────────────────────────────┤
│ State           │ Meaning & Agent Action Required                           │
├─────────────────┼───────────────────────────────────────────────────────────┤
│ 🟢 DOCUMENTED   │ Code exists, matches signature, and documentation exists. │
│ 🟢 IMPLEMENTED  │ ADR proposal is fully implemented in codebase.            │
│ 🟡 PARTIAL      │ Code exists but structural body has drifted from hash.    │
│ 🔴 CONFLICTING  │ Code implementation directly contradicts documented rule. │
│ 🟠 STALE        │ Cited file or symbol was renamed or deleted in code.      │
│ ⚪ MISSING      │ Exported symbol has zero documentation in active memory.  │
└─────────────────┴───────────────────────────────────────────────────────────┘
```

### Pure Read Paths (Zero Polluting Side Effects)
Auditing drift with `memory check --drift` or the `muse_drift_audit` MCP tool is **completely read-pure**:
- **Dangling Symlink Resilient**: Dead or circular symlinks on disk are cleanly skipped without crashing.
- **Sub-Millisecond Execution**: Precomputed corpus scans evaluate thousands of symbols in milliseconds.
- **Audit Log Purity**: Simply inspecting drift never appends noise or artificial mutations to your project audit logs (`audit.jsonl`).

---

## 4. Action: Hands-On Developer Workflow

### Step 1: Record an Architecture Decision
Create an ADR with automatic sequential numbering and automatic structural code anchors:

```bash
# Record an accepted decision citing affected files and symbols
memory adr create \
  --title "Adopt Server-Sent Events for Real-Time Agency Hub" \
  --status accepted \
  --context "Polling introduces unnecessary latency and database load during multi-agent workflows." \
  --decision "Start an SSE stream at /events on the daemon with port validation and origin checks." \
  --consequences "Clients receive real-time memory mutations; long-lived connections must be tracked." \
  --files "src/daemon.ts,src/cli/ecosystem.ts" \
  --symbols "startHub,handleDaemonCommand"
```

### Step 2: List and Inspect Active ADRs
Inspect all active, proposed, or superseded decisions in your terminal:

```bash
# List all ADRs
memory adr list

# Filter only accepted and binding standards
memory adr list --status accepted
```

### Step 3: Run the Drift Audit
Audit your repository for code drift before opening a pull request:

```bash
# Run drift audit across the current workspace
memory check --drift

# Output format example:
# [DRIFT REPORT] Total Anchors: 14 | Valid: 12 | Drifted: 1 | Stale: 1
# ⚠️ Stale: src/legacy.ts#oldHelper was deleted in commit 4b12f
# ⚠️ Drifted: src/auth.ts#verifySession body modified from recorded hash
```

### Step 4: Supersede Outdated Decisions Cleanly
When evolving architecture, replace older decisions without losing history:

```bash
# Supersede ADR-002 with ADR-007
memory adr create \
  --title "Migrate from REST Polling to SSE Streaming" \
  --supersedes "ADR-002" \
  --status accepted \
  --decision "Deprecate REST /poll in favor of SSE /events" \
  --files "src/daemon.ts"
```

Both ADRs are now linked forever in your repository: ADR-007 points to ADR-002, and ADR-002 is marked `superseded` pointing forward to ADR-007. Your AI coding agents will never accidentally resurrect deprecated patterns.
