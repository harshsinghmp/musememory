# Code Review — Full Codebase Audit (2026-11-11)

**Scope**: `src/` (239 files, 58,511 lines), `scripts/`, plus D2 verification
**Baseline**: `dev` @ `76c2574`, 1612 tests passing, `tsc` clean
**Method**: parallel independent reviewers (correctness/concurrency, data-structures/invariants), then every finding reproduced by the orchestrator against the working tree
**Verdict**: **REJECT** — two data-destruction defects and one prompt-integrity defect

---

## 🚨 Critical Blockers (Reject)

### 1. `INSERT OR REPLACE` silently deletes a tombstoned row [REJECT]

`src/sqlite.ts:380` + unique index on `idempotency_key` (`src/migrate.ts:73`)

SQLite's `OR REPLACE` resolves a unique-index conflict by **deleting the conflicting row**. `insertOrReplaceMemory` never clears the key from the other row, so an unrelated write with the same `idempotency_key` erases it — including a GDPR tombstone.

**Reproduced:**
```
propose(A, idempotency_key:"K1")  -> row A
deleteEntry(A, "gdpr erasure")    -> A.deleted_at set
propose(B, idempotency_key:"K1")  -> "A row after B write: ROW GONE (silently deleted)"
```

The existing "propose() cannot resurrect a tombstone" guard does not help: its key check filters `deleted_at IS NULL OR deleted_at=''`, so a tombstoned holder is invisible to the guard and then destroyed by the write.

**Fix**: `DELETE FROM memories WHERE idempotency_key = ? AND id <> ?` in the same transaction, or switch to `INSERT … ON CONFLICT(id) DO UPDATE SET …` which cannot delete a foreign row. Treat a tombstoned key-holder as `IdempotencyConflictError`.

---

### 2. `as_of` disables every lifecycle gate — conflicted and expired memories enter prompts [REJECT]

`src/retrieval.ts:1714` (all gates nested inside `if (options.as_of === undefined)`), `src/retrieval.ts:1612` (`evaluateAsOf` checks only `valid_from`/`valid_to`/`asserted_at`)

`flagConflict` sets `status="conflicted"` without stamping `valid_to`; TTL expiry sets `expires_at` without `valid_to`. Neither is visible to `evaluateAsOf`, and both gates are skipped when `as_of` is present.

**Reproduced:**
```
without as_of: [ "m_ok" ]  hidden: 2
WITH as_of   : [ "m_conf2", "m_conf", "m_ok" ]  conflicted leaked: true
```

`get_context` forwards `as_of` on both branches (`src/mcp.ts:2063`, `:2075`), so this is a live prompt-serving path. It violates the stated T-405 invariant that conflicted memories are withheld from every prompt-serving read path, and injects *known-contradictory pairs* as if both were true.

**Fix**: hoist the conflicted/expired/archived gates out of the `as_of === undefined` guard and evaluate them as additional predicates (a retracted belief is not valid at any timestamp). Then push `valid_from`/`valid_to`/`expires_at` into SQL and keep only the `undetermined` partition in memory.

---

## ⚠️ Required Changes (Request-Changes)

### 3. A stale YAML mirror silently reverts SQLite on read [RC]

`src/store.ts:606-623` (`readEntry`), contract at `src/store.ts:199-204`

`readEntry` builds `{ ...fromYaml, access_count, last_accessed_at }` — everything except two counters comes from YAML — then writes it back to SQLite. A mirror that is stale for any reason (failed rename, crash between commits, `yamlMirror:false` writes) overwrites newer authoritative data **on a read**.

**Reproduced:**
```
db before read: v2 AWS (correct)
get() returned: v1: fly.io
db after read : v1 fly (ROLLED BACK)
```

**Fix**: merge on `updated_at` — take the YAML copy only when its `updated_at` is newer; otherwise treat SQLite as authoritative and do not rewrite the row.

---

### 4. `list()` resurrects tombstones and duplicates entries [RC]

`src/store.ts:686-692` — reconciliation derives `diskId` from the filename via `f.slice(0, -5)`, but files are stored as `slugifyId(id) + ".yaml"` (`src/store.ts:502-510`). When the id is not slug-clean, `diskId ≠ id`, so the entry looks "new external", `get()` passes the tombstone gate (which queries by the wrong id), and `readEntry` writes the row back **without `deleted_at`**.

**Reproduced**: a tombstoned `m_ABC123_Imported` returns from `list()` with `deleted_at: null`; the same call returns the entry twice (`length 2`, distinct ids 1) while `countMemories()` reports 1.

**Fix**: read the mirror and use `entry.id`, not the filename. De-duplicate by id before returning.

---

### 5. `list()` performs O(N) writes on a read-only call and corrupts `access_count` [RC]

`src/store.ts:689` → `get()` → `recordAccess()` (`src/store.ts:572`). `dbIds` is built from the **filtered** result, so every non-matching entry is treated as external and `get()`-ed — which increments `access_count`.

**Reproduced**: one filtered `list()` produced **118 SQLite writes**; 7 of 10 entries went from `access_count: null` to `1` having never been retrieved. `access_count` feeds `accessBonus` in ranking, so recall order is being steered by unrelated filtered listings.

**Fix**: build `dbIds` from an unfiltered `SELECT id FROM memories`; use a non-counting read for reconciliation.

---

### 6. Wikilink expansion bypasses the tombstone gate [RC]

`src/retrieval.ts:1468-1475` — the fallback queries `SELECT data FROM memories WHERE id = ? OR title = ?` with no `deleted_at` predicate and bypasses `rowToMemoryEntry`. Erased content is emitted into formatted prompt context when `expand_wikilinks` is set.

**Fix**: route through `getMemoryById` and add `AND deleted_at IS NULL`.

---

### 7. The query cache hands every caller the same mutable array [RC]

`src/cache.ts:168` returns `item.value` by reference (unlike `getEntry` at `:105`, which clones). Callers mutate entries in place (`src/retrieval.ts:1917`), so a mutation that was never saved is served to later reads.

**Reproduced**: `list()` returned `status: archived` for a memory the database still holds as `confirmed`.

**Fix**: clone on set or return a shallow copy on get, matching `getEntry`.

---

### 8. Secret scanner misses common password shapes [RC — security]

`src/secrets.ts:41` — the generic rule's value class is `[a-zA-Z0-9_\-\.]{8,}`, which excludes `!`, `$`, `+`, `/`, `@`.

**Reproduced:**
```
MISSED  password: "hunter2!extra"
MISSED  password=hunter2!
MISSED  secret_key: abc123$def
MISSED  auth_token: tok+en/with=special
CAUGHT  password: Tr0ub4dor&3   (only because '&' terminates the match early)
```

The write gate (`save`, `recordObservation`, `propose`) relies on this scanner. A password containing `!` is persisted in plaintext.

**Fix**: widen the value class to exclude only whitespace and quotes (`[^\s'"]{8,}`) and require the assignment form, or add a second rule keyed on the credential word with a permissive value.

---

## 🔍 Nitpicks

- `src/store.ts:2150-2155`: `searchMemories()` drops `hidden_count` while copying `degraded`/`error`; the field is documented on `FtsSearchHits`.
- `src/sqlite.ts:433-466`: the legacy-column fallback still lists `mem_path`/`last_accessed_at`/`access_count`, the exact columns missing on the databases the fallback exists for — it can never succeed.

---

## ✅ What's Good

- **Schema round-trip is lossless.** A 49-field `MemoryEntry` through `insertOrReplaceMemory` → `getMemoryById` showed zero drift; the `data` blob plus shadow columns are correct.
- **The `withStoreLock` discipline is sound** where applied — the playbook and observation write paths correctly serialize read-modify-write.
- **`evaluateAsOf` itself is correct** for what it claims (validity window + belief time); the defect is which gates call it.
- **Test coverage is real**: 1612 tests, and the recently added concurrency guards were verified to fail against their pre-fix code.

---

## ❓ D2 — answer to the recorded debt question

**D2 asked whether an `asserted_at` SQL column/index is needed ("if SQL filtering is needed").**

Evidence: `as_of` filtering is **entirely in memory**. `queryContext` calls `list(store)` (`src/retrieval.ts:1665`) and partitions with a JS loop (`:1764`). Cold-query cost measured:

| Store size | Cold `as_of` query |
|---|---|
| 1,000 | 20.7 ms |
| 5,000 | 56.7 ms |
| 10,000 | 94.6 ms |

Linear in N, ~95 ms at 10k. **D2 should be closed as a premature optimisation** — the missing column is not the problem. The real cost is `list()` itself (findings 4–5: readdirSync, reconciliation writes, cache mutation), and fixing those removes the need for a SQL pushdown. Adding a column would be treating a symptom.

---

## 🔁 Next Mode

`/code-review-fix` — findings 1, 2, 3 and 8 are data-integrity/security defects with reproductions and concrete fixes; they should be fixed test-first before the gauntlet runs.
