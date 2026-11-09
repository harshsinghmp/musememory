# TECHNICAL_DEBT — Wave 26 audit (2026-11-09)

| # | Finding | Location | Fix |
|---|---|---|---|
| W26-1 | Two file→memory resolvers (`recallAnchoredMemories` vs `resolveMemoryForCode`) with different matching | `src/retrieval/anchors.ts`, `src/orchestrator/bidirectional.ts` | Pick one owner; extend it with project + freshness |
| W26-2 | Pre-flight token budget covers entries only; constraints/CORE blocks are appended uncounted | `src/hooks/preflight.ts`, `src/retrieval.ts` | Count/trim the final markdown or rename the claim to "entry budget" |
| W26-3 | ~~Pre-flight is CLI-only~~ **done**: PreToolUse hook + read-only `muse_preflight` MCP tool | `src/hooks/pack.ts`, `src/mcp.ts` | — |
| W26-4 | `associated` is ids-only and not fused into ranking/token accounting | `src/retrieval.ts` | Fuse with `why_retrieved` vocabulary or document the consumer contract |
| W26-5 | Recursive CTE work is not bounded by `maxNodes` before projection | `src/associative.ts` | Push the limit into the recursive member |
