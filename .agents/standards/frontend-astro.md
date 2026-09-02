# 🚀 Astro Frontend Engineering Standards

> **Runtime Target**: Astro v7.2.x · Bun / Node pinned runtime · TypeScript Strict · `@astrojs/cloudflare`

---

## 1. Architectural Conventions

### Static-First & Island Hydration
- **Static by Default**: All `.astro` components render to static HTML at build time or server edge.
- **Selective Hydration**: Hydrate client islands with `client:*` directives ONLY when user interaction requires it:
  - `client:load` — Critical above-the-fold interactive components (e.g., global navigation toggle, hero configurator).
  - `client:idle` — Lower-priority interactive widgets (e.g., search modal, newsletter popup).
  - `client:visible` — Below-the-fold components (e.g., heavy testimonials carousel, interactive calculator).
  - `client:media` — Components conditional on media queries.

### Content Collections & Validation
- Content collections live strictly in `src/content/`.
- Every collection must define a strict **Zod schema** in `src/content/config.ts`.
- Validate all incoming parameters, frontmatter, and external data at the collection boundary.

---

## 2. Styling & Motion Standards

- **Styling**: UnoCSS v66.x or Tailwind CSS v4 utility classes inline. Extract to a dedicated component or BEM class when a utility pattern is repeated 3+ times.
- **Design Tokens**: Consume design tokens from `./.agents/brand/tokens/` or CSS variables. Never introduce arbitrary raw hex codes or ad-hoc pixel values.
- **Animations**: Use **Motion.dev** (Framer Motion v12+). All animations must respect `@media (prefers-reduced-motion: reduce)`.

---

## 3. Testing & Code Quality

- **Testing**: Vitest for unit and component tests; Playwright for end-to-end user journeys. Tests live adjacent to source files (`*.test.ts`).
- **No Network in Tests**: Never run unit tests that make real outbound network requests. Mock at the `fetch` boundary.
- **Type Strictness**: No `any` or forced casts (`as unknown as Type`). Fix the root interface.
- **Clean Logging**: Never commit `console.log`. Use structured logging or logger utilities.

---

## 4. Standard Commands

```bash
bun install      # Install dependencies
bun dev          # Local dev server
bun build        # Production build (@astrojs/cloudflare)
bun test         # Run Vitest suite
bun lint --fix   # Run linter with autofix
bun typecheck    # Run tsc --noEmit
```
