# Design Spec: LifeOS Memory Distillation & Engine Hardening

> **Document**: `docs/superpowers/specs/2026-10-20-lifeos-memory-distillation-design.md`  
> **Date**: 2026-10-20  
> **Status**: Approved for Planning  
> **Primary Author**: Muse (Chief Agency Orchestrator)  
> **Target Scope**: `musememory` Engine (`v2.10.0` ➔ `v2.11.0`)  
> **Target Tickets**: `T-324` (CURRENT.md merge semantics), `T-050` (Loss guard), `T-177` (Pre-governance snapshots)

---

## 1. Context & Motivation

A comprehensive audit of LifeOS 7.40.4 (local installation and upstream `danielmiessler/LifeOS`) was conducted to distill its memory system ("Cortex") and associated tools into `musememory`.

### Findings & Boundaries:
1. **Existing Superiority**: MuseMemory's SQLite FTS5 BM25 engine, vector embeddings, in-process L0/L1 cache, deterministic 6-state lifecycle machine, and universal Model Context Protocol (MCP) server already far surpass LifeOS's flat-file unindexed `no-index-v1` Markdown scans and 48-item caps. Porting those flat-file constraints would regress MuseMemory.
2. **True Distillation Opportunities**: LifeOS contains battle-tested defensive mechanisms that directly solve three tracked tickets in `musememory`:
   - `T-324`: `generateSessionHandoff` overwrites `CURRENT.md` wholesale, destroying hand-added constraints.
   - `T-050`: Overnight / compaction loss guard (`ESUSPECT_SHRINK` & `ESUSPECT_EROSION`).
   - `T-177`: Pre-mutation rolling snapshot ring buffer (`snapshotBeforeWrite`).
   - **Multi-Channel Distillation Router**: A structured router (`KnowledgeDistill`) directing synthesized knowledge into actionable operational lanes (`system`, `content`, `health`) with stateful deduplication.
3. **`muse-skills` Separation**: Memory features and skills belong strictly in `musememory`. Non-memory LifeOS workings (e.g., threat modeling from `ThreatModel`, root-cause triage from `Vitals`, and rhetorical cadence from `WriteStory`) will later enhance existing `muse-skills` modes in a separate gated stage.

---

## 2. Architecture & Components

```
┌────────────────────────────────────────────────────────────────────────┐
│                          MUTATION INGESTION                            │
│  (Compaction Engine / Store Mutators / Governance Sweeps / Handoff)    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   PRE-MUTATION SNAPSHOT RING BUFFER                    │
│                        (src/snapshot.ts)                               │
│  - Captures CURRENT.md / state.db into .memory/snapshots/             │
│  - Rotating cap of 30 snapshots per target file type                   │
│  - Integrated with 'memory restore' CLI & MCP                          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    DEFENSIVE IN-LOCK MUTATION GUARDS                   │
│                        (src/quality/guards.ts)                         │
│  - ESUSPECT_SHRINK: Blocks drops >50% with zero additions or <3 items  │
│  - ESUSPECT_EROSION: Blocks net drop of >=2 items without additions    │
│  - Bypassed only via explicit { allowDrastic: true }                   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 DIFF-PRESERVING CURRENT.MD MERGE                       │
│                     (src/compaction/engine.ts)                         │
│  - Parses sections: Active Constraints, Open Loops, Checkpoints        │
│  - Unions existing hand-added constraints with new session handoffs    │
│  - Guarantees zero dropped user constraints (Closes T-324)             │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Specifications

### Component 1: In-Lock Defensive Mutation Guards (`src/quality/guards.ts`)
*Closes `T-050`*

#### Contract:
```typescript
export interface MutationSafetyOptions {
  allowDrastic?: boolean;
  minSafeFloor?: number; // Default: 3
}

export class MutationSafetyError extends Error {
  constructor(
    public readonly code: "ESUSPECT_SHRINK" | "ESUSPECT_EROSION",
    public readonly priorCount: number,
    public readonly newCount: number,
    public readonly additionsCount: number,
    message: string,
  ) {
    super(message);
    this.name = "MutationSafetyError";
  }
}

export function verifyMutationSafety(
  priorCount: number,
  newCount: number,
  additionsCount: number,
  options?: MutationSafetyOptions,
): void;
```

#### Rules:
1. If `options?.allowDrastic === true`, check passes unconditionally.
2. If `priorCount >= (options?.minSafeFloor ?? 3)` and `newCount < (options?.minSafeFloor ?? 3)`, throw `ESUSPECT_SHRINK`.
3. If `additionsCount === 0` and `(priorCount - newCount) / priorCount > 0.50`, throw `ESUSPECT_SHRINK` (mass deletion with zero replenishment).
4. If `additionsCount === 0` and `(priorCount - newCount) >= 2`, throw `ESUSPECT_EROSION` (gradual bleed without intent).

---

### Component 2: Diff-Preserving `CURRENT.md` Merge (`src/compaction/engine.ts`)
*Closes `T-324`*

#### Problem:
`generateSessionHandoff` currently formats a fresh `CURRENT.md` markdown buffer using only prompt inputs and hardcoded defaults, destroying user-written constraints added mid-session.

#### Solution:
1. Implement `parseCurrentMdSections(content: string)`:
   - Extracts items under `## Active Constraints`, `## Open Loops`, and `## Active Checkpoints`.
2. Implement `mergeCurrentConstraints(existingText: string, newConstraints: string[]): string[]`:
   - Strips markdown bullet prefixes (`- [ ]`, `-`, `*`).
   - Normalizes text (whitespace, casing) for exact matching.
   - Unions existing constraints with newly proposed constraints.
   - Removes constraints only if explicitly superseded or completed in the session payload.
3. Apply `verifyMutationSafety(existingConstraints.length, mergedConstraints.length, additions.length)` before updating disk.

---

### Component 3: Pre-Mutation Snapshot Ring Buffer (`src/snapshot.ts`)
*Closes `T-177`*

#### Specification:
- **Location**: `.memory/snapshots/`
- **Targets Supported**:
  - `current`: snapshots `CURRENT.md` as `current__<timestamp>.md`
  - `state`: snapshots `state.db` as `state__<timestamp>.db`
- **Ring Size**: Strictly 30 files per target prefix.
- **Functions**:
  ```typescript
  export interface SnapshotResult {
    path: string;
    target: "current" | "state";
    timestamp: string;
    prunedCount: number;
  }

  export function captureSnapshot(target: "current" | "state", workspaceRoot?: string): SnapshotResult;
  export function listSnapshots(target?: "current" | "state", workspaceRoot?: string): string[];
  export function restoreSnapshot(snapshotName: string, workspaceRoot?: string): void;
  ```
- **Atomicity**:
  - Files are written to `.tmp` before renaming.
  - Snapshot list is sorted lexicographically; files beyond index 30 are pruned immediately with `unlinkSync`.

---

### Component 4: Multi-Channel Distillation Router (`src/cognition/distill_router.ts`)

#### Concept:
Adapted from LifeOS `KnowledgeDistill.ts`. Converts passive memories and observations into actionable outbound lanes with stateful deduplication.

#### Lanes:
1. **`system` Lane**:
   - Matches: Confirmed `fix` entries, `rule` entries, or observations with `source === "test"` | `"build"`.
   - Action: Formats candidates for system improvements and stages them to `.memory/distill/system-upgrades.jsonl`.
2. **`content` Lane**:
   - Matches: Confirmed `architecture` or `decision` entries, or items with high salience ($\ge 0.8$).
   - Action: Generates structured RFC / architectural concept drafts in `.agents/drafts/<slug>.md`.
3. **`health` Lane**:
   - Matches: Conflicted memories (`status === "conflicted"`), unresolved candidate claims, or stale anchors.
   - Action: Compiles health advisory items for the principal/operator.

#### Stateful Deduplication (`.memory/distill_state.json`):
```json
{
  "schema_version": 1,
  "surfaced_ids": {
    "mem_01JABC...": "2026-10-20T12:00:00Z"
  },
  "item_hashes": {
    "e3b0c44298fc1c14": "2026-10-20T12:00:00Z"
  },
  "last_run": "2026-10-20T12:00:00.000Z"
}
```
Any memory ID or title hash present in `surfaced_ids` or `item_hashes` is skipped during gather unless `--force` or `{ force: true }` is passed.

#### Entry Points:
- **CLI**: `bun run memory distill-route [--days 7] [--dry-run]`
- **MCP Tool**: `memory_distill_route` returning:
  ```json
  {
    "ok": true,
    "routed": {
      "system": [{ "id": "...", "title": "...", "recommendation": "..." }],
      "content": [{ "id": "...", "title": "...", "draft_path": "..." }],
      "health": [{ "id": "...", "title": "...", "warning": "..." }]
    },
    "total_routed": 3,
    "skipped_surfaced": 14
  }
  ```

---

## 4. Testing & Verification Plan

### Test Suites:
1. `test/mutation_guards.test.ts`:
   - Drop >50% entries with 0 additions throws `ESUSPECT_SHRINK`.
   - Drop <3 entries when prior >=3 throws `ESUSPECT_SHRINK`.
   - Net drop >=2 entries throws `ESUSPECT_EROSION`.
   - Drops accompanied by sufficient additions pass.
   - `{ allowDrastic: true }` bypasses all guards.
2. `test/current_compaction_guard.test.ts`:
   - Hand-added constraints in `CURRENT.md` survive `generateSessionHandoff`.
   - Explicitly completed constraints are successfully retired.
   - Corrupt or empty handoff payloads fail closed without overwriting `CURRENT.md`.
3. `test/snapshot_ring.test.ts`:
   - Creating 35 rapid snapshots of `CURRENT.md` leaves exactly 30 newest files.
   - Restoring a snapshot accurately reverts `CURRENT.md`.
4. `test/distill_router.test.ts`:
   - Categorizes fix, architecture, and conflicted entries into `system`, `content`, and `health` lanes.
   - Rerunning the router without new data routes 0 items (`skipped_surfaced` count increments).
   - Passing `force: true` re-routes previously surfaced items.
5. **Full Gate Execution**:
   - `bunx tsc --noEmit` exits 0.
   - `bun test` passes 100% of suites.
   - `bun run build` succeeds clean.

---

## 5. Future Stage 2: `muse-skills` Enhancements (Gated Preview)

Per user directive, **no new skills will be created in `muse-skills`**. Stage 2 will exclusively enhance existing skill modes and references after Stage 1 is fully completed and verified:
- `quality-review/muse-security`: Add quantitative threat modeling (STRIDE/PASTA Likelihood × Impact) to `references/audit.md`.
- `agency-delivery/incident-response`: Add OS-level "Find Culprit" diagnostic playbooks (file descriptor and PID thread lock triage) to `references/triage.md`.
- `quality-review/humanize`: Add classical rhetorical figures and anti-cliché cadence into `references/ast-shield-and-cadence.md`.
- `quality-review/gauntlet-loop`: Add a Complexity Ratchet diff-budget gate to Automated Gate checks.
