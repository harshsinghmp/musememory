---
name: muse-mesh
description: Multi-repo and monorepo cross-project knowledge mesh. Resolves memories across package boundaries, broadcasts shared invariants, and audits cross-package dependency contract integrity.
---

# 🕸️ Muse Mesh (`muse-mesh`)

> **When to use**: Execute in monorepo environments (pnpm, npm, bun, lerna) or multi-repo projects when code spans multiple package boundaries or microservices.

---

## 🚀 Execution Workflow

### Step 1: Discover Monorepo Topology
Call the `muse_mesh_status` MCP tool (or run `memory mesh overview`):

```json
{
  "dir": "."
}
```

Automatically inspects `pnpm-workspace.yaml`, `package.json` workspaces, or `lerna.json`, listing all detected package nodes and explicit mesh links.

### Step 2: Query Knowledge Across Package Boundaries
Call `muse_mesh_query` to search memories across all connected packages:

```json
{
  "query": "authentication session store",
  "scope": "all"
}
```

Results include origin package provenance badges (e.g. `[mesh:@scope/core]`), preventing agents in frontend apps from hallucinating backend contract violations.

### Step 3: Broadcast Shared Invariants to All Packages
When establishing a monorepo-wide rule (e.g., "All microservices must use JWT v2 tokens"):
- Use `memory mesh propagate --constraint "Use JWT v2 tokens across all services"`.
- The invariant is atomically stamped into every package's `.memory/CURRENT.md`.

### Step 4: Audit Cross-Package Contracts
Call `muse_mesh_audit` (or run `memory mesh check`):
- Verifies that cross-package imports match valid export entrypoints.
- Flags drifted cross-repo code anchors.

---

## 💻 CLI Equivalents (Zero-MCP Fallback)

```bash
# Display monorepo mesh topology and linked packages
memory mesh overview

# Query memories across all monorepo packages
memory mesh query "database pool" --scope all

# Audit cross-package contract integrity
memory mesh check

# Propagate a critical security constraint across all packages
memory mesh propagate --constraint "Never expose database connection strings"

# Explicitly link an external sibling repository
memory mesh link ../external-service
```
