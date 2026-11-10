# TECHNICAL_DEBT — Wave 26 audit (2026-11-09)

| # | Finding | Location | Fix |
|---|---|---|---|
| W26-1 | ~~Two file→memory resolvers~~ **done**: canonical `resolveMemoriesForCode`; pre-flight and PR context are adapters | `src/retrieval/code_context.ts` | — |
| W26-2 | ~~Pre-flight token budget covers entries only~~ **done**: `tokenBudget` now bounds the whole assembled pack. `preflightContext` measures the final markdown and re-queries with a halved entry allocation until it fits; mandatory blocks (USER.md, CORE.md) are never dropped, and `markdownTokens` / `withinBudget` report the real figure instead of the entry subset. A pack that cannot fit says so rather than claiming compliance | `src/hooks/preflight.ts`, `src/cli/retrieval.ts`, `src/mcp.ts` | — |
| W26-3 | ~~Pre-flight is CLI-only~~ **done**: PreToolUse hook + read-only `muse_preflight` MCP tool | `src/hooks/pack.ts`, `src/mcp.ts` | — |
| W26-4 | `associated` is ids-only and not fused into ranking/token accounting | `src/retrieval.ts` | Fuse with `why_retrieved` vocabulary or document the consumer contract |
| W26-5 | Recursive CTE work is not bounded by `maxNodes` before projection | `src/associative.ts` | Push the limit into the recursive member |

- ~~**W26-6**: no audit event for cross-project/untrusted reads~~ **done**: `read` audit operation and events.
