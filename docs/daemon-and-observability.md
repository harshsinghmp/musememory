# ⚡ Real-Time Agency Hub, Daemon Observability & CI Upgrades

> **Copywriting Framework**: **QUEST** (*Qualify* → *Understand* → *Educate* → *Stimulate* → *Transition*)  
> **Target Audience**: Developers, DevOps Engineers, and AI Swarm Architects managing multi-agent environments, CI/CD pipelines, and hierarchical context retrieval.

---

## 1. Qualify: Is This Guide for You?

This guide is built for engineers and teams who:
- Run multiple AI agents simultaneously (e.g. Cursor + Claude Code + Antigravity) and want them to coordinate in real time.
- Want live SSE streaming of memory updates without hammering the filesystem with polling loops.
- Need automated CI/CD pipeline verification that enforces up-to-date memory engines with strict non-zero exit codes.
- Need token-efficient hierarchical reasoning over large documentation trees without blowing agent context windows.

---

## 2. Understand: Why Real-Time Coordination Fails

Most multi-agent systems suffer from two major bottlenecks:

### Problem A: Silent State Desynchronization
When Agent A solves a bug in Terminal 1, Agent B in Terminal 2 doesn't know about it until the developer manually re-prompts or refreshes context. Polling the filesystem burns CPU cycles and introduces file lock contention.

### Problem B: Broken CI Signals & Upgrade Blindness
Automated upgrade scripts in CI/CD often swallow errors or return exit code `0` even when registry lookups fail, dependencies fail to install, or unmasked secrets linger in configuration.

```
TRADITIONAL MULTI-AGENT INCOHERENCE:
┌────────────────────┐                   ┌────────────────────┐
│ Agent A (Terminal) │                   │ Agent B (Editor)   │
│ Resolves Auth Bug  │                   │ Still writing old  │
│ Writes to .memory  │                   │ auth code          │
└─────────┬──────────┘                   └─────────▲──────────┘
          │                                        │
          ▼                                        │
┌────────────────────┐                   ┌─────────┴──────────┐
│   Static Disk      │ ─── No Event ───► │ Amnesiac Desync    │
│   (No Stream)      │     Broadcast     │ (Duplicate Effort) │
└────────────────────┘                   └────────────────────┘
```

Muse Memory replaces this with the **Real-Time Agency Hub (SSE)** and **Deterministic CI Signals**.

---

## 3. Educate: The Core Engine Features

### Pillar 1: Real-Time Agency Hub (`memory daemon`)
The daemon provides a high-throughput, Server-Sent Events (SSE) event bus running on `http://localhost:31338/events`:
- **Real-Time Fan-Out**: Whenever any agent captures, updates, or supersedes a memory, an event is instantly fanned out to all connected subscribers.
- **CSRF & Origin Security**: Origin validation strictly blocks unauthorized web browser requests and `null` origin headers from publishing events (`403 Forbidden`).
- **Clean Socket Teardown**: Sockets are tracked and destroyed immediately upon shutdown, preventing dangling socket leaks.
- **Port Collision Protection**: Validates integer port ranges (0–65535) and handles port collisions cleanly without uncaught exceptions.
- **Graceful Signal Handling**: Listens for `SIGINT` (Ctrl+C) and `SIGTERM`, shuts down listening sockets, and exits cleanly with status 0.

### Pillar 2: Hardened Upgrade & CI Verification (`memory upgrade`)
The upgrade CLI offers predictable exit codes designed for both human terminals and automated CI/CD pipelines:
- **`memory upgrade --check`**: Queries the registry. Returns `0` if up to date; returns `1` if the registry cannot be reached or version resolution fails.
- **`--fail-on-update` / `--strict`**: Returns `1` if an update is available, allowing CI pipelines to enforce current toolchains.
- **5-Stage Gamified ASCII Progress Matrix**: Featuring an animated panda progress loader across 5 verification levels:
  1. *Vibeguard Security Audit*: Verifies zero leaked credentials in `CURRENT.md` and `USER.md`.
  2. *Package Manager Sync*: Detects `bun`, `npm`, `pnpm`, or `yarn`.
  3. *Synaptic Storage Alignment*: Verifies schemas and self-heals missing directories.
  4. *Agent Auto-Wiring*: Connects detected platforms (`cursor`, `claude-code`, etc.).
  5. *Cognitive Ascendance Complete*: Final storage verification.
- **Truthful Error Surfacing**: `RepairResult.errors` captures and logs warnings instead of swallowing exceptions.

### Pillar 3: Reasoning Tree PageIndex (`pageindex`)
Token-budget-aware hierarchical navigation over large Markdown document structures:
- **`maxDepth` Pruning**: Traversal stops cleanly at the requested tree depth, preventing expensive runaway walks on deep documentation trees.
- **3-Tier Disclosure Depths**:
  - `L1` (Compact): Node titles and high-level summaries without full citations. Ideal for rapid index scanning.
  - `L2` (Standard): Node summaries, section hierarchy, and key structural citations.
  - `L3` (Comprehensive): Complete section content, verbatim code snippets, and full citation accounting.

---

## 4. Stimulate: Seeing It In Action

### Launching the Daemon
Start the real-time agency hub on your default port:

```bash
# Start daemon with default port (31338)
memory daemon

# Or specify custom port with explicit binding
memory daemon --port 4000
```

### Subscribing to Memory Events
In any terminal, script, or browser dashboard:

```bash
# Listen to live SSE memory event stream
curl -N http://localhost:31338/events
```

### Checking for Updates in CI
Enforce that CI runs on the latest version of Muse Memory:

```bash
# Check if update is available; fail CI if outdated
memory upgrade --check --strict

# Or standard silent check
memory upgrade --check
```

### Performing Self-Healing Upgrades
Upgrade your local workstation with dry-run protection or live level-up:

```bash
# Preview upgrade actions without making changes
memory upgrade --dry-run

# Run full self-healing upgrade
memory upgrade
```

---

## 5. Transition: Integrate Into Your Workflow

To integrate these capabilities into your daily engineering setup:
1. Add `memory upgrade --check --strict` to your GitHub Actions pre-commit or CI workflow.
2. Run `memory daemon` in a background terminal when running multi-agent swarms.
3. Configure your agents to use `L1` disclosure depth when exploring indexes and switch to `L3` only when reading detailed implementation files.
