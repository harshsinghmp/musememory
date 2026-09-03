---
name: muse-drift
description: Living Architecture Decision Records (ADRs) and bidirectional documentation-to-code drift auditor. Investigates architectural drift, records living decisions, and maintains doc-code harmony.
---

# 🏛️ Muse Drift (`muse-drift`)

> **When to use**: Execute when introducing architectural changes, making technology choices, refactoring system boundaries, or checking if documentation matches actual implementation.

---

## 🚀 Execution Workflow

### Step 1: Audit Documentation $\longleftrightarrow$ Code Alignment
Call the `memory_drift_audit` MCP tool (or run `memory drift`):

```json
{
  "dir": "."
}
```

The auditor classifies documented items across 6 mutually exclusive states:
- `DOCUMENTED`: Architectural guidelines described in docs/ADRs.
- `IMPLEMENTED`: Verified clean match between doc and code AST.
- `PARTIAL`: Incomplete implementation or missing export.
- `CONFLICTING`: Code directly contradicts documented architecture.
- `STALE`: Document references removed modules or legacy abstractions.
- `MISSING`: Code exists with zero architectural documentation.

### Step 2: Record Living Architecture Decision Records (ADRs)
When establishing or changing an architectural design decision, record a first-class ADR using `memory_adr_record`:

```json
{
  "title": "Use SQLite WAL and Microsecond In-Process Memory Cache",
  "decision": "All memory read/write operations must use in-process SQLite WAL mode with an L0 hot cache. No resident background daemons.",
  "status": "accepted",
  "context_and_drivers": [
    "Zero-daemon constraint",
    "Sub-millisecond latency requirement for CLI commands"
  ],
  "consequences": {
    "positive": ["Microsecond hot cache lookups", "Concurrent multi-process reads"],
    "negative": ["Requires file locking management on write"]
  },
  "anchors": [
    { "kind": "file", "file_path": "src/store.ts" },
    { "kind": "file", "file_path": "src/cache.ts" }
  ]
}
```

### Step 3: Supersede Obsolete Decisions
When replacing an existing ADR, provide the `supersedes` parameter with the old ADR ID. The engine automatically marks the old decision as `superseded` and records full provenance in the audit ledger.

---

## 💻 CLI Equivalents (Zero-MCP Fallback)

```bash
# Check repository documentation vs code drift
memory drift

# List all living Architecture Decision Records
memory adr list

# Record a new Architecture Decision Record
memory adr record "Decision Title" --decision "..." --positive "..." --negative "..."
```
