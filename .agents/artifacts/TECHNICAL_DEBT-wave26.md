# TECHNICAL_DEBT — Wave 26 audit (2026-11-09)

| # | Finding | Location | Fix |
|---|---|---|---|
| W26-1 | ~~Two file→memory resolvers~~ **done**: canonical `resolveMemoriesForCode`; pre-flight and PR context are adapters | `src/retrieval/code_context.ts` | — |
| W26-2 | ~~Pre-flight token budget covers entries only~~ **done**: `tokenBudget` now bounds the whole assembled pack. `preflightContext` measures the final markdown and re-queries with a halved entry allocation until it fits; mandatory blocks (USER.md, CORE.md) are never dropped, and `markdownTokens` / `withinBudget` report the real figure instead of the entry subset. A pack that cannot fit says so rather than claiming compliance | `src/hooks/preflight.ts`, `src/cli/retrieval.ts`, `src/mcp.ts` | — |
| W26-3 | ~~Pre-flight is CLI-only~~ **done**: PreToolUse hook + read-only `muse_preflight` MCP tool | `src/hooks/pack.ts`, `src/mcp.ts` | — |
| W26-4 | ~~`associated` is ids-only and not fused into ranking/token accounting~~ **documented**: kept as a separate channel rather than fused. Fusion would change ranking behaviour, which is a product decision, not a debt fix. The contract is now stated on `SearchResult.associated`: graph neighbours, not ranked results; excluded from `results`; **not counted in `totalTokensUsed`**, so a caller injecting them must budget separately; ids plus depth only | `src/retrieval.ts` | — |
| W26-5 | ~~Recursive CTE work is not bounded by `maxNodes` before projection~~ **done**: the bound now also sits inside the recursive member. With it only on the outer SELECT, SQLite materialised the whole reachable frontier first — a 1200-node dense graph walked ~11.5k rows and took ~112ms (270ms at 3k nodes) to return at most 100. Bounded: ~7-10ms, identical output. Regression test asserts the wall-clock ceiling, so it fails if the inner LIMIT is removed | `src/associative.ts` | — |

- ~~**W26-6**: no audit event for cross-project/untrusted reads~~ **done**: `read` audit operation and events.
