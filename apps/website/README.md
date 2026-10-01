# @musememory/website

Marketing site for Muse Memory, built with Astro 7 (static output).

```bash
bun install            # from repo root (workspaces)
bun run site:dev       # dev server
bun run site:build     # static build → apps/website/dist
bun run site:preview   # preview the production build
bun run site:showreel  # re-render the showreel from the HyperFrames composition
```

## Showreel

`public/showreel.mp4` is a motion-designed composition, not a screen
recording. Source lives in `showreel-hf/index.html` (HyperFrames format:
HTML + CSS + one GSAP timeline registered on `window.__timelines`), rendered
to a 1920×1080 master, then encoded to 1280×720 H.264 by
`scripts/build-showreel.ts`.

Every on-screen number is a verifiable engine benchmark (sub-2ms recall,
<50µs L0 cache, 0 daemons, 80+ platforms, 527 tests). After editing the
composition, run `bun run site:showreel` and commit the regenerated video,
poster, and the refreshed `public/brand/.showreel-hash` — CI fails the
deploy when the hash drifts.

Quality gates: `bun scripts/audit-a11y.ts` (WCAG 2.2 AA) and
`bun scripts/audit-visual.ts` (responsive layout review, 375/768/1280).

Deployed to GitHub Pages via `.github/workflows/pages.yml` under the
`/musememory` base path.
