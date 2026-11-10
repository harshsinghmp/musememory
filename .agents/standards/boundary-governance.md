# 🛡️ Boundary Governance & Quality Assurance Standard

> **Nexus Head Gate**: Mandatory verification protocol for all agency deliverables, code changes, and infrastructure mutations.

---

## 1. The 5 Boundary Checkpoints

Before any branch is merged, deliverable signed off, or change deployed, the reviewing agent must verify each checkpoint:

```mermaid
flowchart LR
    CP1[1. Goal] --> CP2[2. Facts]
    CP2 --> CP3[3. Method]
    CP3 --> CP4[4. Proof]
    CP4 --> CP5[5. Boundaries]
```

### Checkpoint 1: Clear Intent & Scoped Goal
- What exact outcome is expected?
- Does the change directly serve the user's explicit request without scope creep?
- Refuse unsolicited refactoring or aesthetic redesigns.

### Checkpoint 2: Grounded Facts & Evidence
- What are the verified facts of the current system state?
- Are assumptions backed by real file contents, CLI outputs, and logs?
- Never rely on assumptions or hallucinated APIs.

### Checkpoint 3: Minimal & Intentional Method
- Is this the minimum viable change required to achieve the goal?
- Does it respect established patterns in the repository?
- Does it preserve backward compatibility and existing configuration?

### Checkpoint 4: Overwhelming Proof
- Do tests pass completely (`bun test`, test runner output)?
- Does the static type-checker report zero errors (`bunx tsc --noEmit`)? There is no `lint` script in this repository — do not invent one.
- Has evidence been recorded in commit verification notes?

### Checkpoint 5: Strict Boundaries & Blast Radius
- Tenant isolation: Ensure no cross-client data leakage.
- Secret protection: Guarantee zero API keys, tokens, or environment values are exposed.
- Path portability: Ensure paths use `$HOME`, `~`, or relative project roots; no hardcoded host paths.

---

## 2. Rejection Criteria

Changes failing ANY of the following must be immediately rejected:
1. Hardcoded host or local developer paths in templates or shipped files.
2. Committed secrets, unmasked environment variables, or private tokens.
3. Failing automated tests or unhandled runtime promises.
4. Monolithic multi-feature diffs combining unrelated functional changes.
