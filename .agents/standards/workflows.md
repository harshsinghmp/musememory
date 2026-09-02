# 🔄 Agent Development Workflows & Phase Gates

> **Lifecycle Doctrine**: Every engineering task moves through deterministic phases scaled to its classification tier. Bypassing quality gates is strictly prohibited.

---

## 1. Scaled Task Classification Tiers

To balance velocity with rigor, overhead is strictly proportional to task risk:

| Classification | Scope & Criteria | Required Phases & Gates |
| :--- | :--- | :--- |
| **`tiny-fix`** | < 3 files, typo, CSS token tweak, no semantic/logic change | Direct edit + 1-line verification check. Skips heavy planning. |
| **`quick-win`** | < 1 module, localized bug fix, small feature enhancement | Scoping → Implement → Targeted Test & Review. |
| **`feature`** | Multi-file additions, new endpoints, stateful UI flows | Full 5-Phase Pipeline (Scoping → Plan → Implement → Review → Ship). |
| **`architecture-change`** | Core schemas, database migrations, auth, global router/build refactors | Full 5-Phase Pipeline + Architecture Decision Record (ADR) + Nexus Gate. |

---

## 2. The 5-Phase Execution Pipeline

```
[ 📋 1. Scoping & Intake ] ──► [ 📐 2. Plan ] ──► [ ⚡ 3. Implement ] ──► [ 🛡️ 4. Review & Hardening ] ──► [ 🚢 5. Ship & Archive ]
```

### Phase 1: 📋 Scoping & Intake (Muse)
- **Decomposition Gate**: For multi-feature requests, decompose the input into a structured Feature Inventory before writing individual specifications.
- **Classification Freeze**: Lock task classification (`tiny-fix`, `quick-win`, `feature`, `architecture-change`). Silent scope expansion mid-implementation is prohibited. If scope grows, pause and notify the user.
- Identify the target tech direction (Astro / Instatic / Payload + Next.js).
- Load active constraints from `./.agents/context/` and `./.memory`.

### Phase 2: 📐 Plan & Design
- For `feature` and `architecture-change` tasks, generate an implementation plan inside `.agents/artifacts/`.
- Satisfy the **Task Start Gate**:
  1. **Goal**: What exact outcome is required?
  2. **Mechanism**: What is the root cause / structural design?
  3. **Proof**: What exact automated or visual observation proves success?

### Phase 3: ⚡ Implement (Sol / Jasper)
- Apply **The Confidence Gate** (<80% Stop, 80-90% State Assumption, >90% Proceed).
- Apply **Read-Before-Write**: Inspect target files, imported types, and callers before modifying code.
- Apply **Preparatory Refactoring**: Restructure cleanly before introducing functional changes.
- Respect code limits (pure UI components < 200 lines, custom hooks `use<Feature><Action>`).

### Phase 4: 🛡️ Review & Hardening (Nexus Quality Gate)
- Run targeted automated tests (`bun test` / `vitest`).
- Run the Vibeguard SecretScan (`bun ~/.config/LIFEOS/runtime/TOOLS/SecretScan.ts .`).
- Verify WCAG 2.2 AA accessibility and responsive mobile breakpoints.

### Phase 5: 🚢 Ship & Archive (Crew)
- Create structured Conventional Commits following the Git standard.
- **Archive Work Artifacts**: Move completed plans or temporary scratchpads into `.agents/archive/` using the timestamped format `[title]-[YYYYMMDD-HHMMSS].md`.
- **DOX Pass**: Update `./.agents/context/current.md` and the nearest owning `AGENTS.md`.
- **Memory Update**: Persist newly confirmed invariants or architectural decisions into `./.memory`.
