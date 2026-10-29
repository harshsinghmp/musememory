# 📐 System, Domain & Resilience Design Standards

> Synthesized from: Eric Evans' *Domain-Driven Design*, Michael Nygard's *Release It!*, and High-Reliability Distributed Systems Engineering.

---

## 1. Domain-Driven Design Principles (Eric Evans)

### Ubiquitous Language & Bounded Contexts
- **Ubiquitous Language**: Code entities, method names, and test descriptions must use the exact business terminology of the domain expert within that bounded context.
- **Explicit Context Boundaries**: A domain model is valid only inside its own bounded context. Never create a company-wide "god" model. Translate across context boundaries using explicit Anti-Corruption Layers (ACL) or Published Languages.
- **Core Domain Distillation**: Focus rich modeling on the core strategic domain; keep supporting and generic subdomains lightweight.

### Building Blocks
- **Entities**: Objects with persistent identity over time. Entities must protect their own valid state transitions (no public setters for arbitrary mutations).
- **Value Objects**: Immutable objects defined strictly by their attributes. Construction must guarantee validity; equality is determined by value.
- **Aggregates & Consistency Boundaries**: Aggregates are strict consistency boundaries. Keep them as small as possible. All modifications must route through the aggregate root; reference other aggregates by identity only.
- **Repositories**: Repositories exist for aggregate roots, not individual database tables. Return domain objects, not raw database rows or ORM records.
- **Domain Services**: Use domain services only for business logic that naturally spans multiple entities or value objects.

---

## 2. Production Stability & Resilience (Michael Nygard)

### Stability Mindset
Assume production is hostile and fragile: every dependency can be slow, every queue can fill, every cache can miss or stampede.

### Dependency Protection
- **Mandatory Timeouts**: Every outbound network call, database query, or inter-service request MUST have an explicit, intentional timeout. Infinite waits are strictly forbidden.
- **Disciplined Retries**: Retry only idempotent operations. Always apply exponential backoff with random jitter to prevent retry storms. Never retry permanent 4xx or validation failures.
- **Circuit Breakers**: Protect unstable downstreams by tripping to fast-fail mode when error rates spike.
- **Bulkheads & Isolation**: Isolate slow or failure-prone dependencies in dedicated resource pools so one failing third-party does not exhaust the entire system's thread or connection pool.

### Overload & Capacity Control
- **Back Pressure**: Implement explicit back pressure when producers outpace consumers.
- **Load Shedding**: Gracefully reject low-priority requests under extreme load to preserve core system availability.
- **Dead-Letter Queues**: Every asynchronous queue must define poison-message handling and a dead-letter queue.

---

## 3. Explicit Persistence & Data Mapping Boundaries

- **Named Mapping Methods**: Persistence-layer ↔ domain-model conversions (Payload CMS, Neon, Supabase, SQLite, ORMs) MUST use explicit named methods (e.g., `fromRecord()`, `toRecord()`, `toDTO()`).
- **Prohibited**: Implicit casting, unchecked `as unknown as Type`, or field-by-field object spreading (`{ ...dbRow }`) across architectural boundaries.
- **Data Protection**: Prevent internal database columns, metadata, or sensitive properties from leaking to client components or public API responses.

---

## 4. Database Safety & Migration Rehearsal Protocol

- **Rehearsal Before Proposal**: Before proposing or applying database migrations (Drizzle, Prisma, SQL), rehearse the full migration history against a fresh throwaway database (`npx create-db@latest --json` or local isolated container) and verify test passes.
- **Destructive Operation Gate**: Never run destructive operations (`DROP TABLE`, `TRUNCATE`, `db push --accept-data-loss`, `migrate reset`) on staging or production without explicit authorization.
- **Zero Inlined Credentials**: Store connection strings strictly in `.env.local` or environment secrets. Never commit connection URIs to version control.

---

## 5. Mathematical & Algorithmic Exactness

- **Concrete Scoring Formulas**: Algorithms for ranking, cache invalidation, or relevance must use explicit mathematical weights and decay constants ($Score = \sum W_i \cdot S_i \times e^{-\lambda \Delta t}$).
- **Determinism & Fallback Parity**: Accelerators (e.g., SQLite FTS5 or vector indices) must maintain output parity with zero-dependency fallbacks.

---

## 6. API & Library Fidelity (Zero Hallucinated Options)

- **Exact Constructor Signatures**: Verify configuration keys against installed `.d.ts` definitions or local package documentation before use.
- **Dual-Layer Specifications**: Pair human-readable YAML/JSON examples with formal machine-checkable schemas (Zod, JSON Schema, Pydantic) validated via automated tests.
