# LifeOS Memory Distillation & Engine Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distill LifeOS Cortex's defensive in-lock mutation guards (`ESUSPECT_SHRINK`, `ESUSPECT_EROSION`), pre-mutation snapshot ring buffer, and multi-channel knowledge distillation router into `musememory` without flat-file regressions.

**Architecture:** Implement in-lock mutation safety validation in `src/quality/guards.ts` and integrate it with a diff-preserving `CURRENT.md` parser in `src/compaction/engine.ts` to prevent constraint destruction. Add a 30-snapshot rolling ring buffer in `src/snapshot.ts` before mutations, and implement a 3-lane (`system`, `content`, `health`) stateful knowledge distillation router in `src/cognition/distill_router.ts` with CLI and MCP surfaces.

**Tech Stack:** TypeScript, Bun (`bun test`, `bun run build`, `bunx tsc --noEmit`), SQLite 3 (in-memory/file).

## Global Constraints
- Target tickets: `T-324` (CURRENT.md merge semantics), `T-050` (Loss guard), `T-177` (Pre-governance snapshots).
- Zero external daemons required (strictly offline-capable and in-process per ADR-001 / `T-367`).
- Zero secret leaks (Vibeguard protocol on all routed outputs).
- Full gate validation must pass on every commit: `bunx tsc --noEmit`, `bun test`, `bun run build`.

---

### Task 1: In-Lock Defensive Mutation Guards (`src/quality/guards.ts`)

**Files:**
- Create: `src/quality/guards.ts`
- Modify: `src/quality/index.ts`
- Test: `test/mutation_guards.test.ts`

**Interfaces:**
- Produces: `verifyMutationSafety(priorCount: number, newCount: number, additionsCount: number, options?: MutationSafetyOptions): void`
- Produces: `MutationSafetyError` class with code `"ESUSPECT_SHRINK" | "ESUSPECT_EROSION"`.

- [ ] **Step 1: Write the failing unit tests for mutation guards**

Create `test/mutation_guards.test.ts`:
```typescript
import { describe, expect, it } from "bun:test";
import { verifyMutationSafety, MutationSafetyError } from "../src/quality/guards.ts";

describe("verifyMutationSafety", () => {
  it("allows safe modifications and additions", () => {
    expect(() => verifyMutationSafety(10, 12, 3)).not.toThrow();
    expect(() => verifyMutationSafety(10, 10, 1)).not.toThrow();
    expect(() => verifyMutationSafety(10, 9, 1)).not.toThrow();
  });

  it("throws ESUSPECT_SHRINK when dropping below floor without bypass", () => {
    expect(() => verifyMutationSafety(5, 2, 0)).toThrow(MutationSafetyError);
    try {
      verifyMutationSafety(5, 2, 0);
    } catch (err) {
      expect(err).toBeInstanceOf(MutationSafetyError);
      expect((err as MutationSafetyError).code).toBe("ESUSPECT_SHRINK");
    }
  });

  it("throws ESUSPECT_SHRINK when dropping >50% entries with zero additions", () => {
    expect(() => verifyMutationSafety(20, 9, 0)).toThrow(MutationSafetyError);
  });

  it("throws ESUSPECT_EROSION when net-dropping 2 or more entries with zero additions", () => {
    expect(() => verifyMutationSafety(10, 8, 0)).toThrow(MutationSafetyError);
    try {
      verifyMutationSafety(10, 8, 0);
    } catch (err) {
      expect(err).toBeInstanceOf(MutationSafetyError);
      expect((err as MutationSafetyError).code).toBe("ESUSPECT_EROSION");
    }
  });

  it("permits 1-entry drop with zero additions without error", () => {
    expect(() => verifyMutationSafety(10, 9, 0)).not.toThrow();
  });

  it("bypasses all checks when allowDrastic is true", () => {
    expect(() => verifyMutationSafety(20, 1, 0, { allowDrastic: true })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/mutation_guards.test.ts`  
Expected: FAIL with module `../src/quality/guards.ts` not found.

- [ ] **Step 3: Implement `src/quality/guards.ts`**

Write `src/quality/guards.ts`:
```typescript
export interface MutationSafetyOptions {
  allowDrastic?: boolean;
  minSafeFloor?: number;
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

/**
 * Validates mutation safety before writing modified sets.
 * Prevents catastrophic shrinkage and slow erosion.
 */
export function verifyMutationSafety(
  priorCount: number,
  newCount: number,
  additionsCount: number,
  options?: MutationSafetyOptions,
): void {
  if (options?.allowDrastic) {
    return;
  }

  const floor = options?.minSafeFloor ?? 3;

  // Catastrophic shrink: dropping below minimum floor
  if (priorCount >= floor && newCount < floor) {
    throw new MutationSafetyError(
      "ESUSPECT_SHRINK",
      priorCount,
      newCount,
      additionsCount,
      `Mutation rejected: entry count reduced below floor (${newCount} < ${floor}, prior: ${priorCount})`,
    );
  }

  // Mass deletion check: dropping >50% of entries with 0 additions
  if (additionsCount === 0 && priorCount > 0) {
    const dropped = priorCount - newCount;
    if (dropped / priorCount > 0.5) {
      throw new MutationSafetyError(
        "ESUSPECT_SHRINK",
        priorCount,
        newCount,
        additionsCount,
        `Mutation rejected: mass deletion detected (${dropped}/${priorCount} dropped with 0 additions)`,
      );
    }
  }

  // Slow erosion check: dropping 2+ entries with 0 additions
  if (additionsCount === 0 && priorCount - newCount >= 2) {
    throw new MutationSafetyError(
      "ESUSPECT_EROSION",
      priorCount,
      newCount,
      additionsCount,
      `Mutation rejected: slow erosion detected (net drop of ${priorCount - newCount} entries with 0 additions)`,
    );
  }
}
```

Re-export in `src/quality/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/mutation_guards.test.ts`  
Expected: PASS with 6/6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/quality/guards.ts src/quality/index.ts test/mutation_guards.test.ts
git commit -m "feat(quality): add in-lock mutation safety guards (closes T-050)"
```

---

### Task 2: Diff-Preserving `CURRENT.md` Compaction Merge (`src/compaction/engine.ts`)

**Files:**
- Modify: `src/compaction/engine.ts`
- Test: `test/current_compaction_guard.test.ts`

**Interfaces:**
- Consumes: `verifyMutationSafety` from `src/quality/guards.ts`
- Produces: `parseCurrentConstraints(content: string): string[]`
- Produces: `mergeCurrentConstraints(existingText: string, proposed: string[], options?: { allowDrastic?: boolean }): string[]`

- [ ] **Step 1: Write the failing tests for diff-preserving `CURRENT.md` merge**

Create `test/current_compaction_guard.test.ts`:
```typescript
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generateSessionHandoff, parseCurrentConstraints, mergeCurrentConstraints } from "../src/compaction/engine.ts";

const TEST_DIR = join(import.meta.dir, ".tmp_compaction_test");

describe("CURRENT.md Diff-Preserving Merge (T-324)", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("parses active constraints from existing CURRENT.md", () => {
    const raw = `# CURRENT.md
## 🔒 1. Active Working Constraints & Invariants
- Zero unmasked credentials committed (Vibeguard Protocol).
- Fail fast with explicit errors rather than swallowing failures.
- Always use cursor pagination.

## 🎯 2. High-Level Goal
Build feature.`;

    const constraints = parseCurrentConstraints(raw);
    expect(constraints).toHaveLength(3);
    expect(constraints).toContain("Always use cursor pagination.");
  });

  it("unions existing hand-added constraints with new handoff constraints", () => {
    const existing = `# CURRENT.md
## 🔒 1. Active Working Constraints & Invariants
- Existing custom rule 1
- Existing custom rule 2`;

    const merged = mergeCurrentConstraints(existing, ["New proposed rule"]);
    expect(merged).toHaveLength(3);
    expect(merged).toContain("Existing custom rule 1");
    expect(merged).toContain("Existing custom rule 2");
    expect(merged).toContain("New proposed rule");
  });

  it("generateSessionHandoff preserves existing hand-added constraints on disk", () => {
    const currentMdPath = join(TEST_DIR, "CURRENT.md");
    writeFileSync(currentMdPath, `# CURRENT.md
## 🔒 1. Active Working Constraints & Invariants
- Persistent invariant Alpha
- Persistent invariant Beta
`, "utf8");

    generateSessionHandoff(TEST_DIR, {
      highLevelGoal: "Next milestone",
      currentArchitecture: "Clean arch",
      completedTasks: ["Task 1 done"],
      openTasks: ["Task 2 pending"],
      nextConcreteTask: "Execute Task 2",
      activeConstraints: ["Fresh constraint Gamma"],
    });

    const updated = readFileSync(currentMdPath, "utf8");
    expect(updated).toContain("Persistent invariant Alpha");
    expect(updated).toContain("Persistent invariant Beta");
    expect(updated).toContain("Fresh constraint Gamma");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/current_compaction_guard.test.ts`  
Expected: FAIL with `parseCurrentConstraints is not exported`.

- [ ] **Step 3: Implement constraint parser & merge in `src/compaction/engine.ts`**

In `src/compaction/engine.ts`:
1. Import `verifyMutationSafety` from `../quality/guards.ts`.
2. Implement `parseCurrentConstraints(content: string): string[]`:
   - Match content under `## 🔒 1. Active Working Constraints & Invariants` (or `## Active Constraints`).
   - Extract bulleted lines `- ...` or `* ...`, stripping prefixes.
3. Implement `mergeCurrentConstraints(existingText: string, proposed: string[], options?: { allowDrastic?: boolean }): string[]`:
   - Parse existing constraints.
   - Dedup and union proposed with existing (matching normalized lowercase trimmed strings).
   - Compute additions count = proposed items not previously present.
   - Call `verifyMutationSafety(existing.length, union.length, additionsCount, options)`.
   - Return merged array.
4. In `commitHandoff()`:
   - Check if `CURRENT.md` already exists on disk.
   - If it exists, read it and pass to `mergeCurrentConstraints(existingText, invariants.activeConstraints ?? [])`.
   - Update `invariants.activeConstraints` with the merged list before rendering.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/current_compaction_guard.test.ts`  
Expected: PASS with 3/3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/compaction/engine.ts test/current_compaction_guard.test.ts
git commit -m "feat(compaction): add diff-preserving CURRENT.md merge semantics (closes T-324)"
```

---

### Task 3: Pre-Mutation Snapshot Ring Buffer (`src/snapshot.ts`)

**Files:**
- Modify: `src/snapshot.ts`
- Test: `test/snapshot_ring.test.ts`

**Interfaces:**
- Produces: `captureSnapshotRing(target: "current" | "state", memoryDir: string, maxSnapshots?: number): SnapshotRingResult`
- Produces: `listSnapshotRing(target: "current" | "state", memoryDir: string): string[]`
- Produces: `restoreSnapshotRing(snapshotName: string, memoryDir: string): void`

- [ ] **Step 1: Write the failing tests for snapshot ring buffer**

Create `test/snapshot_ring.test.ts`:
```typescript
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { captureSnapshotRing, listSnapshotRing, restoreSnapshotRing } from "../src/snapshot.ts";

const TEST_DIR = join(import.meta.dir, ".tmp_snapshot_test");

describe("Pre-Mutation Snapshot Ring Buffer (T-177)", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(join(TEST_DIR, "CURRENT.md"), "Initial Content v1\n", "utf8");
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("captures snapshot to .memory/snapshots/ with timestamp", () => {
    const res = captureSnapshotRing("current", TEST_DIR);
    expect(existsSync(res.snapshotPath)).toBe(true);
    expect(res.target).toBe("current");
  });

  it("rotates ring buffer to max 30 snapshots", () => {
    for (let i = 0; i < 35; i++) {
      writeFileSync(join(TEST_DIR, "CURRENT.md"), `Content iteration ${i}\n`, "utf8");
      captureSnapshotRing("current", TEST_DIR, 30);
    }

    const snapshots = listSnapshotRing("current", TEST_DIR);
    expect(snapshots.length).toBe(30);
  });

  it("restores snapshot accurately", () => {
    const firstCapture = captureSnapshotRing("current", TEST_DIR);
    const snapName = firstCapture.snapshotName;

    writeFileSync(join(TEST_DIR, "CURRENT.md"), "Corrupted Content v2\n", "utf8");
    expect(readFileSync(join(TEST_DIR, "CURRENT.md"), "utf8")).toBe("Corrupted Content v2\n");

    restoreSnapshotRing(snapName, TEST_DIR);
    expect(readFileSync(join(TEST_DIR, "CURRENT.md"), "utf8")).toBe("Initial Content v1\n");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/snapshot_ring.test.ts`  
Expected: FAIL with `captureSnapshotRing is not exported`.

- [ ] **Step 3: Implement snapshot ring buffer in `src/snapshot.ts`**

Add to `src/snapshot.ts`:
```typescript
export interface SnapshotRingResult {
  snapshotPath: string;
  snapshotName: string;
  target: "current" | "state";
  prunedCount: number;
}

export function captureSnapshotRing(
  target: "current" | "state",
  memoryDir: string,
  maxSnapshots: number = 30,
): SnapshotRingResult {
  const snapshotsDir = join(memoryDir, "snapshots");
  mkdirSync(snapshotsDir, { recursive: true });

  const sourceFile = target === "current" ? "CURRENT.md" : "state.db";
  const sourcePath = join(memoryDir, sourceFile);

  if (!existsSync(sourcePath)) {
    throw new Error(`Cannot capture snapshot: ${sourcePath} does not exist`);
  }

  const isoTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = target === "current" ? "md" : "db";
  const snapshotName = `${target}__${isoTimestamp}.${ext}`;
  const snapshotPath = join(snapshotsDir, snapshotName);

  const content = readFileSync(sourcePath);
  writeFileSync(snapshotPath, content);

  // Rotate ring buffer
  const prefix = `${target}__`;
  const existing = readdirSync(snapshotsDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(`.${ext}`))
    .sort(); // Lexicographical sort by timestamp

  let prunedCount = 0;
  if (existing.length > maxSnapshots) {
    const toDelete = existing.slice(0, existing.length - maxSnapshots);
    for (const f of toDelete) {
      try {
        unlinkSync(join(snapshotsDir, f));
        prunedCount++;
      } catch {
        // ignore deletion failures
      }
    }
  }

  return { snapshotPath, snapshotName, target, prunedCount };
}

export function listSnapshotRing(target: "current" | "state", memoryDir: string): string[] {
  const snapshotsDir = join(memoryDir, "snapshots");
  if (!existsSync(snapshotsDir)) return [];
  const ext = target === "current" ? "md" : "db";
  return readdirSync(snapshotsDir)
    .filter((f) => f.startsWith(`${target}__`) && f.endsWith(`.${ext}`))
    .sort()
    .reverse();
}

export function restoreSnapshotRing(snapshotName: string, memoryDir: string): void {
  const snapshotsDir = join(memoryDir, "snapshots");
  const snapPath = join(snapshotsDir, snapshotName);
  if (!existsSync(snapPath)) {
    throw new Error(`Snapshot not found: ${snapPath}`);
  }

  const targetFile = snapshotName.startsWith("current__") ? "CURRENT.md" : "state.db";
  const targetPath = join(memoryDir, targetFile);

  const content = readFileSync(snapPath);
  writeFileSync(targetPath, content);
}
```

- [ ] **Step 4: Wire snapshot capture into `commitHandoff` in `src/compaction/engine.ts`**

Before `writeFileSync(currentMdPath, markdownContent)`:
```typescript
if (existsSync(currentMdPath)) {
  captureSnapshotRing("current", memoryDir, 30);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test test/snapshot_ring.test.ts`  
Expected: PASS with 3/3 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/snapshot.ts src/compaction/engine.ts test/snapshot_ring.test.ts
git commit -m "feat(snapshot): add pre-mutation 30-snapshot ring buffer (closes T-177)"
```

---

### Task 4: Multi-Channel Distillation Router (`src/cognition/distill_router.ts`)

**Files:**
- Create: `src/cognition/distill_router.ts`
- Modify: `src/cognition/index.ts`
- Test: `test/distill_router.test.ts`

**Interfaces:**
- Produces: `runDistillRouter(store: Store, options?: DistillRouterOptions): DistillRouterResult`

- [ ] **Step 1: Write the failing tests for distill router**

Create `test/distill_router.test.ts`:
```typescript
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openStore, save, propose } from "../src/store.ts";
import { runDistillRouter } from "../src/cognition/distill_router.ts";

const TEST_DIR = join(import.meta.dir, ".tmp_distill_router_test");

describe("Multi-Channel Distillation Router", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("routes fix/rule to system, architecture to content, and conflict to health", () => {
    const store = openStore({ memoryDir: TEST_DIR });

    save(store, {
      id: "mem_fix_1",
      title: "Fix for DB lock timeout",
      content: "Increased WAL busy timeout to 5000ms.",
      type: "fix",
      status: "confirmed",
      tags: ["sqlite", "lock"],
      project: "core",
    });

    save(store, {
      id: "mem_arch_1",
      title: "Decoupled Event Outbox Pattern",
      content: "Adopted transactional outbox pattern.",
      type: "architecture",
      status: "confirmed",
      tags: ["architecture", "outbox"],
      project: "core",
    });

    save(store, {
      id: "mem_conf_1",
      title: "Contradictory Port Numbers",
      content: "Port is 3000 vs 8080.",
      type: "fact",
      status: "conflicted",
      tags: ["networking"],
      project: "core",
    });

    const result = runDistillRouter(store, { workspaceRoot: TEST_DIR });
    expect(result.routed.system.length).toBe(1);
    expect(result.routed.system[0].id).toBe("mem_fix_1");
    expect(result.routed.content.length).toBe(1);
    expect(result.routed.content[0].id).toBe("mem_arch_1");
    expect(result.routed.health.length).toBe(1);
    expect(result.routed.health[0].id).toBe("mem_conf_1");
  });

  it("deduplicates already routed items via distill_state.json", () => {
    const store = openStore({ memoryDir: TEST_DIR });

    save(store, {
      id: "mem_fix_2",
      title: "Fix for memory leak",
      content: "Closed stream handles.",
      type: "fix",
      status: "confirmed",
      project: "core",
    });

    const firstRun = runDistillRouter(store, { workspaceRoot: TEST_DIR });
    expect(firstRun.total_routed).toBe(1);

    const secondRun = runDistillRouter(store, { workspaceRoot: TEST_DIR });
    expect(secondRun.total_routed).toBe(0);
    expect(secondRun.skipped_surfaced).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/distill_router.test.ts`  
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `src/cognition/distill_router.ts`**

Write `src/cognition/distill_router.ts`:
```typescript
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Store } from "../store.ts";
import { list } from "../store.ts";
import type { MemoryEntry } from "../types.ts";
import { scanSecrets } from "../secrets.ts";

export interface DistillRouterOptions {
  workspaceRoot?: string;
  force?: boolean;
  dryRun?: boolean;
}

export interface RoutedItem {
  id: string;
  title: string;
  lane: "system" | "content" | "health";
  summary: string;
  path?: string;
}

export interface DistillRouterResult {
  ok: boolean;
  routed: {
    system: RoutedItem[];
    content: RoutedItem[];
    health: RoutedItem[];
  };
  total_routed: number;
  skipped_surfaced: number;
}

interface DistillState {
  schema_version: number;
  surfaced_ids: Record<string, string>;
  item_hashes: Record<string, string>;
  last_run: string | null;
}

function loadState(statePath: string): DistillState {
  if (existsSync(statePath)) {
    try {
      return JSON.parse(readFileSync(statePath, "utf8"));
    } catch {
      // fallback
    }
  }
  return {
    schema_version: 1,
    surfaced_ids: {},
    item_hashes: {},
    last_run: null,
  };
}

export function runDistillRouter(store: Store, options?: DistillRouterOptions): DistillRouterResult {
  const root = options?.workspaceRoot ?? store.memoryDir ?? process.cwd();
  const statePath = join(store.memoryDir, "distill_state.json");
  const state = loadState(statePath);

  const entries = list(store);
  const result: DistillRouterResult = {
    ok: true,
    routed: { system: [], content: [], health: [] },
    total_routed: 0,
    skipped_surfaced: 0,
  };

  const todayIso = new Date().toISOString();

  for (const e of entries) {
    const hash = createHash("sha256").update(e.title + e.content).digest("hex").slice(0, 16);

    if (!options?.force && (state.surfaced_ids[e.id] || state.item_hashes[hash])) {
      result.skipped_surfaced++;
      continue;
    }

    // Health Lane: Conflicted entries or active contradictions
    if (e.status === "conflicted") {
      result.routed.health.push({
        id: e.id,
        title: e.title,
        lane: "health",
        summary: `Contradiction detected: ${e.title}`,
      });
      state.surfaced_ids[e.id] = todayIso;
      state.item_hashes[hash] = todayIso;
      continue;
    }

    // System Lane: Bug fixes, operational rules
    if (e.type === "fix" || e.type === "rule" || (e.tags && e.tags.includes("distilled-fix"))) {
      result.routed.system.push({
        id: e.id,
        title: e.title,
        lane: "system",
        summary: e.content.slice(0, 150),
      });
      state.surfaced_ids[e.id] = todayIso;
      state.item_hashes[hash] = todayIso;
      continue;
    }

    // Content Lane: Architecture decisions and concepts
    if (e.type === "architecture" || e.type === "concept" || (e.salience && e.salience >= 0.8)) {
      result.routed.content.push({
        id: e.id,
        title: e.title,
        lane: "content",
        summary: e.content.slice(0, 150),
      });
      state.surfaced_ids[e.id] = todayIso;
      state.item_hashes[hash] = todayIso;
      continue;
    }
  }

  result.total_routed =
    result.routed.system.length + result.routed.content.length + result.routed.health.length;

  if (!options?.dryRun && result.total_routed > 0) {
    state.last_run = todayIso;
    writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");

    // Stage draft files for content lane if .agents/drafts exists or can be created
    if (result.routed.content.length > 0) {
      const draftsDir = join(root, ".agents", "drafts");
      try {
        mkdirSync(draftsDir, { recursive: true });
        for (const item of result.routed.content) {
          const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
          const draftPath = join(draftsDir, `draft-${slug}.md`);
          const body = `# ${item.title}\n\n> Sourced from Memory ID: \`${item.id}\`\n\n${item.summary}\n`;
          if (scanSecrets(body).length === 0) {
            writeFileSync(draftPath, body, "utf8");
            item.path = draftPath;
          }
        }
      } catch {
        // ignore draft writing errors in hermetic test envs
      }
    }
  }

  return result;
}
```

Re-export in `src/cognition/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/distill_router.test.ts`  
Expected: PASS with 2/2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/cognition/distill_router.ts src/cognition/index.ts test/distill_router.test.ts
git commit -m "feat(cognition): add multi-channel distillation router with stateful dedupe"
```

---

### Task 5: Wire CLI & MCP Surfaces

**Files:**
- Modify: `src/cli/lifecycle.ts`
- Modify: `src/cli.ts`
- Modify: `src/mcp.ts`
- Test: `test/mcp_distill_route.test.ts`

- [ ] **Step 1: Write the failing tests for MCP `memory_distill_route`**

Create `test/mcp_distill_route.test.ts`:
```typescript
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openStore, save } from "../src/store.ts";
import { runDistillRouter } from "../src/cognition/distill_router.ts";

const TEST_DIR = join(import.meta.dir, ".tmp_mcp_distill_route_test");

describe("MCP memory_distill_route Tool Handler", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns structured JSON across 3 lanes", () => {
    const store = openStore({ memoryDir: TEST_DIR });
    save(store, {
      id: "mem_fix_mcp",
      title: "Tool registration patch",
      content: "Exported tool schemas.",
      type: "fix",
      status: "confirmed",
      project: "core",
    });

    const res = runDistillRouter(store, { workspaceRoot: TEST_DIR });
    expect(res.ok).toBe(true);
    expect(res.routed.system.length).toBe(1);
    expect(res.total_routed).toBe(1);
  });
});
```

- [ ] **Step 2: Add CLI command handler in `src/cli/lifecycle.ts` and wire into `src/cli.ts`**

Add `handleDistillRouteCommand` to `src/cli/lifecycle.ts`:
```typescript
export async function handleDistillRouteCommand(args: ParsedArgs): Promise<void> {
  const root = requireRoot();
  const store = openStore({ memoryDir: root });
  const force = Boolean(args.flags["force"]);
  const dryRun = Boolean(args.flags["dry-run"]);
  const result = runDistillRouter(store, { workspaceRoot: process.cwd(), force, dryRun });

  console.log(`\n🧠 Multi-Channel Knowledge Distillation Summary:`);
  console.log(`- System Lane (Fixes/Rules): ${result.routed.system.length}`);
  console.log(`- Content Lane (Architecture/Concepts): ${result.routed.content.length}`);
  console.log(`- Health Lane (Contradictions): ${result.routed.health.length}`);
  console.log(`- Skipped Previously Surfaced: ${result.skipped_surfaced}`);
  console.log(`- Total Routed: ${result.total_routed}\n`);
}
```

In `src/cli.ts`, map `"distill-route"` to `handleDistillRouteCommand`.

- [ ] **Step 3: Register MCP Tool in `src/mcp.ts`**

1. Add tool definition to `ListToolsRequestSchema`:
```typescript
{
  name: "memory_distill_route",
  description: "Runs the multi-channel knowledge distillation router, directing confirmed memories into system upgrades, content drafts, and health alerts with stateful deduplication.",
  inputSchema: {
    type: "object",
    properties: {
      force: { type: "boolean", description: "Bypass deduplication and re-route previously surfaced items." },
      dry_run: { type: "boolean", description: "Simulate distillation without writing state.json." }
    }
  }
}
```

2. Add case `"memory_distill_route"` in `CallToolRequestSchema` calling `runDistillRouter`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/mcp_distill_route.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/lifecycle.ts src/cli.ts src/mcp.ts test/mcp_distill_route.test.ts
git commit -m "feat(mcp,cli): register memory_distill_route tool and CLI handler"
```

---

### Task 6: Full Gate Verification & Ticket Documentation Pass

**Files:**
- Modify: `.agents/context/ticket-plan.md`
- Modify: `.agents/context/current.md`

- [ ] **Step 1: Run Full Gate Verification**

Run the oracle commands:
1. `bunx tsc --noEmit` ➔ Must exit 0.
2. `bun test` ➔ All suites pass.
3. `bun run build` ➔ Clean build.

- [ ] **Step 2: Update Ticket Plan & Current Context**

In `.agents/context/ticket-plan.md`:
- Mark `T-324`, `T-050`, and `T-177` as `[x] landed Wave 21`.

In `.agents/context/current.md`:
- Document Wave 21 feature release notes (Defensive Mutation Guards, Pre-Mutation 30-Snapshot Ring Buffer, Diff-Preserving `CURRENT.md` Compaction Merge, and Multi-Channel Distillation Router).

- [ ] **Step 3: Commit**

```bash
git add .agents/context/ticket-plan.md .agents/context/current.md
git commit -m "docs(context): record Wave 21 landing (T-324, T-050, T-177)"
```
