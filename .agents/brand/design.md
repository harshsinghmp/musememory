# 🎨 Brand Identity, Design Tokens & UI Architecture

> **Purpose**: Single source of truth for visual identity, design tokens, component states, and responsive styling.

---

## 1. Token Architecture

All design tokens are defined in `./.agents/brand/tokens/` in W3C DTCG format and mapped to CSS custom properties.

```
.agents/brand/tokens/
├── colors.json          # OKLCH color palettes (Light & Dark modes)
├── typography.json      # Fluid typography scales via clamp()
├── spacing.json         # 4px/8px baseline grid
├── radii.json           # Border radii tokens
├── shadows.json         # Elevation & depth layers
├── motion.json          # Durations, easings, spring configs
└── base.css             # Compiled CSS Custom Properties
```

---

## 2. The 7 Non-Negotiable UI Component States

Every interactive component and page must explicitly handle and render all 7 states:

| State | Design & Engineering Requirement |
| :--- | :--- |
| **1. Default** | Clean resting state with tokenized colors, padding, and typography. |
| **2. Loading** | **Full Skeleton UI** mirroring actual content layout. Never render a raw isolated spinner. |
| **3. Empty** | Friendly, helpful empty-state copy with an immediate primary CTA (e.g., *"Create your first order"*). |
| **4. Error** | **Inline error message with a retry button**. Do not rely on evanescent toasts alone; never swallow errors. |
| **5. Focus** | **2px high-contrast visible focus ring** (`outline: 2px solid var(--color-primary); outline-offset: 2px;`). Never `outline: none`. |
| **6. Disabled** | `opacity: 0.6`, `cursor: not-allowed`, pointer events suppressed, zero hover animations. |
| **7. Mobile (<640px)** | Stacks vertically, full-width touch-friendly CTAs (minimum 44×44px hit area). |

---

## 3. Visual Density & Styling Rules

- **Tokens Only**: Never introduce arbitrary hex codes (`#1a2b3c`) or ad-hoc pixel values (`margin: 13px`). Use CSS variables (`var(--color-primary)`) or UnoCSS/Tailwind theme tokens.
- **Fluid Typography**: Use `clamp()` for responsive font sizes (14px–16px body, 24px–32px headings).
- **Surface Elevation**: Layer cards and elevated modals using `--color-surface-elevated` and `--shadow-md`.
- **Reference Screenshots**: Reference UI mocks, wireframes, and design snapshots are stored in `./.agents/brand/screenshots/`. Agents inspect these images before constructing or styling matching views.
