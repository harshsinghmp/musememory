---
name: muse-brief
description: Proactive daily briefing and knowledge hygiene governor. Scans decaying knowledge, audits policy staleness, tracks overdue due_at deadlines, and surfaces unresolved open loops with zero resident daemons.
---

# ⏰ Muse Brief (`muse-brief`)

> **When to use**: Execute at the start of a workday, during daily standup/planning, or when performing knowledge hygiene and backlog triage.

---

## 🚀 Execution Workflow

### Step 1: Generate Actionable Daily Briefing
Run `memory briefing` (or execute via `memory routine run daily-briefing`):

```bash
memory briefing --limit 10
```

The briefing renders a clean Markdown summary containing:
1. **Fresh Insights**: Recently confirmed architectural decisions and bug fixes.
2. **Upcoming & Overdue Items**: Entries with `due_at` timestamps requiring attention.
3. **Active Constraints**: Current rules in `.memory/CURRENT.md`.
4. **Open Loops**: Extracted tasks and unresolved commitments from recent agent sessions.

### Step 2: Run Staleness & Attention Audits
Run `memory nudge` to inspect decaying knowledge:
- **Policy Decay Check**: Flags fixes older than 90 days or operational rules older than 180 days.
- **Action**: Prompt the user or agent to re-verify, mark stale (`memory mark-stale <id>`), or supersede with updated patterns.

### Step 3: Run Routine Automation (Zero Daemon)
Declare routine workflows in `.memory/routines.yaml`:

```yaml
routines:
  - name: daily-hygiene
    schedule: "0 9 * * 1-5"
    commands:
      - "memory nudge"
      - "memory briefing"
      - "memory wiki compile"
```

Install the crontab line via `memory routine install daily-hygiene` to run via system cron without any persistent background Node daemon.

---

## 🛡️ Invariant Rules for Agents

- **Deterministic & Zero-Daemon**: Never launch a long-running background daemon process; execute on-demand or via cron.
- **Actionable Output**: Highlight only actionable staleness warnings and open loops rather than dumping entire databases.

---

## 💻 CLI Equivalents (Zero-MCP Fallback)

```bash
# Generate daily briefing
memory briefing

# Surface overdue items and decaying knowledge
memory nudge

# Execute declared routine
memory routine run daily-hygiene
```
