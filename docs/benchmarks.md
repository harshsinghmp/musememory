# Benchmarks & Capability Matrix (T-425)

This page is the honest, capability-first comparison surface. It deliberately
does **not** name or rank other products. Numbers are only quoted from
`claims.json`, which is generated from this repository's own measurements.

## What is measured

| Metric | Source | Method |
|---|---|---|
| L0 hot-cache lookup | `claims.json` → `latency` | in-process map read, p50/p95/p99 |
| FTS5 BM25 recall | `claims.json` → `latency` | SQLite FTS5 over the fixture corpus |
| Context assembly | `claims.json` → `latency` | token-budgeted pack build |
| Recall quality | `test/recall-eval.test.ts` | must-return, must-not-return, abstention |
| Token efficiency | `test/vault_terrain.test.ts` | terrain maps vs raw corpus |

## Capability matrix

| Capability | This repository | Notes |
|---|---|---|
| Local-only storage | Yes | SQLite + YAML mirror in `.memory/`; no cloud, no daemon |
| Dual scope | Project, global, mesh | one owner process per store |
| Lifecycle | candidate → confirmed → superseded/stale/expired | tombstones, restore, audit replay |
| Temporal queries | `as_of` + bi-temporal belief time | `asserted_at` vs `valid_from`/`valid_to` |
| Contradictions | claim-scoped detection, keep-both table | calibration fixture gates precision/recall |
| Code anchors | symbol/route/test anchors with drift | write-time verification, recall-time freshness |
| Negative memory | `DO_NOT_USE`, `FAILED_APPROACH`, fix pairs | avoid repeating known failures |
| MCP tooling | generated matrix | `docs/mcp-tool-matrix.json` |
| Team sync | opt-in, bearer-token server | local/team services opt-in; no required daemon |
| Playbooks | procedural trajectories with verification | outcomes recorded per run |

## Reproduce

```bash
bun run benchmark            # latency + quality scoreboard
bun test test/recall-eval.test.ts
bun test test/vault_terrain.test.ts
bun run claims:generate --check
```

## Honesty rules

- Every number in a published surface must trace to `claims.json` or a named
  test; unmeasured values are written as "not measured".
- Lab latency is not field latency; the viewport/benchmark environment is
  recorded with the report, not implied.
- Capability rows describe this repository only. No competitor names, scores
  or screenshots appear here by policy.
