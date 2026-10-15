# SDD ledger — Wave 3: Retrieval Quality, Ranking & Token Economics
Plan: Wave 3 In-Line Retrieval
Branch: feat/wave-3-retrieval-ranking
Base Commit: c2ac959

## Task List
- [x] Task 1: Scale Safety & Performance Core (T-035, T-036, T-037)
- [x] Task 2: FTS5 Query Injection Safety & Compound Token Splitting (T-060, T-061, T-312)
- [x] Task 3: Relevance Gating & Soft-OR Evidence Fusion (T-070, T-114)
- [x] Task 4: Conditional Reranking, Watermark Staleness & Reason Tokens (T-115, T-117, T-126)
- [x] Task 5: Integration, Negative Lesson Priority Knapsack & Full Gate Verification

## Progress Log
- Task 1: complete (commit d21768b, T-035 iterative safeMax, T-036 in-memory IDF caching, T-037 countMemories scan elimination; 5/5 tests pass).
- Task 2: complete (commit 1cef9ba, T-060 safe FTS5 escaping, T-061 compound token expansion, T-312 error observability; 7/7 tests pass).
- Task 3: complete (commit be7b70d, T-070 relevance gate, T-114 Soft-OR evidence fusion; 6/6 tests pass).
- Task 4: complete (commit ba7041b, T-115 conditional rerank, T-117 watermark staleness, T-126 why_retrieved reason tokens; 4/4 tests pass).
- Task 5: complete (integration test suite test/wave3_retrieval_integration.test.ts 4/4 pass, knapsack packing prioritization for negative anti-pattern lessons, full test suite 730/730 pass, tsc clean, build clean, doctor clean).
