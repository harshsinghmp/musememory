---
name: muse-why
description: Historical rationale and code evolution explainer. Synthesizes past ADRs, bug fixes, trade-offs, and invariants to explain why code was written the way it is before refactoring.
---

# 🤔 Muse Why (`muse-why`)

> **When to use**: Execute before modifying unfamiliar code, refactoring complex logic, or when encountering code patterns that look unusual or overly defensive.

---

## 🚀 Execution Workflow

### Step 1: Query Code Rationale ("Why is this code like this?")
Call the `muse_why` MCP tool:

```json
{
  "target": "src/mcp.ts",
  "symbol": "createServer",
  "query": "Why do we filter tools dynamically by profile?"
}
```

The "Why" reasoner traces backwards through history and synthesizes:
1. **Governing Architecture Decisions**: Living ADRs that authorized or mandated this structure.
2. **Historical Bug Fixes**: Edge cases and production regressions that necessitated defensive checks.
3. **Accepted Trade-offs**: Documented compromises between performance, complexity, and safety.
4. **Timeless Constraints**: Core architectural laws that must remain invariant.

### Step 2: Audit Fragility & Bug Friction Clusters
Call the `muse_bug_clusters` MCP tool:

```json
{
  "dir": "."
}
```

Clusters recurring issues across 5 core root causes:
- `concurrency_race`: Race conditions, lock timeouts, async synchronization.
- `type_mismatch`: Dangerous type bypasses, undefined property access.
- `state_drift`: Out-of-sync cache entries, missing invalidation.
- `resource_leak`: Unclosed file descriptors, runaway memory consumption.
- `edge_case`: Boundary errors, empty array handling, malformed input.

### Step 3: Check Pre-Flight Code & Memory Impact
Call `muse_code_impact` (or run `memory code-impact <file> --symbol <sym>`) to check direct callers, affected test suites, and composite risk levels before editing.

---

## 💻 CLI Equivalents (Zero-MCP Fallback)

```bash
# Query unified code & memory impact before editing
memory code-impact src/mcp.ts --symbol createServer

# View technical debt hotspots
memory tech-debt
```
