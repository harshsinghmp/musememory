# Multi-Repo & Monorepo Cross-Project Mesh Architecture (R16)

## Overview

Modern software ecosystems commonly organize related services, libraries, and frontends into either:
1. **Monorepos**: Managed by tools such as `pnpm-workspace.yaml`, `package.json` workspaces, `lerna.json`, or Bun workspaces.
2. **Multi-Repo Sibling Ensembles**: Multiple independent Git repositories checked out side-by-side within an agency client directory.

When an AI coding agent operates inside a single subpackage (e.g. `packages/web`), it is blind to architectural decisions, data models, or breaking changes made in adjacent packages (e.g. `packages/api` or `packages/core`).

The **Multi-Repo & Monorepo Cross-Project Mesh** provides automatic workspace discovery, cross-project memory retrieval with origin provenance, cross-package dependency contract auditing, and shared constraint propagation.

---

## Core Invariants

1. **Passive Non-Invasive Discovery**: Inspects filesystem manifests (`pnpm-workspace.yaml`, `package.json`, `lerna.json`) without mutating workspace configurations.
2. **Zero-Daemon Local Resolution**: Resolves memories across package stores directly in-process via SQLite connections.
3. **Explicit Provenance Tagging**: All memories retrieved from other packages are tagged with explicit provenance badges (e.g. `[mesh:@company/auth]`), preventing confusion with local package knowledge.
4. **Contract Drift Sentry**: Verifies that inter-package dependency exports (`main`, `module`, `exports`) and cross-repo code anchors (`repo:<name>/<path>#<symbol>`) match live implementations.
5. **Shared Invariant Broadcast**: High-priority security constraints or architectural policies can be broadcast across all packages in a single operation.

---

## Topology Architecture

```
[Monorepo Root / Workspace Root]
         │
         ├── pnpm-workspace.yaml / package.json / lerna.json
         ├── .memory/mesh_links.json (explicit external repository links)
         │
         ├──► [Node 1: packages/core] (.memory/)
         │        └── Exports: database pool, auth schemas
         │
         ├──► [Node 2: packages/api] (.memory/)
         │        └── Depends on: packages/core
         │
         └──► [Node 3: packages/web] (.memory/)
                  └── Depends on: packages/api, packages/core
```

---

## Data Structures

### 1. `MeshTopology`
```typescript
interface MeshTopology {
  rootPath: string;
  isMonorepo: boolean;
  workspaceType: "pnpm" | "npm" | "bun" | "lerna" | "multi_repo" | "single";
  nodes: MeshNode[];
}

interface MeshNode {
  name: string;
  path: string;
  nodeType: "package" | "root" | "linked_repo" | "sibling_repo";
  hasStore: boolean;
  memoryDir?: string;
  dependencies: string[];
  isCurrent?: boolean;
}
```

### 2. `MeshContractAuditResult`
```typescript
interface MeshContractAuditResult {
  valid: boolean;
  total_contracts_checked: number;
  drifted_count: number;
  missing_count: number;
  items: MeshContractItem[];
  summary: string;
}
```

---

## Operational Workflows

### 1. Cross-Project Memory Resolution (`resolveMeshMemories`)
- Scans all discovered mesh nodes having `.memory/` stores.
- Executes multi-factor similarity searches across package stores.
- Combines and sorts entries by relevance score.
- Annotates each result with `originProject` and `sourceNode`.

### 2. Shared Invariant Propagation (`propagateConstraintToMesh`)
- Ingests a high-priority constraint (e.g. zero credential exposure or database connection pool limits).
- Mirrors the invariant into every member package's `.memory/CURRENT.md` and memory store.

### 3. Cross-Package Contract Audit (`auditMeshContracts`)
- For each inter-package dependency in `package.json`, verifies that the target package's exported entry points exist on disk.
- Audits cross-repository code anchors formatted as `repo:<target>/<path>#<symbol>` against live source trees.

---

## Integration Surface

- **CLI**:
  - `memory mesh`: Displays detected topology and discovered nodes.
  - `memory mesh query <query>`: Queries memories across all packages.
  - `memory mesh check`: Audits cross-package contracts and entrypoint drift.
  - `memory mesh link <path>` / `memory mesh unlink <path>`: Manages explicit links.
  - `memory mesh propagate <constraint>`: Broadcasts shared invariants.
- **MCP Tools**:
  - `muse_mesh_status`
  - `muse_mesh_query`
  - `muse_mesh_audit`
  - `muse_mesh_link`
- **Web Studio**:
  - 🕸️ **Monorepo Mesh Tab**: Topology cards, package node status grid, search input, and contract audit table.
