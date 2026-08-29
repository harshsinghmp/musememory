# Design System: Muse Memory

## 1. Visual Theme & Atmosphere
A restrained, cockpit-dense interface engineered for cognitive memory inspection, real-time agent handoffs, and knowledge compounding. The atmosphere is clinical, tactile, and high-agency — reminiscent of a modern developer observatory or mission-control dashboard. Layouts favor dense spatial structure, monospaced metadata hierarchy, and fluid spring-physics micro-interactions over decorative fluff.

- **Density:** 8/10 (Cockpit Dense — high information density, compact metadata, monospace numeric alignment)
- **Variance:** 7/10 (Asymmetric splits for inspectors, bento grids for architectural capabilities)
- **Motion:** 6/10 (Spring-weighted tactile feedback, perpetual subtle live badge pulse, canvas particle orbits)

---

## 2. Color Palette & Roles

| Token | Name | Hex Code | Functional Role |
| :--- | :--- | :--- | :--- |
| `surface-canvas` | Deep Obsidian | `#07090e` | Primary application canvas and background viewport |
| `surface-panel` | Midnight Slate | `#0e131d` | Card containers, sidebar background, inspector panels |
| `surface-elevated` | Dark Carbon | `#141b27` | Elevated dialogs, table headers, dropdown popovers |
| `border-whisper` | Whisper Line | `rgba(255, 255, 255, 0.08)` | 1px structural borders and card dividers |
| `border-active` | Focus Slate | `rgba(99, 102, 241, 0.40)` | Active focus rings, selected card outlines |
| `text-primary` | Crisp Zinc | `#f1f5f9` | Primary headlines, titles, active labels |
| `text-secondary` | Muted Steel | `#94a3b8` | Descriptions, body copy, inactive tab labels |
| `text-dim` | Slate Shadow | `#64748b` | Field labels, timestamp prefixes, table headers |
| `accent-primary` | Cobalt Indigo | `#6366f1` | Primary CTA, active navigation indicator, link highlights (Saturation < 80%) |
| `status-confirmed` | Forest Emerald | `#10b981` | Confirmed memories, passing tests, active status |
| `status-stale` | Amber Glow | `#d97706` | Stale memories, warnings, review flags |
| `status-rejected` | Rose Crimson | `#ef4444` | Rejected entries, deletions, secret leak alerts |
| `status-arch` | Royal Violet | `#8b5cf6` | Architecture decisions, system schema nodes |
| `status-op` | Cyan Horizon | `#06b6d4` | Build operations, CLI commands, scripts |

> **Mandatory Color Constraints**:
> - Never use pure black (`#000000`).
> - No oversaturated neon glows or multi-color rainbow gradients on headings.
> - Maximum 1 primary accent (`#6366f1`). Semantic statuses use calibrated, subdued hues.

---

## 3. Typography Rules

- **Display / Headlines:** `Plus Jakarta Sans`, font-weight 700/800, track-tight (`letter-spacing: -0.02em`). Scale is controlled and weight-driven without screaming text sizes.
- **Body & Content:** `Plus Jakarta Sans`, font-weight 400/500, relaxed leading (`line-height: 1.55`), maximum 65 characters per line for reading comfort.
- **Monospace & Metadata:** `JetBrains Mono` / `ui-monospace`, font-weight 500/600. All memory IDs (`m_1700000...`), timestamps, numerical metrics, CLI flags, and constraints are strictly monospaced.
- **Banned Typography:** Generic `Inter` and generic serif fonts (`Times New Roman`, `Georgia`, `Garamond`) are forbidden.

---

## 4. Component Stylings

### Buttons & Controls
- **Primary Button:** Solid Cobalt Indigo (`#6366f1`), 1px border `rgba(255,255,255,0.12)`, tactile 1px depression on active state (`transform: translateY(1px)`).
- **Secondary / Ghost Button:** Transparent background, `surface-panel` hover, 1px border `border-whisper`, crisp zinc text.
- **Icon / Action Badges:** Compact 24px–32px touch targets with rounded 6px corners and subtle hover luminance.

### Cards & Drawers
- **Memory Card:** `Midnight Slate` fill, 1px `border-whisper`, 8px padding, 10px rounded corners. Elevation is communicated through subtle border luminescence rather than heavy drop shadows.
- **Inspector Drawer:** 420px fixed lateral panel, full-height backdrop blur (`backdrop-filter: blur(16px)`), sticky header with close trigger and quick action toolbar.

### Form Inputs & Filters
- **Search Bar:** Dark Carbon fill (`#090d14`), inset border `border-whisper`, left-aligned search icon, focus ring `border-active`.
- **Filter Chips:** 24px height, uppercase 10px font weight 700, pill radius (9999px), active state filled with `accent-primary`.

### Visual Status Indicators
- **Live Pulse Dot:** 6px circular indicator with perpetual 2s opacity pulse (`opacity: 0.4 -> 1.0 -> 0.4`), zero neon blur spill.

---

## 5. Layout Principles

- **Grid Architecture:** High-density CSS Grid for dashboards, provider comparisons, and archetype pickers. No fragile `calc()` percentage math.
- **Asymmetric Split:** 360px collapsible lateral list + fluid central canvas/inspector panel + 420px lateral detail drawer.
- **Containment:** Max width container (1600px) centered with fluid gutter padding (`clamp(16px, 3vw, 32px)`).
- **Mobile-First Collapse:** Below 768px, multi-column drawers collapse to stacked drawer views with zero horizontal overflow.
- **Viewport Height:** Full-height interfaces use `min-height: 100dvh` (preventing iOS Safari viewport jumps).

---

## 6. Motion & Interaction

- **Spring Physics:** Smooth transitions (`cubic-bezier(0.16, 1, 0.3, 1)` with 200ms duration) for cards, tabs, and modals.
- **Perpetual Micro-Loops:** Live status dot gently pulses; 3D canvas graph features smooth velocity damping and rotation decay.
- **Hardware Acceleration:** All canvas animations and drawer transitions operate strictly on `transform` and `opacity`.

---

## 7. Anti-Patterns (Explicitly Banned)

1. ❌ **No Emojis in Brand Headings:** Use clean typography, crisp iconography, or subtle SVG glyphs.
2. ❌ **No Neon Glows or Blurred Blobs:** Keep shadow spreads under 16px and low opacity.
3. ❌ **No Pure Black (`#000000`):** Always use calibrated off-black (`#07090e` / `#0e131d`).
4. ❌ **No Generic 3-Column Feature Rows:** Use asymmetric bento grids or interactive tables.
5. ❌ **No Generic `Inter` Font:** Use `Plus Jakarta Sans` for UI and `JetBrains Mono` for code/data.
6. ❌ **No AI Copywriting Clichés:** Avoid words like *"Elevate"*, *"Seamless"*, *"Unleash"*, *"Next-Gen"*. Use precise engineering terms (*"Deterministic Lifecycle State Machine"*, *"Knapsack Token Retrieval"*, *"Dual-Persisted SQLite Store"*).
