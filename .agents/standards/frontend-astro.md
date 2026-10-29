# 🚀 Astro Frontend Engineering Standards

> **Runtime Target**: Astro v7.3.x · Bun / Node runtime · TypeScript Strict
> **Applies to**: `apps/website/` — the Muse Memory marketing and documentation site.

---

## 1. Project Shape (verified against this repo)

| Fact | Value | Source of truth |
| :--- | :--- | :--- |
| Framework | Astro `^7.3.5` | `apps/website/package.json` |
| Output | `static` (no SSR adapter) | `apps/website/astro.config.mjs` |
| Base path | `/musememory` (GitHub Pages) | `apps/website/astro.config.mjs` |
| Site origin | `https://harshsinghmp.github.io` | `apps/website/astro.config.mjs` |
| Styling | Plain CSS with design tokens (no Tailwind, no UnoCSS) | `apps/website/src/styles/global.css` |
| Motion | CSS keyframes + one inlined `IntersectionObserver` script | `apps/website/src/scripts/motion.ts` |
| Tests | `bun test` (axe-core + Playwright audits) | `apps/website/scripts/audit-*.ts` |

> The generic Astro standard assumes `@astrojs/cloudflare`, Tailwind v4 and
> Motion.dev. **This project does not use them.** Do not introduce an SSR
> adapter, a utility CSS framework, or a JS animation runtime to solve a
> problem the current stack already solves.

---

## 2. Architectural Conventions

### Static by default
Every page renders to static HTML at build time. There is no client framework
and no hydration directive (`client:load` and friends are not used — the site
ships zero framework JS). Interactive behaviour is progressive enhancement:
the navigation menu is a `<details>` element, the FAQ is `<details>`, the
reveal animation is CSS plus one observer.

### The base path is not optional
The site is served from `/musememory/`. **Every** internal URL must be built
from `import.meta.env.BASE_URL` or it will resolve on the domain root and
404. A root-absolute `/favicon.svg` is a bug, not a style choice.

```astro
<a href={`${import.meta.env.BASE_URL}/docs`}>Docs</a>
```

### Shared components, not copied markup
Navigation, footer and the logo live in `src/components/`. They were
copy-pasted per page and had already drifted (the 404 page had no nav at
all). If a page needs a nav variant, add a prop — do not fork the component.

### The published numbers are generated
`claims.json` (repository root) holds every countable claim, generated from
`src/` by `scripts/generate-claims.ts`. The site imports it:

```astro
import claims from "../../../../claims.json";
```

Never hand-type a count, a tool total or a test count into a page. A test
(`test/marketing_claims.test.ts`) fails the build if the prose and the code
disagree.

### Content collections
`src/content/` does not exist in this project. If it is ever introduced, every
collection must define a strict schema and validate at the collection
boundary.

---

## 3. Styling & Motion Standards

- **Tokens only**: consume the CSS custom properties in `global.css` or the
  JSON in `./.agents/brand/tokens/`. Never introduce an arbitrary hex code.
- **Text colour is restricted**: only `--text`, `--text-dim` and `--text-faint`
  may carry text. The depth palette (`--plasma`, `--indigo`, `--edge-*`) is
  decorative and has no contrast obligation. Every text token is audited
  against WCAG 2.2 AA by `scripts/audit-a11y.ts`.
- **Class naming**: BEM per `./.agents/brand/bem-conventions.md`.
- **Animations** must respect `@media (prefers-reduced-motion: reduce)`.
- **The reveal contract**: an element that is on screen must be visible. The
  `IntersectionObserver` uses `threshold: 0` and `rootMargin: "0px"` so the
  trigger boundary is exactly the viewport. A ratio threshold silently
  strands any `.reveal` taller than the viewport.
- **`transform` is owned by one rule**: `.reveal` and `.tilt` both write
  `transform`, so they must be composed in a single declaration. Never split
  them across two selectors.

---

## 4. Testing & Code Quality

- **Accessibility gate**: `bun run --cwd apps/website scripts/audit-a11y.ts`
  — axe-core on every page (zero critical/serious) plus a computed-contrast
  check of every token pair.
- **Visual gate**: `bun run --cwd apps/website scripts/audit-visual.ts` —
  375 / 768 / 1280 viewports on every page: horizontal overflow, console
  errors, the reveal runtime, and the nav CTA.
- **No network in tests**: mock at the `fetch` boundary.
- **Type strictness**: no `any` and no `as unknown as T`. Fix the interface.
- **No `console.log`** in committed code.

### Assets are generated, never hand-edited
```bash
bun run --cwd apps/website brand   # favicon, OG card, twitter card, banner
bun run --cwd apps/website build   # astro build + llms.txt / llms-full.txt
```
Brand PNGs are rasterised from SVG with resvg using the fonts already vendored
in `showreel-hf/assets/fonts`, so the output is deterministic and needs no
browser download. `llms.txt` and `llms-full.txt` are generated from the built
HTML, so the agent-readable layer cannot drift from the site.

---

## 5. Standard Commands

```bash
# From the repository root
bun run site:dev            # astro dev
bun run site:build          # astro build + llms.txt / llms-full.txt
bun run site:preview        # preview the built site

# From apps/website
bun run dev                 # astro dev
bun run build               # astro build && build-llms-txt.ts
bun run brand               # regenerate brand assets
bun run llms                # regenerate the agent-readable text layer

# Quality gates
bun run --cwd apps/website scripts/audit-a11y.ts
bun run --cwd apps/website scripts/audit-visual.ts
bun test                    # the whole repository suite
bunx tsc --noEmit           # type check
```
