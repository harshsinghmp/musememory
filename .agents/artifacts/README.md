# 🗄️ Working Artifacts Container

Scratch and evidence produced while working live here — never in the repository root.

## What belongs here

- Session research, gauntlets, audit packets, benchmark baselines, handoffs.
- Evidence attached to a claim in `.agents/context/current.md` (link the file, don't paste it).
- One directory per artifact when it has multiple files: `.agents/artifacts/<slug>/`.

## Rules

- **Not a secrets store.** Credentials, tokens and `.env` values never enter this tree.
- **Not a dump.** Delete superseded artifacts; this is working material, not an archive.
- **Retire, don't delete history.** Plans that are done move to
  `.agents/archive/[title]-[timestamp].md`.
- **Never write to `./.memory/**`** — that directory is owned by the MuseMemory engine.

## Naming

`YYYY-MM-DD-<slug>.md` for single files; `YYYY-MM-DD-<slug>/` for multi-file artifacts.
