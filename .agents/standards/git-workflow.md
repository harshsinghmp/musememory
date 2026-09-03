# 📜 Git Workflow, Commits & Release Standards

## 1. Branch Architecture & Rules

### Branch Hierarchy
- `master`: Production branch. **Never commit directly to master.**
- `dev`: Staging/integration branch.
- `feature/*`: Created from `dev` for individual features or tasks.
- `release/*`: Created from `dev` when changes are ready for production; merged into `master`, then back into `dev`.
- `hotfix/*`: Created from `master` for urgent production fixes; merged into both `master` and `dev`.

### Branching Rules
1. Feature branches must always be created from `dev`.
2. Use descriptive branch names (`feat/auth-session`, `fix/db-pool-leak`).
3. Every merge into `dev` or `master` requires a Pull Request and code review.
4. Do not rewrite or force-push `master` or `dev` history.
5. Prefer `git rebase` within feature branches to keep history clean and linear.
6. For production bugs, use `hotfix/*` rather than merging unfinished work from `dev`.
7. Prefer a new revert commit over rewriting shared history.

---

## 2. Meaningful Git Commit Standard

Every commit in this repository must follow this structured format:

```
<type>(<scope>): <imperative summary>

- Why: [Brief explanation of the motivation/problem solved]
- What: [Bullet list of specific files, components, or mechanisms changed]
- Verification: [Evidence that tests, builds, and Nexus probes passed]
```

### Commit Formatting Rules
- **Subject (≤50 chars)**: Capitalized imperative Conventional Commit (e.g., `feat(drift): Add AST symbol drift scanner`).
- **Body (≤72 chars/line)**: Focus on why and non-obvious rationale instead of restating the diff; avoid pronouns (`I`, `we`) and meta-phrasing (`This commit...`).
- **Issue References**: Link issues at the bottom (e.g., `Closes #123`, `Resolves #456`).

### Allowed Commit Types
- `feat`: A new feature or capability.
- `fix`: A bug fix or defect resolution.
- `refactor`: Code change that neither fixes a bug nor adds a feature.
- `perf`: A code change that improves performance.
- `docs`: Documentation-only changes.
- `style`: Changes that do not affect code logic (formatting, whitespace).
- `test`: Adding or refactoring tests and verification probes.
- `chore`: Maintenance tasks, dependency updates, build tooling.
- `ci`: CI/CD pipeline and automation configuration.

### Rejection Gate
Vague commit messages like `"update"`, `"fix"`, `"minor changes"`, or `"wip"` are strictly rejected by the **Nexus Quality Gate**.

---

## 3. Scope of Work & Sprint Lifecycle

All development moves across 4 deterministic lifecycle phases:

```
[ 📋 Requested ] ──► [ 📅 Planned ] ──► [ ⚡ In Progress ] ──► [ ✅ Done ]
 (Issues / PRs)     (Sprint Backlog)    (Active PR / Milestone)  (Shipped to Main)
```

1. **📋 Requested**: Community proposals, PR suggestions, and ecosystem requests pending sprint triage.
2. **📅 Planned**: Scoped SOW items selected for the upcoming sprint.
3. **⚡ In Progress**:
   - Feature branch created from `dev` (`feat/*`).
   - Dedicated GitHub milestone created and draft PR opened against `dev`.
   - Item moved to *In Progress* on the roadmap board.
4. **✅ Done**:
   - Tests and static typing pass cleanly (`bun test`, `tsc --noEmit`).
   - PR merged into `dev`, fast-forwarded to `master`, and milestone closed.
   - Item moved to *Done* on the roadmap board.

---

## 4. Releases & Semantic Versioning (vX.Y.Z)

All releases and git tags must follow strict `vX.Y.Z` semantic versioning:

- **X (Major)**: Breaking architectural changes, core schema shifts, or protocol overhauls (`vX.0.0`).
- **Y (Feature)**: Substantive new agent capabilities, MCP tools, or CLI subcommands (`vX.Y.0`).
- **Z (Minor / Hotfix)**: Bug fixes, security patches, performance, and urgent hotfixes (`vX.Y.Z`).

### Release Invariants
- Sync `package.json` `"version"` with the `vX.Y.Z` tag in the release commit.
- Stage on `release/vX.Y.Z` from `dev` → merge to `master` → back-merge to `dev`.
- CI publishes on `v*` tag push (`git tag -a vX.Y.Z -m "release: vX.Y.Z"`). Never publish manually.
- **README "What's New" Rule**:
  - Keep only the current release/feature highlights in `README.md` under `## 🚀 What's New`.
  - Do NOT accumulate historical version blocks (`### vX.Y.Z`).
  - Do NOT write version headers (`### vX.Y.Z`) inside `## 🚀 What's New`; format as a clean, plain-English bullet list understandable to non-technical users.
  - Detailed versioned change history lives strictly in `CHANGELOG.md`.

---

## 5. Skill Authoring & Ecosystem Invariants

- **Skills Are Products**: Read the exact `SKILL.md` before editing one.
- **Valid Frontmatter**: Keep YAML frontmatter valid (`name` + trigger-rich `description`) on every `SKILL.md`; it is the discovery surface for all runtimes.
- **Atomic Updates**: Adding/removing a skill requires updating in the same commit: README badges/tables, `skills.json`, and `llms.txt`.
- **Zero Secrets**: No secrets or personal environment values in any shipped file.
