# 🚫 Negative Constraints & Architectural Anti-Patterns

> **Operating Invariant**: Negative constraints are as critical as positive rules. Preventing known architectural failure modes and speculative complexity cuts agent hallucinations and regressions by over 90%.

---

## 1. Universal Agent Anti-Patterns

| Anti-Pattern | Why It Fails | Strict Invariant |
| :--- | :--- | :--- |
| **Speculative Architecture** | Agents create unused folders, abstractions, or "future-proofing" files that add maintenance debt. | Implement strictly what is currently requested. **Current Needs > Future Possibilities (YAGNI)**. |
| **Rogue Package Installation** | Casually running `npm install <pkg>` for minor utilities that modern runtimes provide natively. | All production dependencies are declared and reviewed; this repository ships three (`@modelcontextprotocol/sdk`, `ajv`, `js-yaml`). Never install Axios, Lodash, or Moment. Verify with the `updateagents` skill's `--stack-guard` check against the Golden Stack Fence. |
| **Silent Error Swallowing** | Using empty `catch {}` blocks or returning default mocks when APIs fail. | Fail fast and loud. Log structured error details and exit cleanly with diagnostic codes. |
| **Synthetic Artifact Leakage** | Leaving proprietary IDE markers (`ORCA_RICH_MD`, Cursor, Windsurf wrappers) in commits. | Always unwrap and decode to raw markdown; backtick template tokens (`<issue-id>`). |
| **Context Window Overload** | Ingesting massive directories or entire logs into LLM context instead of surgical lookups. | Use targeted search/read tools to extract minimal verifiable evidence. Prefer `rg`/`fd`/`jq` where installed; fall back to the harness's grep/glob tools, which need no install. |

---

## 2. Frontend & UI Anti-Patterns

- ❌ **`useEffect` Data Fetching**: Never use raw `useEffect` hooks for remote data fetching in React 19 / modern Next.js. Use Server Components, Actions, or TanStack Query.
- ❌ **Cumulative Layout Shifts (CLS)**: Never render remote images or dynamic banners without explicit aspect-ratio or dimensions.
- ❌ **Inline CSS Magic Numbers**: Avoid arbitrary pixel values (e.g. `margin: 17px`). Use locked DTCG spacing tokens (`space-4`, `space-6`) and OKLCH palettes.
- ❌ **Client-Side Secret Ingestion**: Never import environment variables prefixed with database URLs or private keys into client components.

### 🎭 Anti-Delta: Client-Side Data Fetching vs Server Component
```tsx
// ❌ DON'T: Client-side useEffect data fetching (Race conditions & waterfalls)
function UserList() {
  const [users, setUsers] = useState([]);
  useEffect(() => {
    fetch("/api/users").then((res) => res.json()).then(setUsers);
  }, []);
  return <div>{users.map((u) => <div key={u.id}>{u.name}</div>)}</div>;
}

// ✅ DO: React Server Component (Direct, type-safe, zero client JS waterfall)
async function UserList() {
  const users = await db.query.users.findMany();
  return <div>{users.map((u) => <div key={u.id}>{u.name}</div>)}</div>;
}
```

### 🖼️ Anti-Delta: Unsized Image vs Layout-Stable Media
```tsx
// ❌ DON'T: Unsized remote images causing layout jumps (CLS)
<img src={heroUrl} alt="Hero banner" className="w-full" />

// ✅ DO: Explicit dimensions, aspect ratio, and priority hints
<Image
  src={heroUrl}
  alt="Hero banner"
  width={1200}
  height={630}
  priority
  className="w-full aspect-[1200/630] object-cover"
/>
```

---

## 3. Backend & API Anti-Patterns

- ❌ **Unvalidated Request Payloads**: Never process `req.body` or query params without a validating Zod schema.
- ❌ **N+1 Database Queries**: Avoid executing database queries inside map loops. Use batch queries or join loaders.
- ❌ **Raw SQL String Interpolation**: Always use parameterized queries or type-safe ORM drivers (Drizzle, Kysely, Prisma).
- ❌ **Inconsistent Error Envelopes**: APIs must return predictable envelopes: `{ success: false, error: { code, message } }`.

### 🛡️ Anti-Delta: Unvalidated Payload vs Structured Zod Envelope
```ts
// ❌ DON'T: Unvalidated request parsing & silent mock fallback
export async function POST(req: Request) {
  try {
    const data = await req.json();
    return Response.json({ ok: true, data });
  } catch {
    return Response.json({ ok: false }); // Swallowed error, untyped payload
  }
}

// ✅ DO: Strict Zod validation & predictable envelope
const PayloadSchema = z.object({
  email: z.string().email(),
  plan: z.enum(["starter", "pro"]),
});

export async function POST(req: Request) {
  const parsed = PayloadSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json(
      { success: false, error: { code: "VALIDATION_FAILED", details: parsed.error.flatten() } },
      { status: 400 },
    );
  }
  const result = await provisionAccount(parsed.data);
  return Response.json({ success: true, data: result }, { status: 201 });
}
```

### 🗄️ Anti-Delta: SQL Injection vs Parameterized Queries
```ts
// ❌ DON'T: Raw SQL string interpolation (SQL Injection vulnerability)
const user = await db.execute(`SELECT * FROM users WHERE id = '${userId}'`);

// ✅ DO: Parameterized queries or type-safe ORM schema
const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
```

---

## 4. Verification Gate Before Commit

Before claiming any task complete:
1. Did you add an unapproved dependency? Production dependencies are `@modelcontextprotocol/sdk`, `ajv` and `js-yaml` only — anything else is a stack change, not a fix. Run the `updateagents` skill's `--stack-guard` to check the Golden Stack Fence.
2. Are the gates passing? Run `bun test`, `bunx tsc --noEmit`, `bun run claims:check` and `bun run docs:check` — the same set CI runs. There is no `lint` script; do not invent one.
3. Are there any plaintext secrets or tokens exposed? Run `memory scan-secrets .`. It reports a non-zero count on this repository because 56 test fixtures deliberately embed fake credentials — treat a **new** finding in non-test code as a real leak.
