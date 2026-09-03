---
name: muse-health
description: Unified 5-pillar project health gate governor. Audits store integrity, code anchors, doc/code alignment, negative sentry, and technical debt to enforce production hardening gates.
---

# 🏥 Muse Health (`muse-health`)

> **When to use**: Execute before completing features, opening pull requests, or cutting releases to verify repository hardening and architectural health.

---

## 🚀 Execution Workflow

### Step 1: Run 5-Pillar Health Gate
Call the `muse_health` MCP tool (or execute `memory health`):

```json
{
  "dir": "."
}
```

### Step 2: Evaluate 5-Pillar Scorecard
The engine evaluates 5 distinct hardening dimensions, outputting an overall letter grade (**A–F**) and a gate status (**PASS**, **WARN**, or **FAIL**):

1. **Pillar 1: Store Integrity**:
   - Validates referential integrity, YAML schema conformances, bidirectional links, and missing target memory IDs.
2. **Pillar 2: Native Code Anchors**:
   - Verifies whether files, functions, and symbols referenced by code anchors exist on disk, flagging drifted structural hashes or orphaned anchors.
3. **Pillar 3: Doc $\longleftrightarrow$ Code Alignment**:
   - Audits living ADRs and documented invariants against actual code implementations, identifying conflicting, stale, or missing code.
4. **Pillar 4: Negative Anti-Pattern Sentry**:
   - Checks if any known `DO_NOT_USE` patterns, regression bug fixes, or failed approaches have resurfaced in the active working tree.
5. **Pillar 5: Technical Debt & Workaround Sentry**:
   - Detects unresolved `TODO`/`FIXME`/`HACK` comments, dangerous type casts (`as any`), and drifted architectural commitments.

### Step 3: Execute Actionable Remediation Checklist
If the gate status is **WARN** or **FAIL**, the engine outputs an ordered remediation checklist. Execute the prioritized items:
- Prune or re-link orphaned code anchors via `memory reconcile --prune`.
- Adhere to active ADR decisions.
- Resolve flagged type assertions or negative pattern recurrences.

---

## 💻 CLI Equivalents (Zero-MCP Fallback)

```bash
# Full terminal health dashboard
memory health

# Output raw JSON for CI/CD gating (exits 1 on FAIL)
memory health --json

# Interactively audit and prune orphaned code anchors
memory reconcile --prune
```
