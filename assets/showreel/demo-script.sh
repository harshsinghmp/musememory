#!/usr/bin/env bash
# T-423: deterministic terminal demo. Run from a scratch workspace.
set -euo pipefail

line() { printf '\n\033[1;33m$ %s\033[0m\n' "$*"; }
run() { line "$*"; "$@"; sleep 1; }

run memory capture "Flaky auth test passes alone but fails in the full suite: shared token cache is mutated by the login test." --type failure --project demo
run memory recall "flaky auth test shared token cache"
run memory capture "Fix: reset the token cache in beforeEach; flaky test is green for 20 consecutive runs." --type fix --project demo
run memory briefing --project demo
run memory health --project demo
