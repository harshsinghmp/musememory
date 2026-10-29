# ⚡ Cloudflare Workers & Hono API Standards

> **Runtime Target**: Hono `@latest` · Cloudflare Workers / Pages Functions · Drizzle ORM · Neon HTTP Driver

---

## 1. Route Architecture

- **Resource Modularity**: Exactly one route file per resource located under `src/routes/` (e.g., `src/routes/users.ts`, `src/routes/orders.ts`).
- **Input Validation**: Validate both request body and query parameters with strict **Zod schemas** before touching the database or business services.
- **Structured JSON Responses**: Always return standard responses using `return c.json(data, status)` or `Response.json(data, { status })`. Do not invent non-standard response wrapper helpers.

---

## 2. Database & Persistence Rules

- **Drizzle ORM**: Schemas live in `src/db/schema.ts`; migrations live in `src/db/migrations/`.
- **Worker Environment Constraints**:
  - Never import `node:fs`, `node:net`, or native Node-only modules. All code runs in Cloudflare Workers V8 isolate environment.
  - Use `@neondatabase/serverless` (Neon HTTP driver) or Cloudflare D1/Hyperdrive for database access.
- **Middleware Scoping**: Do not attach heavy middleware to the root app instance; scope authentication, rate limiting, and logging middleware directly to specific router groups.

---

## 3. Testing & Verification

- **In-Process Vitest**: Test routes in-memory using `app.request('/path', { method: 'POST', body: ... })` instead of spawning external HTTP servers or calling live networks.
- **Database Transaction Isolation**: In integration tests, run each test inside an isolated database transaction that rolls back upon test completion.
- **Zero Real Secret Hardcoding**: Inject `DATABASE_URL` and API tokens exclusively through Worker environment bindings (`c.env.DATABASE_URL`).

---

## 4. Standard Commands

```bash
pnpm install     # Install dependencies
pnpm dev         # Local Workers runtime (Wrangler)
pnpm test        # Vitest in-process test suite
pnpm lint        # Run linter
pnpm typecheck   # Check types
```
