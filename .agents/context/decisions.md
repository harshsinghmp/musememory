# 🏛️ Locked Architectural Decisions (ADRs)

> **Directive**: These decisions are binding. Do not casually reopen or refactor away from these foundations.

---

### ADR-001: Zero-Daemon, File-Backed Engine
- **Decision**: All storage and indexing run in-process using embedded SQLite (`bun:sqlite` / SQLite3) and flat Markdown/JSON files.
- **Rationale**: Developers and AI agents must not be blocked by disconnected Docker containers or background server crashes.

### ADR-002: Dual-Persistence (SQLite + YAML Mirror)
- **Decision**: Memory entries are stored in indexed SQLite for sub-millisecond retrieval and simultaneously mirrored to `.memory/memories/*.yaml`.
- **Rationale**: Enables lightning-fast programmatic queries while preserving 100% human and Git diff readability.

### ADR-003: MCP Stdio Protocol
- **Decision**: Implement Model Context Protocol via standard I/O (`stdio`).
- **Rationale**: Cleanest, lowest-overhead integration across all AI agent harnesses (Claude Code, Cursor, Antigravity, OpenCode).

### ADR-004: In-Flight Secret Interception (Vibeguard)
- **Decision**: Secrets are scanned in-memory before file writes and rejected immediately.
- **Rationale**: Once a secret enters a local database or git repository, rotating and purging it causes severe disruption.

### ADR-005: Bun-First Runtime & Toolchain
- **Decision**: Use Bun as the primary test runner, bundler, and local runtime, compiling to portable Node.js binaries for npm distribution.
- **Rationale**: Instant test iteration (`bun test`) and seamless zero-dependency distribution.

### ADR-006: Harness-Independent Hook Installation (Global Standard First)
- **Decision**: `memory hooks install` resolves its target as explicit `settingsPath` → explicit `--harness` opt-in → global standard (project `.agents/hooks.json` when a `.agents/` directory exists, otherwise `~/.agents/hooks.json`). A harness path (e.g. `~/.claude/settings.json`) is never auto-selected, and `connectAgent` skips harness-specific agents without an explicit `--harness` opt-in.
- **Rationale** (principal ruling, 2026-10-15): the runtime is vendor-neutral — hooks must not couple memory to one harness or create a harness directory unprompted. A pre-existing harness settings file does not imply consent; only `--harness claude` does.

### ADR-007: Client Scope Descoped from the Memory Store
- **Decision** (2026-11-09): `scope: client` is not added to `MemoryScope`. Client enclaves remain an explicit encrypted vault (`memory enclave create|list|put|rotate`) outside normal retrieval, recall, and MCP surfaces.
- **Rationale**: wiring a tenant scope through store/retrieval/sync would make cross-tenant disclosure a single filter bug away. The encrypted vault has its own key lifecycle and is auditable at the CLI boundary. Revisit only with a tenant-aware store substrate and per-client key rotation tests.

### ADR-008: Agent Workspace Tracking Boundary (T-450)
- **Decision** (2026-11-09): keep `.agents/standards/`, `.agents/skills/`, `.agents/context/`, `.agents/brand/`, `.agents/artifacts/` and `.agents/research/` tracked. Ignore new ephemeral state under `.agents/plans/`, `.agents/archive/`, `.agents/worktree-leases/` and `.agents/scratch/`. Already-tracked files stay tracked for history; the rule applies to new files.
- **Rationale**: standards, skills, decisions, evidence and audit artifacts are collaborator-facing truth. Plans, leases and scratch are per-agent working state that causes churn and merge noise. Removing already-tracked history would break links in prior tickets, so the boundary moves forward only.

### ADR-009: Browser Origins Are Denied by Default (v3.4.6)
- **Decision** (2026-11-27): the loopback MCP HTTP server refuses any request carrying an `Origin` header unless that exact origin is listed in `--allowed-origins`, on both the preflight and the actual request. Native clients — which send no `Origin` — remain tokenless-capable on loopback.
- **Rationale**: a tokenless loopback server is reachable by any page the user visits; the browser is the only caller that reliably identifies itself, so the header is the boundary. Default-deny keeps the local developer workflow intact while closing the drive-by case. Revisit only with a per-session nonce issued through a native handshake.

### ADR-010: Instruction-Bearing Writes Wait as Candidates (v3.4.6)
- **Decision** (2026-11-27): a write whose title+content trips the instruction classifier is persisted as `candidate` unless the caller passes `confirmed: true`, and it never reaches CURRENT.md from that path. `provenance` records channel, agent and capture time; no prompt hash is invented.
- **Rationale**: OWASP LLM01:2026 treats memory persistence as an injection path, and ASI06 names the same failure. A false positive costs one confirmation; a false negative replays an attacker's rule as knowledge in every later session. The classifier is deliberately conservative (strong idioms, or two of four weak signals, prose only).

### ADR-011: Release Assets Are Signed and Verified In-Job (v3.4.6)
- **Decision** (2026-11-27): publishing a release triggers `release-assets.yml`, which signs the SBOM and `SHA256SUMS` keyless with cosign and runs `verify-blob` against this workflow's identity at the tag before uploading. A signature nobody checks is not shipped.
- **Rationale**: build provenance says who built an artefact, not what is inside it, and the 2026 incident class defeated provenance. The SBOM is the only place the `--external` native binary appears with a hash. Keyless avoids a long-lived signing key in the repository; the identity check makes another workflow's signature fail.

### ADR-012: 3.x Is a Compatibility Line; Surface and Retrieval Changes Wait for 4.0
- **Decision** (2026-11-27): tool names, ranking inputs and the on-disk format are frozen for 3.x. Concretely:
  - **#496 — no 126 → ~20 verb consolidation in 3.x.** Profiles (`core`, `coding`, `debugging`, `review`, `architecture`, `maintenance`, `full`) remain the token-control surface; `full` is opt-in. A 4.0 release may introduce the verb core plus a `memory_query` long tail, with an alias table and at least one 3.x release of deprecation warnings.
  - **#502 — `prefilter` stays opt-in.** Flipping the default changes which memories can enter the candidate set, and the zero-match penalty is not equivalent to a full scan. It becomes the default only after a benchmark on ≥2,000 entries shows a p95 improvement with recall@5 unchanged; the SQL candidate union is the 4.0 path.
  - **#497 — no in-process embedder in 3.x.** `vec0` KNN already replaced `index.json`, but shipping ONNX/llama.cpp means a new native dependency and model distribution. The HTTP embedder remains the semantic path; the local embedder is a 4.0 workstream.
  - **#494 — `server/discover` stays blocked.** Resources and prompts shipped in 3.4.5; the 2026-07-28 revision is absent from the installed SDK's `SUPPORTED_PROTOCOL_VERSIONS`, and the server will not claim a revision it cannot negotiate.
- **Rationale**: every one of these is a client-visible contract change. A 3.x patch that renames a tool or narrows a candidate set breaks prompts and scripts that users already wrote, for an efficiency gain they did not ask for. The compatibility line is what makes the security fixes shippable in patch releases. The 4.0 release must ship a migration table, not just new names.
