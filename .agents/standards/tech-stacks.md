# 🚀 Agency Tech Stack Directions & Architectural Standards

All digital products and client builds follow one of three designated architectural directions. All tooling is kept at the latest stable version.

---

## 🧭 Direction 1: Modern Web & High-Performance Astro

> **Best For**: High-speed marketing platforms, content ecosystems, portals, and interactive agency web applications.

### Core Toolchain & Stack
- **Framework**: **Astro v7.2.x** (Server-first, content collections, hybrid rendering)
- **Styling**: **UnoCSS v66.x** + Custom Semantic BEM CSS tokens
- **Animations**: **Motion.dev** (Framer Motion engine for high-end web interactions)
- **UI & Accessibility**: **Aria Builder `@latest`** (WCAG 2.2 AA compliant accessible components)
- **Testing**: **Vitest** (Unit, component, and utility tests)
- **Runtime & Deployment**: **`@astrojs/cloudflare`** on **Cloudflare Free Tier** or **GitHub Pages**
- **Persistence & Analytics**: SQLite DB (when local storage/edge persistence is needed) + Cloudflare Web Analytics

---

## ⚡ Direction 2: Instatic (Pure HTML / Brochure & Static Sites)

> **Best For**: Pure HTML brochure sites, lightweight marketing landing pages, and zero-JS static client deliverables.

### Core Toolchain & Stack
- **Engine**: **[Instatic](https://github.com/corebunch/instatic)** — Pure HTML-based static site generator
- **Delivery**: Semantic HTML5, CSS3, minimal vanilla JS
- **Hosting**: Cloudflare Pages / GitHub Pages (Zero compute overhead, sub-millisecond TTFB)
- **Principle**: Zero runtime dependencies, 100/100 Lighthouse performance score by default.

---

## 🛍️ Direction 3: Headless E-Commerce & Dynamic CMS

> **Best For**: Direct-to-Consumer (D2C) e-commerce brands, high-scale digital stores, and content-managed portals.

### Core Toolchain & Stack
- **CMS & Backend**: **Payload CMS** with official E-Commerce Module
- **Frontend Framework**: **Next.js** (App Router, Server Components by default)
- **Styling & Motion**: **UnoCSS** + **Motion.dev**
- **Type Safety & Validation**: **Zod** (strict schema validation at all API boundaries)
- **Testing**: **Vitest** (Unit, integration, and API tests)
- **Database**: **Neon** (Serverless PostgreSQL) or **Supabase**
- **Hosting & Infrastructure**: **Cloudflare Free / Low-Cost Tier** + edge caching for zero-to-low operational cost

---

## 🔒 Tech Stack Invariants
1. **No Speculative Dependencies**: Do not introduce unlisted frameworks or heavy third-party runtime libraries without explicit human authorization.
2. **Edge-First Hosting**: Default to Cloudflare edge deployment across all three directions to maintain zero-to-low infrastructure costs.
3. **Accessibility Baseline**: WCAG 2.2 AA compliance is mandatory across all user-facing components.
