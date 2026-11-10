# TECHNICAL_DEBT — Wave 26 audit (2026-11-09)

| # | Finding | Location | Fix |
|---|---|---|---|
| W26-1 | ~~Two file→memory resolvers~~ **done**: canonical `resolveMemoriesForCode`; pre-flight and PR context are adapters | `src/retrieval/code_context.ts` | — |
| W26-2 | Pre-flight token budget covers entries only; constraints/CORE blocks are appended uncounted | `src/hooks/preflight.ts`, `src/retrieval.ts` | Count/trim the final markdown or rename the claim to "entry budget" |
| W26-3 | ~~Pre-flight is CLI-only~~ **done**: PreToolUse hook + read-only `muse_preflight` MCP tool | `src/hooks/pack.ts`, `src/mcp.ts` | — |
| W26-4 | `associated` is ids-only and not fused into ranking/token accounting | `src/retrieval.ts` | Fuse with `why_retrieved` vocabulary or document the consumer contract |
| W26-5 | ~~Recursive CTE work is not bounded by `maxNodes` before projection~~ **done**: the bound now also sits inside the recursive member. With it only on the outer SELECT, SQLite materialised the whole reachable frontier first — a 1200-node dense graph walked ~11.5k rows and took ~112ms (270ms at 3k nodes) to return at most 100. Bounded: ~7-10ms, identical output. Regression test asserts the wall-clock ceiling, so it fails if the inner LIMIT is removed | `src/associative.ts` | — |

- ~~**W26-6**: no audit event for cross-project/untrusted reads~~ **done**: `read` audit operation and events.
