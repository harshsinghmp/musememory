# 🧭 Deep Research: Ryoku Rashin Agent OS & Architectural Blueprint for Muse Memory Dashboard 2.0

> **Date**: October 26, 2026  
> **Author**: Muse (Chief Agency Orchestrator) & Sol (Product Architect & Full-Stack Automator)  
> **Source Target**: Local Agent OS (Ryoku Rashin `http://127.0.0.1:3600`, Arch Linux, CachyOS / AMD Ryzen AI)  
> **Application Target**: Muse Memory v3.1.0 (`/home/harsh/Projects/github/musememory`)  
> **Classification**: Research, Competitive Teardown & Engineering Blueprint (Wave 23)

---

## 1. Executive Summary

A deep research investigation was conducted on the locally operating **Ryoku Rashin** Agent OS dashboard (`http://127.0.0.1:3600`) and its underlying knowledge architecture (`/home/harsh/.local/share/ryoku/rashin/`). 

Rashin presents an extraordinarily refined, high-speed, local-first agent system. Its primary strength lies in **"pre-indexing terrain"**: generating deterministic, bounded markdown files (`desktop.md`, `habits.md`, `logs.md`, `ownership.md`, `packages.md`, `ryoku-repo.md`, `system.md`, `user.md`) so that coding agents do not waste hundreds of thousands of tokens exploring the filesystem or guessing system configs. Furthermore, its user interface demonstrates remarkable speed and aesthetic polish through a fixed cyber-minimalist Japanese poster left rail, a 60fps canvas force-directed graph with auto-settling kinetic physics, live activity heatmaps, an auto-detecting agent wiring center, and an architecture-first About poster.

While Rashin is optimized for a single Arch Linux desktop environment, **Muse Memory** is designed as the universal cognitive memory engine for multi-agent agency networks and heterogeneous repositories. By distilling Rashin's best UI paradigms and pre-indexed terrain architecture, Muse Memory can leapfrog existing memory dashboards:
1. **Dual-Scope Toggle**: Seamless switching between **Local Project Scope** (`./.memory`), **Global User Scope** (`~/.memory`), and **Cross-Project Mesh**.
2. **Instant Graph / List View Toggle**: Real-time switching between a 60fps settling force canvas and a structured, searchable data grid.
3. **Terrain Vault System**: Auto-generating repo and workspace terrain maps (`stack.md`, `habits.md`, `ownership.md`, `packages.md`, `repo.md`, `logs.md`).
4. **Universal Agents Hub**: 1-click MCP wiring, live status detection across 10+ agents (Antigravity, OpenCode, Claude Code, Cursor, Copilot, Hermes, Goose, Codex), and instant copyable system prompt snippets.
5. **Poster-Style Mission Control & Quick-Start**: High-impact About panel, multi-agent onboarding guide, and searchable CLI command deck.
6. **Sub-10ms UI Performance**: Fast-exit polling, zero-framework vanilla ES modularity, and in-memory read projections.

---

## 2. In-Depth Teardown: Ryoku Rashin Agent OS

### 2.1 Aesthetic & Visual Design Language
- **Color Palette**:
  - Background: `--paper: #0e0d0b` (Deep obsidian/warm black), `--paper-2: #14120f`
  - Text & Accents: `--ink: #e8d8c9` (Warm parchment cream), `--ink-dim: #8f8378`
  - Functional Accents: Vermillion Red (`#C94E44`), Rust (`#9F4125`), Teal (`#3E6868`), Orange (`#f3701e`), Slate (`#4b607f`), Tan (`#CDA47B`).
- **Typography**:
  - Display: `Archivo Black` (Heavy industrial brutalism)
  - Data / Code: `JetBrains Mono`
  - Typography Principle: Clean English-only typography throughout; zero Japanese kanji or extraneous font bloat.
- **Layout Architecture**:
  - Fixed 76px vertical left rail with numbered navigation items (`01 OVERVIEW`, `02 VAULT`, `03 MEMORY`, `04 SKILLS`, `05 AGENTS`, `06 CHAT`, `07 ABOUT`).
  - Fluid stage area with generous padding (`padding-bottom: 96px`) ensuring content never abuts screen boundaries.
  - Zero framework runtime: No React, Vue, or heavy dependencies; pure native ES modules (`router.js`, `vault.js`, `memory.js`, `agents.js`, `skills.js`, `about.js`, `vitals.js`, `code.js`).

### 2.2 The Terrain Vault (`/home/harsh/.local/share/ryoku/rashin`)
The vault is a curated, pre-indexed set of markdown files representing ground truth:
1. `AGENTS.md`: The single rule contract for all coding agents. Mandates reading terrain maps before filesystem exploration.
2. `desktop.md`: Maps every desktop subsystem to config paths, owning binary, and reload commands.
3. `habits.md`: Mined local developer habits (active shell, editor, terminal, frecent zoxide directories, aliased tools).
4. `logs.md`: Structured lookup table of systemd user units and bounded journal capture commands.
5. `ownership.md`: Explicit ownership rules (shipped packages vs. user overrides vs. generated files) preventing agents from corrupting upstream configs.
6. `packages.md`: Exact counts of explicitly installed packages and pending updates.
7. `ryoku-repo.md`: Pre-indexed monorepo layout, commit SHA, file counts, and folder purposes.
8. `system.md`: Hardware, CPU cores, GPU PCI bus IDs, kernel version, display resolutions.
9. `user.md`: Exact diff of where user files deviate from the baseline.

### 2.3 The High-Speed Force-Directed Memory Canvas (`memory.js`)
- **Deterministic Ring Seeding**: Nodes are initialized in a circle (`R = 140`) to avoid chaotic initial states.
- **Physics Equations**:
  - Repulsion: $F_r = \frac{k_{\text{repulsion}}}{d^2}$ (with minimum jitter to avoid $d=0$ singularity).
  - Springs: $F_s = k_{\text{spring}} \cdot (d - d_{\text{rest}})$.
  - Center Gravity: $F_g = (c - p) \cdot k_{\text{gravity}}$.
  - Damping: $v_{t+1} = (v_t + F) \cdot 0.85$.
- **Automatic Kinetic Settling (Zero CPU Burn)**:
  - Total kinetic energy is tracked: $E = \sum (v_x^2 + v_y^2)$.
  - If $E < \text{SETTLE}$ for consecutive frames (`settleFrames > 40`), the requestAnimationFrame loop **halts completely**.
  - Wakes up only on pointer drag, window resize, or tab visibility change.
- **Reduced Motion Support**: Runs 120 headless layout steps synchronously on load and halts if `prefers-reduced-motion` is detected.

### 2.4 The Universal Agents Wiring Hub (`agents.js`)
- Inspects detected agents from standard locations (`.cursor`, `.claude`, `.omp`, `hermes`, `opencode`, `copilot`).
- Displays live status chips: `WIRED`, `UNWIRED`, `ABSENT`.
- Dedicated `WIRE` / `UNWIRE` action buttons calling `/api/agents/wire`.
- **Point Any Agent**: Displays a clear manifest table of exposed filesystem paths, owners, and permissions.
- **Copy Agent Snippet**: One-click clipboard button that copies a drop-in agent instruction prompt block.

---

## 3. Gap Analysis: Muse Memory v3.0.0 vs. Ryoku Rashin

| Dimension | Ryoku Rashin | Muse Memory (Current v3.0.0) | Muse Memory 2.0 Target (Wave 23) |
|---|---|---|---|
| **Primary Scope** | Single Linux Desktop OS | Multi-Repo / Polyglot Agency Ecosystem | Multi-Repo + Local Desktop + Team Mesh |
| **Navigation Shell** | Fixed 76px sleek left rail with clean numbered links | 11 horizontal crowded top tabs | Fixed 76px cyber-minimalist left rail (English-only) |
| **Memory View** | Canvas graph only (no list view) | 3D/2D Canvas graph only | **Toggle Switch: Interactive Graph ↔ Filterable Data Grid** |
| **Scope Switching** | Vault-only (no scope switcher) | Active project store only in UI | **Dual-Scope Switcher: Project Scope \| Global Scope \| Mesh** |
| **Terrain Vault** | 9 pre-indexed markdown maps | Only raw `.memory/` + `CURRENT.md` | **6 Auto-Generated Workspace Terrain Maps (`stack.md`, `habits.md`, etc.)** |
| **Activity Telemetry** | 52-week activity heatmap + sessions | Audit list only | **52-Week Activity Heatmap + Agent Session Ledger** |
| **Agent Wiring Hub** | Detected agents + 1-click wire + snippet | CLI-only agent connectors (`connect.ts`) | **Full UI Agent Hub: Status, 1-Click MCP Wire, Snippet Copier** |
| **About / Quick Start**| Poster-style About with live facts & CLI tips | Missing About tab | **Poster-Style Architecture Mission Control & Agent Quick Start** |
| **Graph Performance** | Auto-settles and stops rAF (0% idle CPU) | Unbounded animation ticks | **Kinetic settling threshold, ETag caching, sub-10ms endpoints** |

---

## 4. Wave 23: Production Implementation Roadmap (PRs & GitHub Issues)

Below is the complete 18-ticket specification (T-405 through T-422), grouped into 6 production pull requests / GitHub issues for Muse Memory.

```
Wave 23 (v3.1.0): Dashboard Overhaul, Terrain Maps & High-Speed Agent Hub
├── PR 1: Left-Rail Cyber-Minimalist Shell, Typography & Dual-Scope Switcher [T-405, T-406, T-407]
├── PR 2: Memory Studio 2.0: Instant Graph/List View Toggle, Physics Settling & Activity Heatmap [T-408, T-409, T-410]
├── PR 3: Workspace Terrain Vault: Auto-Generated Context Maps & Split Markdown Reader [T-411, T-412, T-413]
├── PR 4: Universal Agents Hub: Detection, 1-Click MCP Wiring & Prompt Snippets [T-414, T-415, T-416]
├── PR 5: About & Cognitive Mission Control: Architecture Specs, Quick Start & CLI Cheatsheet [T-417, T-418, T-419]
└── PR 6: System Speed, In-Memory Caching & Performance Hardening [T-420, T-421, T-422]
```

---

### PR 1 / Issue #1: Left-Rail Cyber-Minimalist Shell, Typography & Dual-Scope Switcher
**Goal**: Transform the UI into a distraction-free, ultra-responsive workstation with instant scope switching.

- **T-405 · UI Shell**: Replace top horizontal tabs with a fixed 76px vertical left rail featuring:
  - Brand Mark: Pulsing obsidian disc with glowing indigo rim.
  - Numbered Navigation: `01 OVERVIEW`, `02 VAULT`, `03 MEMORY`, `04 AGENTS`, `05 OBSERVABILITY`, `06 ABOUT`.
  - Palette: `#0b0d10` canvas, `#e8d8c9` warm text, JetBrains Mono font, and high-contrast status stamps (English-only, zero kanji).
  - *Files*: `src/ui.ts` · *Gate*: F
- **T-406 · Dual-Scope Memory Switcher**: Add a top header segment switch:
  - `[ Local Project Scope (./.memory) | Global User Scope (~/.memory) | Cross-Project Mesh ]`
  - Dynamically updates active store query without page reload.
  - Color-codes entries by scope: Local (Indigo), Global (Amber), Mesh (Emerald).
  - *Files*: `src/ui.ts`, `src/store.ts`, `src/root.ts` · *Gate*: F
- **T-407 · Sub-10ms UI Route Architecture**: Refactor `src/ui.ts` to serve modular static assets with ETag headers, pre-compressed gzip buffers, and instantaneous route transitions.
  - *Files*: `src/ui.ts` · *Gate*: F

---

### PR 2 / Issue #2: Memory Studio 2.0: Instant Graph/List View Toggle, Physics Settling & Activity Heatmap
**Goal**: Combine the intuitive spatial awareness of graphs with the high-density filtering of data grids.

- **T-408 · Graph vs List Toggle Switch**: Implement an instant segment control in the Memory panel:
  - **Graph View**: Canvas force-directed graph.
  - **List View**: Dense, searchable data table displaying ID, Type Badge (Decision, Constraint, Bugfix, Discovery, Invariant), Title, Salience Meter, Verification Stamp, and Last Accessed.
  - Real-time client-side search input with 100ms debounce.
  - *Files*: `src/ui.ts` · *Gate*: F
- **T-409 · Energy-Settling Canvas Physics Engine**: Port Rashin's kinetic settling algorithm into Muse Memory's canvas:
  - Ring seed initialization for deterministic first render.
  - O(N^2) repulsion with 0.01 jitter protection.
  - Spring tension and center gravity damping.
  - Kinetic energy monitoring: halts `requestAnimationFrame` when $E < \text{SETTLE}$ for 40 frames (reducing idle CPU from 15% to 0%).
  - Smooth pointer drag with pointer capture and node click-to-focus.
  - *Files*: `src/ui.ts` · *Gate*: F
- **T-410 · Activity Calendar Heatmap & Agent Sessions Card**:
  - 52-week GitHub-style commit heatmap rendered via SVG/Canvas reflecting memory creation, updates, and confirmations.
  - Recent agent sessions card showing agent name, model ID, started timestamp, and message volume.
  - *Files*: `src/ui.ts`, `src/audit.ts` · *Gate*: F

---

### PR 3 / Issue #3: Workspace Terrain Vault: Auto-Generated Context Maps & Split Markdown Reader
**Goal**: Eliminate agent token waste by maintaining deterministic, pre-indexed maps of the project terrain.

- **T-411 · Workspace Terrain Generator Engine**: Add `src/vault/` engine that compiles and maintains:
  - `stack.md`: Detected package manager, Node/Bun runtime, framework versions, build targets, and pinned toolchains.
  - `habits.md`: User/team conventions, test commands, lint scripts, git branch patterns.
  - `ownership.md`: Directory boundaries, DOX contracts, critical protected files (never edit).
  - `packages.md`: Explicit production dependencies, dev tooling, audit status.
  - `repo.md`: Structural AST overview, LOC counts per directory, critical entry points.
  - `logs.md`: Recent test failure patterns, audit events, and error signatures.
  - *Files*: `src/vault/index.ts`, `src/cli.ts` · *Gate*: F
- **T-412 · Terrain Vault Split-Pane UI**:
  - Left pane: File listing with `GEN` badges for auto-compiled files and byte sizes.
  - Right pane: Rendered markdown document viewer with typography styling.
  - `REINDEX` button with animated scanline sweep calling `/api/vault/reindex`.
  - *Files*: `src/ui.ts` · *Gate*: F
- **T-413 · Terrain Token-Efficiency Test & Benchmark**:
  - Test suite asserting that terrain maps are generated deterministically and contain zero leaked credentials or absolute home path traps.
  - *Files*: `test/vault_terrain.test.ts` · *Gate*: F

---

### PR 4 / Issue #4: Universal Agents Hub: Detection, 1-Click MCP Wiring & Prompt Snippets
**Goal**: Make configuring and verifying agent connections effortless for any human or orchestrator.

- **T-414 · Coding Agent Auto-Discovery**:
  - Auto-detect installed agents: Antigravity, OpenCode, Claude Code, Cursor, Copilot CLI, Hermes, Crush, Goose, Aider, Codex.
  - Status indicator: `WIRED` (MCP registered), `UNWIRED` (detected but unlinked), `ABSENT` (not found).
  - *Files*: `src/connect.ts`, `src/ui.ts` · *Gate*: F
- **T-415 · 1-Click Wire / Unwire API**:
  - Endpoints `POST /api/agents/wire` and `POST /api/agents/unwire`.
  - Safely modifies target config files (`~/.config/opencode/opencode.json`, `~/.claude/settings.json`, `~/.cursor/mcp.json`, etc.) with atomic backup safeguards (`.bak`).
  - *Files*: `src/ui.ts`, `src/connect.ts` · *Gate*: F
- **T-416 · "Point Any Agent" Manifest & One-Click Copy Snippet**:
  - Display exposed paths: SQLite database, MCP stdio/HTTP endpoints, CURRENT.md invariants, AGENTS.md contract.
  - `COPY AGENT SNIPPET` button: Copies ready-to-paste markdown prompt block for custom LLMs.
  - *Files*: `src/ui.ts` · *Gate*: F

---

### PR 5 / Issue #5: About & Cognitive Mission Control: Architecture Specs, Quick Start & CLI Cheatsheet
**Goal**: Provide an unshakeable architectural single source of truth inside the visual studio.

- **T-417 · Poster-Style About Panel**:
  - **WHAT**: Core philosophy of Muse Memory (continuous intent engineering & agency memory compounding).
  - **THE PIECES**: Live facts table displaying: SQLite Store status, Active Scope, Memory count, Active Constraints, MCP Tools registered, Wiki Pages compiled, and Audit integrity.
  - **PRIVACY & SOVEREIGNTY**: Formal verification statement of local-only storage, zero telemetry egress, and Vibeguard secret scrubbing.
  - *Files*: `src/ui.ts` · *Gate*: F
- **T-418 · Quick-Start Interactive Onboarding**:
  - Step-by-step interactive setup cards for leading agents (Antigravity, OpenCode, Claude Code, Cursor).
  - Terminal command copy blocks and instant connection status check.
  - *Files*: `src/ui.ts` · *Gate*: F
- **T-419 · "Go Deeper" Interactive Command Deck**:
  - Searchable CLI cheatsheet: `muse recall`, `muse capture`, `muse current`, `muse brief`, `muse doctor`, `muse adr`, `muse sync`.
  - Single-click command copy with usage flags.
  - *Files*: `src/ui.ts` · *Gate*: F

---

### PR 6 / Issue #6: System Speed, In-Memory Caching & Performance Hardening
**Goal**: Guarantee sub-10ms UI interactions and 60fps rendering without system strain.

- **T-420 · In-Memory SQLite Read Projection Cache**:
  - Cache projected UI payloads in memory (`WeakMap` / bounded memory store).
  - Auto-invalidate on any mutating store transaction.
  - Direct response time drops from ~12ms to <0.5ms.
  - *Files*: `src/ui.ts`, `src/cache.ts` · *Gate*: F
- **T-421 · Fast-Exit & Visibility Sensors**:
  - Add document `visibilitychange` listeners to stop all polling intervals and animation frames when the user switches tabs.
  - *Files*: `src/ui.ts` · *Gate*: F
- **T-422 · Automated UI Performance Benchmark Suite**:
  - Headless benchmark asserting:
    - Route response times under 10ms.
    - Zero memory retention after 100 tab switches.
    - Zero unhandled rejections or CSS rendering errors.
  - *Files*: `test/ui_performance.test.ts` · *Gate*: F

---

## 5. Summary & Next Steps

By incorporating these 18 tickets across Wave 23, Muse Memory will deliver an unrivaled developer and agent experience:
- **Instant visual navigation** inspired by high-speed cyberpunk poster designs.
- **Dramatically reduced token consumption** via pre-indexed workspace terrain maps.
- **Effortless multi-agent setup** with 1-click wiring and drop-in prompt snippets.
- **Blazing fast performance** with zero idle CPU burn.
