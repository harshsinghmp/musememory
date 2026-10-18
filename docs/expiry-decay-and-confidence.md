# Expiry, Decay & Confidence Hardening Guide

> **Audience**: Developers, platform engineers, and AI agent architects.  
> **Copy Framework**: QUEST / ACCA (Qualify Problem → Understand Architecture → Educate with Mathematical Truth → Stimulate Implementation → Actionable Runbooks).

---

## 1. Qualify: The Silent Decay Problem in Long-Term Agent Memory

AI coding agents and autonomous workflows fail in production not because they lack memory, but because **they remember too much obsolete, low-confidence, and untrusted noise**:

1. **Hallucination by Stale Workaround**: An agent recalls a transient bugfix or dependency hack from 6 months ago and re-applies it over an upgraded modern framework.
2. **Memory Poisoning (OWASP ASI06)**: Web-scraped documentation, unvetted external transcripts, or crawler inputs silently linger in vector/full-text stores forever, poisoning future coding sessions.
3. **Performative Certainty**: When an agent queries memory with ambiguous or out-of-domain queries, systems often return weak candidate matches with low cosine scores rather than frankly abstaining.
4. **Rigid Exponential Assumptions**: Real software knowledge does not decay at a single constant rate. Architectural patterns exhibit long survival tails, while dependency workarounds suffer rapid wear-out cliffs.

**Muse Memory Wave 15** introduces a zero-daemon, mathematically rigorous engine for **Abstention, Corroboration Confidence, Trust-Keyed Half-Lives, and Pin-Capable Expiry Policies**.

---

## 2. Understand: Wave 15 Architecture & Mathematical Formulations

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                               RETRIEVAL & ADMISSION PIPELINE                            │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                             │
      ┌──────────────────────────────────────┴──────────────────────────────────────┐
      ▼                                                                             ▼
[ 1. Ingest & Trust Tier ]                                           [ 2. Abstention Gate ]
• T1/trusted: 365d half-life                                         • Tokenizer-matched FTS5 check
• T2/verified: 180d half-life                                        • ID-decisive scoring (>0.30)
• T3/candidate: 90d baseline                                         • Returns no_confident_match
• T4/untrusted: 30d fast decay                                         when queries lack signal
      │                                                                             │
      ├──────────────────────────────────────┬──────────────────────────────────────┘
      ▼                                      ▼
[ 3. Decay & Hazard Engine ]            [ 4. Expiry Policy YAML ]
• Materialized decay_score (SQLite)     • First-match-wins declarative rules
• Importance-gated multiplier (0.4x-3x) • Pinned invariant exemptions (pinned: true)
• Optional Weibull non-constant hazard: • Per-type defaults: fix 90d, op 180d, arch 365d
  R(t) = exp(-(t / λ)^k)                • Stamped expired_at and expired_by rule name
  λ = t₁/₂ / (ln 2)^(1/k)
```

### A. Tokenizer-Matched Abstention Gate & `no_confident_match` Mode
Before executing costly token knapsack budgets or hybrid BM25/vector retrieval:
- **Tokenizer Parity**: `evaluateAbstentionGate(query)` tokenizes input identically to SQLite FTS5 (Unicode61 word boundaries).
- **Abstention Decision**: If a query contains solely generic stopwords, conversational greetings, or zero alphanumeric signal, retrieval immediately abstains.
- **`no_confident_match`**: The MCP and orchestrator return structured signals:
  ```json
  {
    "no_confident_match": true,
    "confidence_reason": "No retrieved candidate exceeded minimum confidence threshold 0.35"
  }
  ```
  The prompt context cleanly renders:
  ```markdown
  _No confident prior memories matched this query._
  ```
  This eliminates performative hallucinations where models guess answers from irrelevant matches.

### B. Bayesian Corroboration Confidence
Rather than assigning static confidence, confidence compounds asymptotically with independent corroborations $n$:
$$C(n) = 1 - 0.7^n$$
- $n = 0 \implies C(0) = 0.0$ (unverified candidate)
- $n = 1 \implies C(1) = 0.3000$ (initial observation)
- $n = 2 \implies C(2) = 0.5100$ (corroborated once)
- $n = 3 \implies C(3) = 0.6570$ (multi-day confirmation)
- $n = 5 \implies C(5) = 0.8319$ (highly confident convention)
- $n \to \infty \implies C(n) \to 1.0$ (asymptotic ceiling)

### C. Trust-Tier-Keyed Half-Lives (OWASP ASI06 Anti-Poisoning)
Half-life decay scales dynamically with provenance trust:

| Trust Tier | Provenance Sources | Base Half-Life | Decay Dynamics |
| :--- | :--- | :--- | :--- |
| **T1 / trusted** | `user`, `human`, `manual`, `principal`, `admin` | **365 days** | Long-term durable preservation |
| **T2 / verified** | Multi-corroborated candidates, automated test passes | **180 days** | Stable mid-term retention |
| **T3 / candidate** | `agent`, `transcript`, `inference`, `session` | **90 days** | Standard default baseline |
| **T4 / untrusted** | `web`, `crawler`, `external`, `scrape`, `unknown` | **30 days** | Rapid decay prevents poisoning |

### D. Optional Weibull Hazard Curve Modeling
Standard exponential decay assumes memoryless constant hazard ($k = 1$). Muse Memory provides re-derived Weibull retention curves calibrated to the exact half-life $t_{1/2}$:
$$R(t) = \exp\left( - \left(\frac{t}{\lambda}\right)^k \right) \quad \text{where} \quad \lambda = \frac{t_{1/2}}{(\ln 2)^{1/k}}$$

Because $\lambda$ is derived from $t_{1/2}$, **at $t = t_{1/2}$, $R(t_{1/2}) = 0.5000$ holds true for every shape parameter $k$**:
- **$k < 1$ (Infant Mortality / Heavy Tail, e.g. $k = 0.7$ for `architecture`, `adr`)**:
  Initial churn filters out speculative designs, but surviving decisions remain highly durable for years.
- **$k = 1.0$ (Constant Hazard, for `operation`)**:
  Standard exponential decay.
- **$k > 1$ (Wear-Out Cliff, e.g. $k = 1.6$ for `fix`, $k = 1.5$ for `discovery`)**:
  Retains high freshness during the initial weeks (plateau), followed by a sharp obsolescence cliff as software stacks evolve.

---

## 3. Educate: Declarative Expiry Policy YAML (`expiry.yaml`)

Define declarative rules in `.memory/expiry.yaml` (or pass to `applyExpiryPolicy`). Rules are evaluated sequentially: **first match wins**.

### Configuration Example
```yaml
# .memory/expiry.yaml
version: 1

rules:
  # 1. Critical Invariants: Never expire, permanently pin
  - name: pin_critical_security
    type: architecture
    tags: [security, compliance]
    pinned: true

  # 2. Ephemeral Test Discoveries: Rapid 7-day TTL
  - name: fast_test_discoveries
    type: discovery
    tags: [e2e, test, mock]
    ttl_days: 7
    reason: "E2E mock stubs expire after 7 days"

  # 3. Web Ingestion: Aggressive 14-day anti-poisoning expiry
  - name: expire_untrusted_web
    trust: untrusted
    ttl_days: 14
    reason: "OWASP ASI06 untrusted web scrapings limited to 14 days"

  # 4. Pattern-Based Workaround Rules
  - name: temporary_hotfixes
    pattern: "(?i)temporary|workaround|hotfix"
    ttl_days: 30
    reason: "Hotfix workarounds expire in 30 days"

  # 5. Fallback Defaults
  - name: default_fix_policy
    type: fix
    ttl_days: 90

  - name: default_operation_policy
    type: operation
    ttl_days: 180

  - name: default_architecture_policy
    type: architecture
    ttl_days: 365
```

---

## 4. Stimulate & Action: Developer Workflows & API Reference

### Proposing Memories with Automatic Per-Type Expiry
```typescript
import { openStore, propose } from "musememory";

const store = openStore(".memory");

// 1. Automatic per-type expiration (Fix defaults to 90 days)
const fix = propose(store, {
  title: "Patch connection leak in Redis client",
  content: "Ensure pool.release(client) is invoked in finally blocks.",
  project: "backend",
  type: "fix",
});
console.log(fix.expires_at); // ISO date 90 days from now

// 2. Pinning an architectural invariant permanently
const arch = propose(store, {
  title: "CAP Theorem Invariant",
  content: "In partition states, prioritize consistency over availability for ledger writes.",
  project: "ledger",
  type: "architecture",
  pinned: true, // Immune to expiration sweeps
});
console.log(arch.expires_at); // undefined (exempt)

// 3. Explicit Null Opt-Out
const permFix = propose(store, {
  title: "Core math normalization",
  content: "Floating point rounding precision baseline.",
  project: "math",
  type: "fix",
  expires_at: null, // Explicitly opted out of default 90d expiry
});
```

### Stamping Expiry Transitions & Running Sweeps
```typescript
import { openStore, expireEntry, sweepExpiredEntries } from "musememory";

const store = openStore(".memory");

// 1. Manually expire an entry with stamped rule metadata
const expired = expireEntry(store, "m_1792350000000_oldhack", {
  rule: "manual_deprecation",
  reason: "Replaced by v3 auth subsystem",
});
console.log(expired.status);     // "expired"
console.log(expired.expired_at); // ISO timestamp
console.log(expired.expired_by); // "manual_deprecation"

// 2. Batch sweep past-due memories
const sweep = sweepExpiredEntries(store, {
  now: Date.now(),
  rule: "cron_daily_sweep",
});
console.log(`Expired ${sweep.expired.length} memories, skipped ${sweep.skippedPinned} pinned.`);
```

### Querying Context with `no_confident_match`
```typescript
import { openStore, queryContext } from "musememory";

const store = openStore(".memory");

// Ambiguous query that fails abstention or confidence threshold
const res = queryContext(store, "hello there how are you");
if (res.no_confident_match) {
  console.log("No confident matches found. Abstaining from hallucinations.");
} else {
  console.log(`Found ${res.results.length} confident memories.`);
}

// Expired memories are excluded by default, but accessible for audits:
const auditRes = queryContext(store, "auth token", { includeExpired: true });
```

---

## 5. Verification Matrix & Quality Gate

Every ticket in Wave 15 is covered by independent unit tests verified via `bun test` and typechecked via `tsc --noEmit`:

| Ticket | Component | Verification Suite | Invariants Tested |
| :--- | :--- | :--- | :--- |
| **T-072** | FTS5 Abstention Gate | `test/retrieval_engine.test.ts` | Tokenizer boundary parity, greeting abstention |
| **T-073** | `no_confident_match` Mode | `test/retrieval_engine.test.ts`, `test/mcp.test.ts` | Clean fallback output, boolean flag signaling |
| **T-074** | Materialized `decay_score` | `test/decay_score.test.ts` | SQLite migration 4, importance gating (0.4x - 3.0x) |
| **T-076** | Bayesian Confidence | `test/corroboration.test.ts` | $C(n) = 1 - 0.7^n$, promotion corroboration gate |
| **T-077** | Trust-Tier Half-Lives | `test/trust_tier_retention.test.ts` | T1 (365d) to T4 (30d), rapid untrusted decay |
| **T-078** | Per-Type `expires_at` | `test/per_type_expiry.test.ts` | Fix 90d, Op 180d, Arch 365d, Disc 30d, exemptions |
| **T-079** | Stamped Expiry Status | `test/stamped_expiry.test.ts` | `status: 'expired'`, `expired_at`, `expired_by` |
| **T-080** | Expiry Policy YAML | `test/expiry_policy_yaml.test.ts` | First-match-wins, pin capability, YAML loader |
| **T-081** | Weibull Decay Curves | `test/weibull_retention.test.ts` | $R(t_{1/2}) = 0.5$ invariant, wear-out cliffs, heavy tails |
