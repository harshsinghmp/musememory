# SDD ledger — Wave 4: Compaction, Ephemeral Observations & Distillation
Plan: Wave 4 In-Line Cognition
Branch: feat/wave-4-compaction-distillation
Base Commit: 90a6d3f

## Task List
- [x] Task 1: Observation Hardening & Distillation Protection (T-305, T-306)
- [x] Task 2: Compaction Checkpoint Invariants & Extraction Hooks (T-045, T-047)
- [x] Task 3: Persisted Digest Deduplication Set (T-046)
- [x] Task 4: Honest Dual-Measure Token Accounting & Refuse-Incomplete Digest (T-053, T-054)
- [ ] Task 5: Context-Pack Compaction, Manifest TOC & Truncation Hierarchy (T-091, T-092, T-093, T-094)

## Progress Log
- Task 1: complete (T-305 capDistillationBody prevents raw log memory bloat; T-306 atomic write and budget-based log rotation; 6/6 tests pass).
- Task 2: complete (T-047 validateCompactionInvariants never-empty contract; T-045 on_pre_compress hook and extractInvariantsPreCompress; 7/7 tests pass).
- Task 3: complete (T-046 persisted SHA-256 digest dedup store in .memory/digest_dedup.json preventing duplicate memory extraction on repeated runs; 4/4 tests pass).
- Task 4: complete (T-053 dualMeasureTokens accounting with standard + pessimistic model; T-054 validateDigestIntegrity and refuse-incomplete CURRENT.md contract; 5/5 tests pass).
