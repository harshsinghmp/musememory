# Security Policy

Muse Memory stores what an agent is told to remember, so a weakness here is a
weakness in every session that reads the store back. This document says which
versions get fixes, how to report a problem privately, and what is in scope.

## Supported versions

| Version | Supported |
| --- | --- |
| **3.4.x** | ✅ Security fixes land here. |
| **≤ 3.3** | ❌ Unsupported. Please upgrade to the latest 3.4.x before reporting — a fix will not be backported to a pre-3.4 line. |

The current release is published on npm as [`musememory`](https://www.npmjs.com/package/musememory).
Run `memory --version` (or `npx musememory@latest --version`) to check what you
have; `memory upgrade` moves an installation forward.

## Reporting a vulnerability

**Use GitHub private vulnerability reporting.** Open the repository's
[**Security** tab](https://github.com/harshsinghmp/musememory/security) and
choose **"Report a vulnerability"**. That opens a private advisory that only the
maintainers can see, and it is the only reporting channel for this project —
there is **no security email address**, and none should be inferred from the
`LICENSE`, the package metadata or a contributor's profile.

Please do not open a public issue, a discussion or a pull request for a suspected
vulnerability. A public report is a disclosure; the advisory is not.

A useful report includes:

- the affected version (`memory --version`) or commit;
- the surface involved — MCP server (stdio or Streamable HTTP), sync
  attestations, the Studio dashboard, the CLI, or the native extension loading
  path;
- the smallest reproduction you have, and the impact you believe it has
  (confidentiality, integrity, availability, or a bypass of a documented gate);
- whether you would like credit in the advisory and the release notes.

## What happens next

| Stage | Target |
| --- | --- |
| Acknowledgement that the report was received | **72 hours** |
| Triage — severity, affected versions, whether it is in scope | **7 days** |
| A fix, or a written mitigation plan when a fix needs longer | **30 days** |

These are targets, not a contract, and they are measured from the moment the
private advisory is opened. If a target slips you will be told why in the
advisory rather than left guessing.

## Coordinated disclosure

We will agree a disclosure date with you, and the default is **90 days from the
report or the release that contains the fix, whichever comes first**. If the fix
ships sooner, the advisory is published with it. If you need longer for your own
users, say so in the report. We will credit you by the name or handle you
choose, unless you ask us not to.

## In scope

- **The MCP server and its transports** — stdio and the Streamable HTTP server:
  bearer-token authentication, per-peer token mappings and the `allowedPeers`
  allowlist, the browser-origin gate, the Host/DNS-rebinding allowlist, session
  handling, request-directory confinement, and tool/prompt/resource output
  handling.
- **Sync attestations** — Ed25519 packet and chain verification, the signature
  scheme registry, trust-anchor resolution and peer-trust decisions in
  `src/sync/`.
- **The Studio dashboard** (`memory ui`) — the token gate on mutating endpoints,
  the same-origin gate, and the security headers the server emits.
- **The CLI** — argument handling, the secret scanner (Vibeguard), install and
  upgrade paths, and anything that writes outside the workspace it was pointed at.
- **The native extension loading path** — how `sqlite-vec` is discovered, loaded
  and falls back from (`src/vector/vec-index.ts`, `loadExtension` in
  `src/sqlite.ts`), including anything that could load a library from an
  attacker-controlled path.

## Out of scope

- **Issues in forks and derivatives.** A fork is its own project; report to
  whoever maintains it.
- **Social engineering** — of maintainers, contributors or users — including
  phishing, pretexting and "you must run this command" support requests.
- **The contents of the `.memory` store.** That is your data, by design: the
  engine treats stored text as untrusted input and fences it, but it does not and
  cannot audit what a user, an agent or an import put in it. A memory that
  contains a secret, a prompt injection or a false claim is a data problem, not a
  vulnerability in the engine — unless it escapes a documented gate, which is in
  scope above.

## Safe harbour

Research done in good faith under this policy is authorised. We will not pursue
or support legal action against a researcher who:

- works against their own installation, or a store they are authorised to test;
- avoids privacy violations, destruction of data and degradation of service for
  anyone else;
- reports privately and gives us the agreed time to fix before publishing;
- does not exploit a finding beyond the minimum needed to demonstrate it.

If in doubt about whether an action is authorised, ask in the advisory first.

## Hardening already in place

A non-exhaustive list of the fixes that shaped the current attack surface, so a
report does not have to re-derive them:

- **Constant-time token comparison** — MCP bearer tokens and the Studio token are
  compared with `crypto.timingSafeEqual`, byte length included, instead of
  `Set.has()`/`===` (issue [#513](https://github.com/harshsinghmp/musememory/issues/513)).
- **Deletion reconciliation for the vector index** — orphan vectors can no longer
  shrink a result page; `memory_vec` rows with no live `memories` row are deleted
  once per store open (issue [#519](https://github.com/harshsinghmp/musememory/issues/519)).
- **Loopback is not a trust boundary** — the MCP HTTP transport allows a browser
  `Origin` only when it is explicitly allowlisted, for the preflight and every
  request, before auth (issue [#511](https://github.com/harshsinghmp/musememory/issues/511)).
- **Request directories are confined** to the workspace the server was started
  for, through symlink-aware resolution; `MUSE_MCP_ALLOW_EXTERNAL_DIR=1` is the
  operator opt-in (issue [#512](https://github.com/harshsinghmp/musememory/issues/512)).
- **Stored text is data** — prompts and resources are wrapped in a
  `data-not-instructions` fence with fence tokens stripped, and memory writes
  that carry instructions are classified and held as `candidate`
  (issues [#514](https://github.com/harshsinghmp/musememory/issues/514),
  [#522](https://github.com/harshsinghmp/musememory/issues/522)).
- **The Studio ships a strict CSP** with a same-origin gate on every `/api/*`
  request and escapes every memory-derived field before it reaches the DOM
  (issue [#520](https://github.com/harshsinghmp/musememory/issues/520)).
- **Sync peer trust is signature-first** — unsigned packets cannot borrow peer
  trust through inherited object names, and CI never interpolates a branch name
  into a shell (issue [#510](https://github.com/harshsinghmp/musememory/issues/510)).
- **Releases are verifiable** — an SBOM and `SHA256SUMS` are generated and
  cosign-signed keyless on the release tag
  (issues [#523](https://github.com/harshsinghmp/musememory/issues/523),
  [#526](https://github.com/harshsinghmp/musememory/issues/526)).

## Related documents

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — development setup and review expectations.
- [`docs/agent-reference.md`](docs/agent-reference.md) — the threat gates an agent
  runs into at runtime.
- [`docs/crypto-inventory.md`](docs/crypto-inventory.md) — every algorithm in the
  tree and why it is there.
