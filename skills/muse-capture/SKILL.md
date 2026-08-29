---
name: muse-capture
description: Autonomous post-fix and architectural decision distillation. Captures atomic, verified knowledge units with inline Vibeguard secret defense and supersedes outdated patterns.
---

# 🧠 Muse Capture (`muse-capture`)

> **When to use**: Execute immediately after fixing a non-trivial bug, establishing an architectural pattern, learning an operational rule, or making a system decision.

---

## 🚀 Execution Workflow

### Step 1: Verify Evidence Before Capturing
Ensure the fix or decision has been verified with real build outputs, test runs, or command logs:
- **Evidence Directive**: Do not propose speculative or unverified fixes.
- **Verification Level**: Tag with `observed`, `reproducible`, `user-confirmed`, or `independently-verified`.

### Step 2: Propose Atomic Memory Unit
Call the `memory_capture` MCP tool:

```json
{
  "title": "Fix SQLite Connection Pool Exhaustion under Bun Microtasks",
  "content": "SQLite WAL mode with busy_timeout=5000ms prevents disk lock errors during concurrent microtask flushes. Use PRAGMA busy_timeout = 5000 in openDatabase.",
  "project": "my-project",
  "type": "fix",
  "tags": ["sqlite", "bun", "concurrency"],
  "salience": 0.9,
  "verification": {
    "level": "independently-verified",
    "test_command": "bun test test/sqlite_concurrency.test.ts"
  }
}
```

### Step 3: Handle Knowledge Supersession (When Deprecating Old Knowledge)
If the new fix or architecture replaces an outdated pattern:
1. Identify the existing memory ID (e.g. `m_1700000001000_old_pool`).
2. Call `memory_supersede` to atomically update bidirectional links:

```json
{
  "old_id": "m_1700000001000_old_pool",
  "new_id": "m_1700000002000_new_pool"
}
```

---

## 🛡️ Vibeguard Zero-Leakage Protocol

- **Automatic Interception**: `memory_capture` automatically scans all proposed fields (title, content, tags, verification commands).
- **Hard Rejection**: Any presence of AI API keys (`sk-*`), GitHub tokens (`ghp_*`), AWS keys (`AKIA*`), private keys, or passwords will immediately throw an error.
- **Sanitization Directive**: Always redact secrets to `[REDACTED_SECRET]` before proposing.

---

## 💻 CLI Equivalents (Zero-MCP Fallback)

```bash
# Propose a new candidate memory
memory capture "Fix details" --title "Title" --project my-project --type fix

# Confirm a candidate memory
memory confirm <id>

# Supersede an old memory with a confirmed replacement
memory supersede <old_id> --with <new_id>
```
