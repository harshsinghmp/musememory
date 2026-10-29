# ⚛️ Next.js SSR & Scalable Frontend Design Standards

> **Scope**: Mandatory architecture, rendering, data flow, and code organization for Next.js (App Router) and React systems.

---

## 1. Next.js App Router & SSR Rendering Rules

### Default to Server Components
- All components in the App Router are **React Server Components (RSC)** by default.
- Use client components (`"use client"`) **only** when interactivity, event listeners, React state, or browser APIs are required.
- Never fetch data inside client components when it can be fetched on the server.

### SSR Data Fetching & Caching
- Fetch data directly inside async Server Components.
- Use explicit fetch caching strategies (`cache: "no-store"`, `next: { revalidate: X }`).
- Handle errors using localized `error.tsx` error boundaries.
- Handle loading states using Suspense and `loading.tsx`.

### Mutations via Server Actions
- Use Server Actions (`"use server"`) for data mutations, form submissions, and database operations.
- Validate all incoming payloads using Zod schemas at the Server Action boundary.
- Never expose server secrets or private credentials to client components.

### API Routes (`app/api/`)
- API route handlers (`route.ts`) are restricted to transport orchestration, auth parsing, and HTTP status handling.
- Pure business logic, database queries, and third-party integrations must live in isolated service layers.

### SEO & Performance Built-ins
- Always use the Next.js `metadata` / `generateMetadata` API for page metadata and Open Graph tags.
- Always utilize `next/image` for image optimization and `next/font` for zero-layout-shift typography.
- Lazy-load heavy client components using `next/dynamic`.

---

## 2. Feature-Based Modular Architecture

```
src/ (or app/)
├── features/
│   ├── auth/                    # Self-contained feature module
│   │   ├── components/          # Feature-specific UI
│   │   ├── hooks/               # Feature-specific custom hooks
│   │   ├── services/            # Pure API & data access functions
│   │   ├── queries/             # TanStack Query definitions & mutation hooks
│   │   ├── types/               # Feature type definitions
│   │   └── index.ts             # Public API boundary
│   └── [feature-name]/
├── components/ui/               # Reusable dumb UI primitives (buttons, inputs)
├── lib/                         # Centralized API client, db client, auth config
└── utils/                       # Generic, domain-agnostic helpers
```

### Self-Contained Feature Boundary
- Each business domain MUST have its own isolated feature directory.
- Cross-feature coupling is forbidden: features must import from another feature only via its public `index.ts`, never from internal deep files.
- The global shared layer (`components/ui/`, `utils/`) may contain **only** domain-agnostic UI primitives and generic utilities. No business logic in shared folders.

---

## 3. Data Flow & Server State (TanStack Query)

### Server State Management
- When client-side server state caching is used, handle all queries via TanStack Query.
- **Forbidden**: Calling `fetch()` inside `useEffect()`, storing API data in component `useState()`, or maintaining duplicate data stores.

### Structured Query Keys
- Query keys must be structured arrays with parameters to prevent collision and enable targeted invalidation:
  ```ts
  // Allowed:
  ['rules', { page, filter }]
  ['profile', userId]

  // Forbidden:
  ['rules']
  ['data']
  ```

### Cache Invalidation on Mutation
- Every mutation must explicitly define cache invalidation rules (e.g., create invalidates list; update invalidates detail + list).

---

## 4. Component & Hook Discipline

### Pure UI Components
- UI components should be pure functions that receive data via props and emit events.
- Extract complex state, queries, and mutations into dedicated custom hooks.
- **Component Size Limit**: Soft limit 200 lines; hard limit 300 lines (requires decomposition).

### Custom Hook Naming & Responsibility
- Wrap all query and mutation access inside custom hooks named `use<Feature><Action>` (e.g., `useUserList`, `useCreateRule`, `useUserProfile`).
- Hooks must remain decoupled from specific DOM elements or layout markup.
