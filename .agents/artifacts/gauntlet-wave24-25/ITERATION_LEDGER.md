# ITERATION LEDGER — Waves 24–25 (2026-11-08)

## Automated gate

- `bun test`: 1488 pass / 0 fail (226 files)
- `tsc --noEmit`: clean
- `bun run build`: 434 modules
- `scan-secrets src`: clean
- Website visual gate: **N/A** — `astro build` fails in Astro's own prerender import (`cookie` CommonJS named export `parseCookie`) before page generation; Vite entrypoints compile. Not caused by this diff; blocks rendering `agents.astro` and `playground.astro`.

## Diff review (Linus style) — REJECT, then fixed

Findings and resolution:
- **B1** MCP updates synthesized `[]` for absent arrays, erasing playbook safety rails. Fixed: arrays are spread only when present; MCP resolves title→id before updates; test asserts rails survive a step-only update.
- **B2** corrupt `playbooks.json` read as empty and was overwritten. Fixed: `PlaybookStoreError` on invalid/non-array JSON; CLI returns 1; MCP returns a tool error; test asserts the file is left byte-identical.
- **RC1** CLI printed the pre-outcome snapshot. Fixed: print the updated record.
- **RC2** title was the write identity. Fixed: updates key on `id` (with title→id resolution at the MCP boundary); same-titled playbooks coexist.
- **RC3** CLI ignored `--dir`/`--global` and treated `--run` as list. Fixed: dir/global resolution, `--run`/`--show` aliases.
- **RC4/RC5** episode ids collided within a second; `test` preempted goal. Fixed: per-session sequence ids; kind-first and anchored phase patterns.
- **RC8** timestamps compared as strings. Fixed: epoch parsing, invalid timestamps throw, `ended_at` fallback removed.
- **RC9** step shape/goal unvalidated. Fixed: non-empty goal and per-step action validation.
- **RC10** benchmark page commands/wording were wrong. Fixed: `claims:check`, real CLI benchmark command, single-value claims semantics, descope note.
- **RC11** playground claimed schema parity. Fixed: copy says four-column subset.
- **RC6/RC7** `episodes`, `temporal`, `decay` have no production callers. Documented as scaffolding in `TECHNICAL_DEBT-wave24-25.md` and ticket-plan notes.

## Status

**CAPPED** — fixed after the single review round; no second reviewer. Visual/a11y gate remains blocked by the Astro prerender issue.
