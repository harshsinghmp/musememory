# 📜 Changelog

All notable changes to the **Muse Memory** (`musememory`) project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **The 41 Studio API branches left `startUiServer()` (issue #450)**: `startUiServer()` was a ~1,168-line function whose body was a 43-branch `if (pathname === …)` chain, so every route, the security headers, static asset serving and the server lifecycle shared one closure. The 41 `METHOD /api/...` branches (39 distinct paths; `/api/current` and `/api/user-profile` answer both GET and POST) now live in `src/ui/routes.ts` as `STUDIO_ROUTES`, a `Map<string, UiHandler>` keyed by `${METHOD} ${path}` and dispatched by exact lookup — every removed branch was `pathname === "…" && req.method === "…"` with no `startsWith`, regex or shadowed pair, so the table is order-free and equivalent to the chain. Handlers take `(req, res, ctx)` over an explicit `UiRouteContext` — store, memoryDir, token, parsed URL, JSON responder, body parser, and the scope/freshness/scoped-view/mesh helpers plus the workspace-root accessor — and one `StudioRouterState` per server holds the only state that outlives a request: the T-466 projection cache and its generation, the lazily opened global store, the mesh topology/result caches, the 5s agent-hub cache and the backup counter. `READ_ONLY_POST_ROUTES` moved with them and is still consulted by `startUiServer()` before dispatch, so projection invalidation keeps its exact position in the pipeline (ahead of static assets). `startUiServer()` keeps server creation, bind/listen, socket teardown, URL parsing, security/CORS/CSRF/OPTIONS handling, static asset serving, dispatch and the 404 fallthrough; it drops from 1,397 to 248 lines. Behaviour is unchanged: the method+path set is identical to `origin/dev` (41 pairs, `diff` empty), `test/ui.test.ts` is 27 pass / 0 fail with 396 expects before and after, and the full suite is 1,709 pass / 0 fail. Verified by `bunx tsc --noEmit`, `bun run build`, `cli:check`, `claims:check`, `changelog:check` and `docs:check`.

## [3.4.5] - 2026-11-26

**Full Changelog**: https://github.com/harshsinghmp/musememory/compare/v3.4.4...v3.4.5

### Changed
- **The Studio page's 1,751-line client script left a template literal (issue #445)**: `src/ui_assets.ts` held `STUDIO_CSS`, `STUDIO_JS` and `STUDIO_BODY` as template literals — 2,781 lines, ~97% of the file string content — so no compiler, linter or test ever parsed the browser JavaScript, and a syntax error shipped as a broken Studio page instead of a red build. The three literals now live as real files — `src/ui/assets/studio.js` (1,750 lines), `studio.css` (367) and `studio.html` (583) — imported with Bun's text loader (`with { type: "text" }`), which inlines their bytes into `dist/index.js` at build time; `src/ui_assets.ts` drops from 2,781 to 86 lines and still exports the same `STUDIO_*_ASSET` names. Nothing reads `src/` at runtime, so the published package (which ships `dist/` only) is unaffected. The moved bytes are identical: every asset's `body`, gzip buffer, ETag and content type hash-match `origin/dev`, so the `/assets/studio.*` routes and both the served and standalone HTML are unchanged. The new `test/studio_assets.test.ts` is the gate that was missing — `new Function(STUDIO_JS)` compiles the script, the inlined text must equal the on-disk file with no leftover `\${` escape artefacts and no `<script` in either inline-embedded asset, the client `escapeHtml` is extracted and run against the same corpus as the server copy at `src/ui.ts` so the two cannot drift, and the stylesheet's braces must balance. Verified by `bun test` (1709 pass / 0 fail), `bunx tsc --noEmit`, `bun run build` with the Studio script still present in `dist/index.js`, plus `cli:check`, `claims:check`, `changelog:check` and `docs:check`.
- **Dead exports removed and 92 internal helpers unpublished (issue #446)**: 83 exported runtime symbols had zero references outside their own file, which makes dead surface read as supported API to the next maintainer or agent. Twelve were referenced nowhere at all and are deleted — `loadPartition`/`loadShard`/`deleteTreeIndex`, `deleteMemoryById`, `migrateSettingsStore`, `detectGraphProvider` (a bare alias of `detectProvider`), `resetAllCircuitBreakers`, `clearBinaryCache`, `topicSlug`, `computeApplicability`, `SEMANTIC_COSINE_MAX_THRESHOLD` — along with `src/settings/watcher.ts`, a 30-line dead duplicate of the daemon's watcher that survived only through a barrel `export *`. The remaining 92 exported symbols that are used only within their own module lost the `export` keyword, so the surface now matches real usage; `export *` barrels were deliberately left alone. Verified by `bun test` 1700 pass / 0 fail, `bunx tsc --noEmit`, `bun run build` and every derived-artifact gate.
- **The 132-case tool dispatch left `createServer()` (issue #444, slice 3)**: the `switch` mapping every `CallTool` request to its handler lived inline in `src/mcp.ts`'s request handler, so store resolution and ~1,700 lines of tool bodies shared one function. The switch body now lives in `src/mcp/dispatch.ts` as `dispatchToolCall(args, ctx)` over an explicit `DispatchContext` — `name`, `activeStore`, `activeMemoryDir`, `activeRoot`, `activeProfile`, `enqueueWrites` — i.e. every closure value the cases actually use is passed in, so `mcp.ts` imports only the function and its context type and `dispatch.ts` never imports back (one direction, no cycle). `toolResult`/`toolError` moved to `src/mcp/tool-result.ts`, because the `mcp.enabledTools` gating branch that stays in `mcp.ts` still needs `toolError`. `createServer()` keeps store resolution (`resolveStoreForRequest`), profile gating, the outer `try/catch` and an `await` on the call, so a case that throws still surfaces as the same `toolError` message. `src/mcp.ts` drops from 2,024 to 153 lines. Behaviour is unchanged: all 132 case labels are identical and in the same order (`grep -o 'case "[a-z_0-9]*"'` diff empty), and `test/mcp.test.ts` / `test/mcp_auth.test.ts` / `test/mcp_http_transport.test.ts` pass 18/14/7 both before and after. Verified by `bun test` (1,696 pass / 0 fail), `bunx tsc --noEmit`, `bun run build`, `cli:check`, `claims:check`, `changelog:check` and `docs:check`.
- **HTTP transport and auth left `src/mcp.ts` (issue #444, slice 2)**: the 319-line block from `HttpMcpServerOptions` through `startHttpMcpServer` — the options type, `HttpAuthResult`, `validateHttpAuth`, `HttpMcpServerHandle` and the Streamable HTTP server itself — now lives in `src/mcp/http.ts`, and `src/mcp.ts` drops from 2,348 to 2,024 lines (−324, including the four imports only that block used: `node:http`, `randomUUID`, `StreamableHTTPServerTransport` and `isLoopbackHost`). The dependency is one-way by construction: `http.ts` imports `createServer` and `SUPPORTED_MCP_PROTOCOL_VERSIONS` from `../mcp.ts`, and `mcp.ts` never imports back — no cycle, and no re-export shim. Its importers moved with it: the CLI's dynamic import in `src/cli/ecosystem.ts`, `test/mcp_http_transport.test.ts` and `test/mcp_auth.test.ts`. Nothing else changed: the moved text is byte-identical to the pre-move block (verified by diff), so auth results, status codes, `www-authenticate`/CORS/`mcp-protocol-version` headers, SSE and JSON bodies, port binding and shutdown all behave exactly as before. Verified by the same 21 transport/auth tests (7 T-150/T-151 + 14 T-386) passing identically before and after the move, plus `bun test`, `bunx tsc --noEmit`, `bun run build`, `cli:check`, `claims:check`, `changelog:check` and `docs:check`.

### Fixed
- **The copy button's confirmation was silent to screen readers (issue #461)**: the install button carries `aria-label="Copy the install command"`, and `motion.ts` reported success by swapping the visible `[data-copy-label]` text to `Copied` / `Press ⌘C` — but `aria-label` wins the accessible name computation, so the swap changed nothing that assistive tech announces, and no live region existed. The button keeps its stable name and now also carries `<span class="sr-only" role="status" aria-live="polite" data-copy-status>`, which the copy handler writes the same text into (cleared first so a repeat click re-announces, then blanked after 4s). The visible feedback is unchanged. Verified in the built `dist/index.html`: the live region is present inside the button, the `aria-label` is unchanged, and the emitted runtime writes to `[data-copy-status]`.
- **Two `/compare` nav links pointed at anchors that do not exist (issue #462)**: the header linked `/#how-it-works` and `/#capabilities`, and no element on the site carries either id — both dead links landed on the homepage top. They now point at the sections that actually cover those labels, `/#architecture` ("How it works") and `/#surface` ("Capabilities"), matching the default nav's vocabulary. Verified against the built HTML: every `href="/musememory/#…"` on all six pages resolves to an id in `dist/index.html`, and no nav href mentions either retired anchor.
- **`/agents` and `/playground` were orphan pages (issue #463)**: both routes built but were absent from `public/sitemap.xml` and linked from nowhere, so a crawler could only reach them by guessing and a visitor could not reach them at all. Both are now in the sitemap with absolute URLs (`https://harshsinghmp.github.io/musememory/agents` and `…/playground`), and both are linked from the footer's Product column — "Agent demos" and "Playground" — which every page renders. Neither page sets `noindex`; both keep the default `index, follow` directive. Verified in the built output: both directories exist, the footer on all six pages carries both hrefs, and the sitemap lists five absolute URLs.
- **The demo reel shifted the page as it loaded (issue #464)**: the `<video>` in the demo section had no intrinsic size and the stylesheet only set `inline-size: 100%`, so its box collapsed until metadata arrived and everything below it jumped. The element now carries `width="1280" height="720"` and `.reel video` declares `block-size: auto; aspect-ratio: 16 / 9`, reserving the box before the first byte of the mp4 lands. `ffprobe` is not a dependency of this repo, so the dimensions come from the poster frame (`showreel-poster.png`, a 1280×720 PNG rendered from the same reel) rather than the mp4's own header. Verified in `dist/index.html`: the video element emits both attributes, and the declared `aspect-ratio` matches 1280:720.
- **The site shipped with no content security policy (issue #465)**: `Base.astro` emitted no CSP and GitHub Pages cannot send response headers, so every page was served with the browser default and nothing constrained script, style or network origins. The layout now emits `<meta http-equiv="Content-Security-Policy">` as the first child of `<head>` — `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'` — plus `<meta name="referrer" content="strict-origin-when-cross-origin">`. `'unsafe-inline'` covers the inlined motion runtime, the JSON-LD blocks, the agents tab script and Astro's style attributes; `'wasm-unsafe-eval'` is what lets the playground compile its sql.js module. No third-party origin is allowed because none is left: Inter is self-hosted from `public/fonts/`, and a grep of the site source for `googleapis`, `gstatic` and inline `<script src>`/`<link href="http…">` returns nothing. `frame-ancestors` is deliberately absent — it is ignored in a meta-delivered policy. Verified in the build: `grep -c 'Content-Security-Policy' dist/index.html` is 1 on all six pages, and the referrer meta is emitted once.
- **The delivery gate failed any CI run that reached it after the PR merged**: `check-landed --pr` answered "is this reviewable?" with `pr.state === "OPEN"`, so a run still in flight when the PR merged ended with `✗ pull request: #N is MERGED` and a red job, even though its tests passed and nothing could be acted on. Across the last 40 runs this was **19 of 19 CI failures** — every recent branch, none of them a test failure. A terminal state is now a skip with an explicit reason (`already merged` / `closed without merging`) and the check rollup is no longer read afterwards; open PRs behave exactly as before, and unknown states still fail rather than guess. The decision lives in `scripts/lib/pull-request.ts` with a unit test, and the integration-branch gate is untouched — it is still what proves a commit actually landed. Verified against a real merged PR: `--pr --branch dev` now reports `? pull request: #477 is MERGED … already merged` and `RESULT: REVIEWABLE`.
- **`muse_sync_pool` read and wrote any directory the model named (issue #455)**: `syncWithSharedPool` resolved `pool_dir` with `resolveExternal` — "normalize, don't confine" — then `readdirSync` + `JSON.parse` + `ingestKnowledge` every `*.json` it found and wrote `packet_<agent>.json` back into the same directory, so a tool argument decided which filesystem was enumerated, which files became memories, and which existing file was overwritten. The pool root is now operator-owned: `MUSE_SYNC_POOL_DIR`, defaulting to `<memory_dir>/sync/pool`. A caller-supplied `pool_dir` may only narrow that root — it is resolved, then confined with the shared `resolveWithin` rule (or accepted when it equals the root) and otherwise throws before a single byte is read, written or created; an operator root that resolves inside the memory store is still refused, since the pool would be re-ingested as memories. Broadcasts now land in a dedicated `<pool>/packets/` directory created `0o700` and are opened with the `wx` flag, so an existing packet is never clobbered: the report carries `packets_dir` and `broadcast_skipped: true`, and the CLI prints "skipped" instead of a packet id. Verified by tests that a `pool_dir` outside the configured root is rejected with nothing created anywhere, that a nested one inside the root works, that a second broadcast from the same agent leaves the first packet byte-identical and reports skipped, and that both the root and the `packets/` directory are mode `0o700`.
- **Gossip ingest trusted the sender identity a packet asserted (issue #456)**: `ingestKnowledge` never consulted the attestation layer, took `sender_id` at face value, and wrote any same-id entry whose `updated_at` was newer with a plain `save()` — so a prompt-injected agent, or any packet dropped into a shared pool, could rewrite a confirmed memory's content and forge its provenance. A packet that carries an `attestation` (single record or chain) is now verified over the packet body with the attestation detached, against an operator trust anchor — `MUSE_ATTESTATION_PUBLIC_KEY` as inline PEM, or `<memory_dir>/sync/attestation.pub`, the file `memory attest keygen` writes — and a forged, malformed, or unverifiable attestation rejects the whole packet before any write, with the reason in `result.errors`. An unattested packet from a sender absent from `sync/peers.json` may no longer overwrite a `confirmed` memory: the stored content stands, the incoming copy is preserved under `<id>__conflict_<sender>` as a `candidate`, and an `untrusted_overwrite` conflict row is recorded through the same `flagConflict` path the concurrent-write branch already uses, incrementing `conflict_count`. Known peers and attested packets keep the existing newer-wins behaviour. Verified by tests that a packet signed by an untrusted key is rejected and leaves the store empty, that an attestation with no trust anchor configured is refused, that an unknown sender's newer unattested copy leaves the confirmed content untouched with `conflict_count` 1, and that both an attested packet from the trusted key and a known peer still update the memory.
- **The FTS failure log echoed the raw search query (issue #457)**: `searchMemoriesFts` logged ``for "${query}"`` on its degraded path, so any query that made FTS5 throw wrote its text — a credential included — into terminal scrollback and captured logs, and a `\r\n` or ANSI sequence in the query could forge further log lines. The echoed query now passes through `redactSecrets`, has control characters stripped and is capped at 200 characters, and the error message is redacted on the same path. Verified by a test that a throwing query carrying a token-shaped string logs `[REDACTED_SECRET]` and never the token, contains no CR or ANSI byte, and still returns `degraded: true` with a non-empty error for the caller.

## [3.4.4] - 2026-11-24

**Full Changelog**: https://github.com/harshsinghmp/musememory/compare/v3.4.3...v3.4.4

### Changed
- **The MCP tool catalog left `createServer()` (issue #444, slice 1)**: `src/mcp.ts` opened `createServer()` with a 1,771-line `const allTools = [ … ]` literal — 126 `{ name, description, inputSchema }` objects — so the protocol surface and the 132-case dispatch `switch` shared one 4,119-line file. The literal now lives in `src/mcp/catalog.ts` as `MCP_TOOL_CATALOG: Tool[]`, imported and served unchanged by the `ListTools` handler, and `src/mcp.ts` drops to 2,348 lines (−1,771). It is typed `Tool[]` rather than `as const` on purpose: the literal used to be contextually typed by the SDK's `ListToolsResult`, whose `inputSchema.type` must be the literal `"object"` — a bare array literal would widen it to `string` and stop satisfying the SDK. `memory_core` advertises `CORE_TIERS`, so the catalog imports it from `src/core.ts` (no cycle). Three source scanners followed the move: `scripts/generate-cli-reference.ts` scans `MCP_TOOL_CATALOG` in `src/mcp/catalog.ts` instead of slicing the `ListTools` handler, and `scripts/generate-claims.ts` / `test/marketing_claims.test.ts` point `registeredMcpTools()` and `registeredToolNames()` at the new file. The dispatch `switch`, transport and auth are untouched. Verified byte-identically at the protocol level: the `tools/list` payload returned by an in-memory MCP client against `origin/dev` and against this branch hashes to the same SHA-256 (`45730ea4…`), 126 tools in the same order, first `memory_read`, last `muse_attestation_verify`, and `docs/cli-reference.md` regenerates byte-identical; `bun test`, `tsc --noEmit`, `build`, `cli:check`, `claims:check`, `changelog:check` and `docs:check` are green.
- **Scoring no longer clones the cache on every read**: `list()` hands out copies (the #409 contract), but the ranking path only reads — and re-cloning gave every entry a new object identity on every query, so the per-entry token/symbol/path WeakMaps missed and the whole store was re-tokenized. The scorer now reads through a non-cloning `getQueryRefs` and copies only the selected results before they leave `queryContext`, so public callers still cannot poison the cache. Measured on 2,000 entries: unrestricted `queryContext` **43.8 → 17.8ms (−59%)** and **71.7 → 17.8ms (−75%)** against the pre-cache-fix baseline; project-filtered **18.1 → 9.0ms**, type-filtered **10.2 → 7.4ms**. `queryContext` now matches the FTS path's ~17.6ms while still scoring every entry.
- **The read cache no longer invalidates itself on every ranked query**: the list cache keyed its write generation on SQLite's `total_changes()`, which also counts the access-telemetry `UPDATE` that `queryContext` issues for its top results. Each query therefore invalidated the cache it had just filled, and the next one re-read and re-parsed every row. Generation now moves on **content** writes only — from inside `insertOrReplaceMemory`, the single write choke point, so a direct insert outside `save()` still invalidates — and an access overlay keeps `list()` reflecting `access_count`/`last_accessed_at` immediately instead of re-reading the store. This does not weaken external-write detection: `total_changes()` is per-connection, so another process never moved it either, and the directory-mtime guard still covers YAML drops. Measured on a 2,000-entry store: unrestricted `queryContext` **71.7ms → 43.8ms (−39%)**, project-filtered **35.5 → 18.1ms (−49%)**, type-filtered **26.1 → 10.2ms (−61%)**; `rankAndRetrieveMemories` unchanged at ~17.7ms. `bun test` 1681 pass / 0 fail, `tsc` clean, and both contracts the change touches still hold — T-020's stale-mtime reconciliation and the test that a read-only `list()` observes the increment a query just recorded.

### Fixed
- **Wikilink expansion served memories its own gates hid (issue #436)**: `expandFusedWikilinks` carried a dead guard — `if (!includeSuperseded && (status === "superseded" || valid_to)) { if (status === "superseded") continue; }` — so the `valid_to` half could never change the outcome and `expired` was never consulted at all: an expired memory linked with `[[Target]]` came back in `expanded_wikilinks` and was printed in full by the same `get_context` call whose primary path had just counted it in `hidden_count`. Expanded targets now pass the same lifecycle gates the primary path applies, driven by the same `include*` options: `superseded`/`rejected` unless `includeSuperseded`, `conflicted` unless `includeConflicted`, `archived` unless `includeArchived`, and `isExpired(entry, Date.now())` unless `includeExpired`. `valid_to` is deliberately **not** an expiry rule — it is valid-time, not expiry (issue #441). Verified by tests that an expired target disappears from `expanded_wikilinks` and from the rendered markdown while `hidden_count` stays ≥ 1, that a superseded target is withheld until `includeSuperseded: true`, and that a live target still expands; the expired test fails on the old guard.
- **The L1 context cache served stale USER.md/CORE.md/CURRENT.md (issue #437)**: `formatPromptContext` keyed its 30-second cache on the query and options only, while the cached markdown embeds `getUserProfile` (USER.md), `formatCoreBlock` (CORE.md) and the constraints/handoff from CURRENT.md — and writers such as `memory_set_user_profile` and `memory_core` never invalidate `store.cache`, so a second `get_context` inside the TTL returned the old profile with `fromCache: true, stale: false`. The key now carries an `mtimeMs`+`size` fingerprint of those three files (a missing file is a constant; the contents are never read), computed only when `memoryDir` is provided, and the entry is filed under the fingerprint taken *after* the call because `syncConstraints` rewrites CURRENT.md on a miss. Verified by tests that rewriting USER.md between two calls misses the cache, returns `fromCache: false` and carries the new marker, and that an unchanged second call still returns `fromCache: true`; the rewrite test fails when the fingerprint is stubbed out.
- **Mesh discovery read every sibling project's memories without consent (issue #452)**: `discoverWorkspaceMesh` adopted every sibling directory carrying `.git`, `package.json` or `.memory` as a mesh node, and `resolveMeshMemories` returned each node's full entries — content included — so a single `muse_mesh_query` in `~/projects/<clientA>` returned `~/projects/<clientB>`'s memory store, with no consent anywhere in the chain. Sibling auto-discovery is now opt-in behind `MUSE_MESH_AUTO_DISCOVER=1` (default off, with no settings key to fall back to: `src/settings` has none for mesh), while explicit `mesh_links.json` links keep working exactly as before and query semantics for linked stores are untouched. `muse_mesh_link` now mirrors `memory_delete`: without `confirm: true` it returns a tool error naming the flag and writes nothing, and every applied link change records an audit event carrying the resolved path and actor (`mcp`). Verified by tests that two siblings each holding a `.memory` store yield only the workspace node without the flag, that the sibling is discovered with `MUSE_MESH_AUTO_DISCOVER=1`, that an explicit link still admits it without the flag, that a link call without `confirm` is rejected and leaves no `mesh_links.json`, and that `confirm: true` stores the link with a matching `link` audit entry (path and actor asserted).
- **`POST /publish` let an event type forge SSE frames (issue #439)**: `src/daemon.ts` interpolated the caller-supplied `type` straight into the `event: ${type}\n` header with validation only that it was a non-empty string, so a type containing `\n\n` closed the legitimate frame and opened an attacker-authored one for every subscriber. `type` must now match `^[A-Za-z0-9._-]{1,64}$` before `broadcast`; anything else is answered with **400** and a short error, and nothing reaches the wire. The rest of the handler — origin check, JSON body parsing, request-size cap, delivered count — is unchanged. Verified by a test that publishes a newline-bearing type (plus its CRLF and 65-character variants) to a subscribed client, asserts 400 for each and that the only frame received is the `hello` greeting with no forged `event:` line, while a dotted name such as `memory.changed` still returns 200.
- **An over-length constraint was stored before the tool reported failure (loose thread from #433)**: `memory_capture`/`propose` wrote the memory first and only then called `setCurrent()`, which throws for a constraint longer than `MAX_CONSTRAINT_CHARS` — so the tool answered with an error for a capture that had already succeeded, leaving an orphaned constraint entry in the store and nothing in CURRENT.md. The post-sanitisation, trimmed length is now measured before `propose` and refused through the shared `constraintLengthError()` (extracted from `setCurrent`, so the wording cannot drift between the two paths); the existing `setCurrent` try/catch stays as a backstop but is no longer reachable for length. Verified by a test that an over-cap constraint proposal returns the error and leaves no entry with that content or title in the store, and that a 300-character proposal succeeds and appears in CURRENT.md.
- **Every MCP request carrying `dir` leaked a Store and its file descriptors (issue #432)**: `resolveStoreForRequest` called `openStore(resolved.memoryDir)` per request and nothing ever closed the result — two descriptors per call (the SQLite handle plus its WAL). At the fd limit `openDatabase` throws `EMFILE`, which `openStore` swallowed, leaving `db` undefined; every tool then answered from the YAML mirror while reporting success. Stores are now cached by memory directory through a new `getCachedStore(memoryDir)`, used both for the per-request `dir` path and for the server's own store, so one directory maps to one Store, one cache and one circuit breaker; the provider/circuit wiring is untouched. The degraded fallback itself is unchanged but no longer silent: a failed SQLite open logs a `console.error` once per database path saying the store is running in degraded YAML-only mode and why. Verified by tests that the same directory returns the identical Store instance, that 50 lookups add no descriptors (0 on `/proc/self/fd`, 100 with the cache removed), that different directories get different stores, and that a database path SQLite cannot open logs exactly once with the path and reason.
- **An imported `expired` memory was resurrected as a live candidate (issue #442)**: `VALID_MEMORY_STATUSES` in `src/migrator/types.ts` hand-listed 11 of the 12 `MemoryStatus` members and `"expired"` was the one missing, so `normalizeMemoryStatus("expired")` fell through to `"candidate"` and a migration brought an expired memory back as a live candidate. The values are now declared once as `MEMORY_STATUS_VALUES` with `as const satisfies readonly MemoryStatus[]` and fed to the `Set`, so a typo or a removed member fails the build. Verified by a status table covering every union member — with the two deliberate pre-existing aliases (`active` → `confirmed`, `archived` → `superseded`) spelled out — plus an explicit `normalizeMemoryStatus("expired") === "expired"` round-trip; the exhaustive `Record<MemoryStatus, true>` in that test makes a new union member a compile error until it is covered.
- **Code-context recall applied its own expiry rule (issue #441)**: `src/retrieval/code_context.ts` carried a private `isExpired` that expired on a past `valid_to` or a past `expires_at` and never looked at `status`, while the canonical `src/retrieval.ts` expires on `status === "expired"` or a past `expires_at` — so the two disagreed on 2 of 3 shapes and code-context recall served a memory every other read path treats as expired, while withholding confirmed memories whose historical valid-time window had closed. `code_context.ts` now imports the canonical helper (no cycle: `retrieval.ts` does not import this module) and its private copy is gone. `valid_to` stays out of the rule — it is valid-time, not expiry. Verified by a shared three-shape table asserting the retrieval helper and the code-context path agree, which fails on both divergent shapes when the old predicate is restored.
- **Seven advisories in the MCP SDK and js-yaml, including four high (issue #454)**: the direct pins were `@modelcontextprotocol/sdk@1.30.0` and `js-yaml@4.3.1`, and `bun audit` carried high-severity findings on both — the Streamable HTTP transport did not limit request bodies (`>=1.10.0 <1.30.1`), a single request could exhaust server memory and tasks were not bound to the session that created them (`>=1.3.0 <1.32.0`), the OAuth client sent credentials to a server-chosen authorization server (`>=1.12.0 <1.31.0`), bearer auth accepted tokens minted for another server and the HTTP client followed cross-origin redirects (both `<1.32.0`), and `js-yaml`'s `maxTotalMergeKeys` did not bound CPU for empty merge sources (`>=4.0.0 <4.3.2`) — reachable through any caller that parses user-supplied YAML. Bumped to `^1.32.0` (resolved 1.32.2) and `^4.3.2` (resolved 4.3.2); the SDK ships no CHANGELOG in its tarball, and the `Server`, `StreamableHTTPServerTransport` and `CallToolRequestSchema` call sites in `src/mcp.ts` are unchanged between the two versions, so the bump needed no code change — `tsc --noEmit` and the MCP transport tests pass as-is. `bun update @hono/node-server undici qs proxy-addr` (all transitive, all in-range) cleared the website workspace's advisories too: `@hono/node-server` 2.1.1 → 2.1.11, `undici` 8.11.2 → 8.13.1, `qs` 6.15.3 → 6.17.1, `proxy-addr` 2.0.7 → 2.0.8, which retires the critical `proxy-addr` IP-spoofing advisory and four high `undici` ones. `bun audit` goes from 49 findings (1 critical, 16 high) to 27 (0 critical, 7 high), and no direct dependency carries a high or critical advisory; the remaining seven highs are pre-existing transitives outside this scope (`body-parser` via the SDK's express, five in `fast-uri` via `ajv`, and the `zod@3.25.76` copy pinned by `chromium-bidi`). Verified by a full `bun test` (1666 tests, 0 failures), `tsc --noEmit`, both builds and the claims/docs/cli/changelog gates.
- **`memory_freeze_run` read any file path it was given (issue #451)**: `freezeExecutionSnapshot` probed `existsSync(task)` and, when the string happened to name a file, replaced the task with `readFileSync(task)` — turning the documented "task description" parameter into an arbitrary file read. `{"task": "/etc/passwd"}` stored the passwd contents in `.memory/runs/<run-id>/snapshot.json`, and `memory_freeze_list`/`freeze show` returned them to any caller. `task` is now opaque instruction text recorded exactly as given; a file-backed brief is an explicit `task_file` option that resolves through `resolveWithin(workspaceRoot, …)` (plus a realpath containment re-check, because that helper is lexical and a symlink would otherwise escape), reads at most 64 KiB, and passes the content through `redactSecrets` before it enters the snapshot, recording `task_file`, `task_file_truncated` and `task_file_redacted` in `metadata`. Verified by tests that `/etc/passwd` and an in-root path are stored literally, that traversal, absolute paths, symlinks out of the root and missing files are rejected, that a secret inside the brief lands as `[REDACTED_SECRET]`, and that a 70 KiB brief is cut to 64 KiB; the old "task is a path" test is gone and `memory freeze --task` no longer advertises a file path.
- **The HTTP MCP transport failed open on non-loopback binds (issue #453)**: `validateHttpAuth` required a token only when one was already configured (`options.requireAuth || validTokens.size > 0`), so `musememory mcp --host 0.0.0.0` served every tool — including `memory_delete` and `memory_export` — to anyone who could reach the port, and `--allowed-hosts` was the only thing that could stop a DNS-rebinding page. Three layers now fail closed: the CLI refuses a non-loopback bind with no `--token`/`--tokens`/`MUSE_BEARER_TOKEN`/`MUSE_AUTH_TOKENS` and exits 2 before any socket opens (a new `--insecure` opt-out prints a conspicuous every-tool-is-reachable-anonymously warning), the Host allowlist is derived from the bind host plus loopback unless `--allowed-hosts` is passed so DNS-rebinding validation is on by default, and the transport requires authentication whenever its `bindHost` is not loopback even for programmatic callers. Loopback binds still need no token, so local MCP clients are unaffected. Verified by CLI tests that a `0.0.0.0` bind exits 2 and never listens, `--insecure` starts, warns and still rejects a forged Host, `--token` starts and answers an anonymous request with 401, and a loopback bind still serves anonymously, plus `validateHttpAuth` unit and integration tests.
- **CI gated on wall-clock latency and never applied its own timeout**: `gradeRecallSet` folded `latency.p50 <= p50Budget` into `passed`, so the suite failed on runner speed rather than on retrieval quality — `test/recall-eval.test.ts` died at `p95 = 83.32ms` against a 60ms budget, an earlier dense-graph test on `elapsed < 50ms`, and `test/landing_gate.test.ts` timed out at 5027ms under Bun's 5s default. `passed` is now the quality gate alone (recall floor and distractor tolerance), p50/p95/p99 are still **reported** beside the recall scores per T-142, and the test keeps one catastrophic ceiling (`p99 < 2000ms`) that only catches an order-of-magnitude regression; the now-unused `p50BudgetMs` option is gone while `P50_BUDGET_MS`/`P95_BUDGET_MS`/`P99_BUDGET_MS` stay as reference budgets. `bunfig.toml` has no `timeout` key in Bun — only the `--timeout` CLI flag — so the 20s stall guard it promised never existed; `bun test --timeout 20000` is now what CI, the publish workflow and the `test` script actually run, proven with a 7-second test that fails at the 5s default and passes with the flag. The `Tests-… Passed` README badge said 1444 against a suite of 1645 and now says 1645.
- **The website referenced two CSS tokens that do not exist (issue #458)**: `agents.astro` and `playground.astro` used `var(--accent)` and `var(--text-dim)`, but the design tokens are `--accent-primary` and `--text-tertiary`. An undefined custom property makes the declaration invalid at computed-value time, so the active agent tab rendered `#1a1206` on `#07090f` — a 1.07:1 contrast ratio, effectively invisible — and its focus ring disappeared; the playground labels and table headers lost their colour the same way. All nine usages now resolve to real tokens and the site builds clean.
- **Pages deploys raced the artifact upload (issue #466)**: `deploy-pages` queried the run milliseconds after `upload-pages-artifact` finalized and intermittently found zero artifacts — three of five runs on 2026-11-23 — failing the deploy for reasons unrelated to the site. Re-running the job made it worse by uploading a second artifact with the same name. A bounded visibility gate now polls the run's artifact list until exactly one `github-pages` artifact exists (and fails loudly on duplicates, telling the operator to dispatch a fresh run), with `actions: read` added to the workflow permissions.
- **The generated CLI reference had no drift gate**: `docs/cli-reference.md` is derived from `src/` and advertised as "generated, never hand-edited", but nothing checked it — `claims:check` validated `claims.json` and `mcp-tool-matrix.json` only. A stale reference tells an agent to call tools that do not exist, which is exactly how the README table rotted. The generator now supports `--check` (byte-exact against the committed file), `bun run cli:check` exposes it, and CI fails on drift; proven by appending a line and watching the gate exit 1.
- **Published numbers drifted and two badges had no source of truth**: `claims.json` shipped `assertions: 7799` while the suite makes 7797, because `--check` compared only the test count and file count — so the gate reported "up to date" against a number it never read. The assertion count is now gated with the same over-claim rule as the test count, and the manifest is regenerated (7797). `README.md` advertised `Bun v1.4.0 (Latest)` against a CI that runs `latest`, and a `Node.js ≥18` floor the package never declared; the Bun badge now says `latest`, `package.json` declares `engines.node >= 18` so the floor is enforceable, and the TypeScript badge matches the `^5.6.0` devDependency. Two agent-context documents still quoted 1624/257 and 1620 tests and now match 1645/259. `prepublishOnly` also runs the suite with the 20s timeout, so a local `npm publish` cannot hit the same flake that blocked the v3.4.3 tag.
- **A read path deleted long CURRENT.md constraints (issue #433)**: `isValidConstraintLine` rejected any line over 300 characters and `syncConstraints` uses that predicate to rebuild CURRENT.md, so a constraint `setCurrent` had just accepted was silently deleted on the next `formatPromptContext` — while `memory_current` still returned it in `updated_constraints`, including the line it had just removed. The cap now lives on the write path only (`MAX_CONSTRAINT_CHARS = 300`, measured after `stripInjectedContextBlocks` and trimming, refused with an `Error` naming both the limit and the actual length), and the read predicate keeps only its minimum-length and garbage/transcript filters, so no existing line is dropped for being long. Every `setCurrent` caller surfaces the refusal instead of crashing: `memory_current`/`memory_set_constraints` return a tool error, `POST /api/current` answers 400 with the message, `memory current set` prints it and exits non-zero, and the migrator skips the one over-long line into `report.errors` instead of aborting the provider batch. Verified by tests that 301 characters throws with `300` in the message, that a 320-character line already on disk survives a `syncConstraints` pass unchanged, and that 300 characters is accepted and kept.
- **`restoreEntry` reported success but left the memory unsearchable (issue #434)**: the tombstone was cleared *after* `save()`, and `insertOrReplaceMemory` returns early while the row is still tombstoned, so the INSERT and its FTS sync never ran — `deleteEntry` had already removed the FTS row, so a "restored" memory stayed absent from `memories_fts` for good while the call returned `ok: true`. The marker is now cleared first inside the same transaction, letting `INSERT OR REPLACE` recreate the row and re-index it; a `save()` failure still rolls the clear back through `withTransaction`, and the cache invalidation and `restore` audit event are unchanged. Verified by a create → `deleteEntry` → `restoreEntry` roundtrip that `searchMemories` finds the memory again with zero FTS parity gaps, and a live id still returning `not_deleted`.
- **Tree-index search served erased and superseded memories (issue #435)**: the tree branch mapped nodes straight into results with `status: (sn.node.status as any) ?? "active"` and no live-row check, but the persisted index is a stale projection by design (`deleteEntry` does not rewrite it), so a GDPR-erased memory was still served — and with a synthetic `node_…` id that `memory_read` could not resolve. Each hit is now resolved against the live store via `getMemoryById`, dropped when the row is gone or tombstoned, and gated exactly like `queryContext` (superseded/rejected, `conflicted`, `archived` and expired unless the matching `include*` option is set), returning the live entry so ids, status, trust and validity are real. Verified by tests that a deleted memory disappears from `mode: "tree"`, that a superseded one is withheld unless `includeSuperseded: true`, and that a live hit's `entry.id` is the memory id with its real status.
- **The comparison table could not be read without a mouse (issue #459)**: `.table-wrap` scrolled with `overflow-x: auto` and `.compare` carried a hard `min-width: 760px`, but the wrapper was a bare `<div>` — no tab stop, no role, no name — so below 768px a keyboard-only user could tab the whole page and never reach the three right-hand columns (axe `scrollable-region-focusable`, WCAG 2.1.1). Both wrappers (`compare.astro`, `index.astro`) are now `role="group"` with an `aria-label` and `tabindex="0"`, inheriting the audited global `:focus-visible` ring rather than defining or removing one, and a `@media (max-width: 767px)` block drops the 760px floor and tightens the cells so phones get a table that wraps on screen instead of a scroll trap; the 768px-and-up layout is untouched.
- **The site fetched Inter from Google Fonts while shipping a local copy (issue #460)**: `Base.astro` emitted two `preconnect`s and a render-blocking `fonts.googleapis.com` stylesheet on every page, while `src/assets/fonts/inter-var.woff2` sat vendored and referenced by nothing — an external request that also contradicted the site's "Nothing is uploaded" claim — and the `"Inter"`-first stack had no metric-compatible fallback, so the swap reflowed text. The subset is now served from `public/fonts/inter-var.woff2` at the site base (`/musememory/fonts/inter-var.woff2`), `global.css` declares it with `font-display: swap` beside an `Inter-Fallback` face built on `local("Arial")` with `size-adjust: 107.4%`, `ascent-override: 90.2%` and `descent-override: 22.48%`, and `--font-sans` reads `"Inter", "Inter-Fallback", system-ui, …`. The `preconnect`s and the stylesheet are gone, replaced by a `rel="preload"` of the local file. Verified by a clean `site:build` — `dist/fonts/inter-var.woff2` present and referenced from the built HTML, six pages, and `grep -r "fonts.googleapis.com\|fonts.gstatic.com" apps/website/dist` returning nothing.

## [3.4.3] - 2026-11-23

**Full Changelog**: https://github.com/harshsinghmp/musememory/compare/v3.4.2...v3.4.3

### Added
- **Discriminating coverage for seven shipped fixes (issues #139, #179, #155, #157, #161, #165, #191)**: each of these behaviours had shipped with a test that passed whether or not the fix was present, so each now has one that fails when the behaviour is removed — migrator quarantine at the store boundary (a `runMigration` end-to-end run that must store `candidate`/`unverified`), `optimization_meta.json` activity stamping after `save()`, the daemon's per-event debounce and rename re-arm on real fs events, `upgrade --check` and `--fail-on-update`/`--strict` exit codes, ADR save-before-supersede atomicity when the save fails, `memory ui` port validation and SIGINT teardown, and the plasticity `MAX_GRAPH_NODES` prune, no-change write skip and retrieval-side associative expansion. **Tests only — no behaviour change.**

### Fixed
- **Wikilink expansion bypassed the tombstone gate (issue #408)**: the `expandFusedWikilinks` fallback resolved a target with `SELECT data FROM memories WHERE id = ? OR title = ?` — no `deleted_at` predicate and no row mapper — so a GDPR-erased memory was lifted straight out of its `data` blob and emitted into prompt context. It now selects the full row, filters `(deleted_at IS NULL OR deleted_at = '')` and maps through `rowToMemoryEntry` like every other read path, keeping the defensive `try/catch` so a bad row cannot break expansion. Verified by a test that erases a memory with `deleteEntry(...)` and asserts `queryContext(..., { expand_wikilinks: true })` never surfaces it; it fails on the unfixed fallback.
- **`getQuery` handed out the cache's own array (issue #409)**: unlike `getEntry`, it returned `item.value` by reference, so a caller mutating one entry in place poisoned every later cached `list()` with state that was never persisted. It now returns shallow copies of each entry, matching `getEntry`'s contract. Verified by a test that mutates a returned entry's `status` and asserts the next read still shows the stored value.
- **Two audit nitpicks in the read-path and write-path code (issue #410)**: `searchMemories()` copied `degraded` and `error` onto its tombstone-filtered hits but dropped `hidden_count`, so a filtered page claimed nothing had been hidden; the count is now carried through. `insertOrReplaceMemory`'s `no column named` catch retried with a "legacy" INSERT that still listed `mem_path`, `last_accessed_at` and `access_count` — the exact columns absent on the databases the fallback existed for — so it could never succeed and only masked the real error; the fallback is deleted and the original error propagates. Verified by tests asserting the filtered `hidden_count` matches `searchMemoriesFts` and that a deliberately broken table shape surfaces the real missing-column error.
- **Migrated records kept unearned verification levels (issue #141)**: `validateMigratedRecord` stripped only `independently-verified` without a `test_result`, so an import could assert `observed`, `reproducible`, `user-confirmed` or `authoritative` and collect that level's ranking bonus (`VERIFICATION_BONUS`, up to +0.12) on nothing but its own say-so. Verification is now dropped entirely for every level above `unverified` unless a real `test_result` backs it; a bare `unverified` attestation is kept because it earns nothing. Verified by a test that walks the five elevated levels, asserts the landed record has no verification and therefore zero bonus, and that a `test_result`-backed claim keeps its level.
- **Provider status promoted records without `isLatest` (issue #151)**: the agentmemory adapter gave `item.status` precedence over `isLatest`, so `status: "confirmed"` imported as confirmed even when `isLatest` was absent or false — letting a provider promote its own records into the confirmed tier by assertion. A provider-supplied status may now narrow but never promote: `confirmed` without an explicit `isLatest === true` is downgraded to `candidate`, while `superseded`/`stale` and `isLatest: true` behave exactly as before. Verified by a test covering `{status: "confirmed"}` → `candidate`, `{status: "confirmed", isLatest: true}` → `confirmed` and `{isLatest: false}` → `superseded`.
- **Pinned memories were still suppressed on re-injection (issue #259)**: the ticket's contract makes pinned knowledge exempt from re-injection suppression, but `filterSuppressed` exempted only `type: "constraint"` and `temporal_mode: "timeless"` — `pinned` affected expiry alone — so a deliberately pinned memory was withheld for six turns after its first injection. The filter's generic now includes `pinned?: boolean` and `entry.pinned === true` joins the existing two exemptions; the default `exemptTypes` semantics are unchanged. Verified by a test that injects a pinned and an identical unpinned entry on turn 1 and asserts only the unpinned one is suppressed on turn 2.
- **Session end left staged promotions unflushed (issue #257)**: `memory session end` recorded the session end and returned, so promotions staged during the session sat in `pending_promotions.json` until some unrelated later command happened to flush them — the "session-end flush" half of the two-tier promotion contract was missing. `handleSessionCommand` now calls `flushPendingPromotions` after `recordSessionEnd` and reports the promoted/rejected counts; it is a stable no-op when nothing is staged, and a flush failure logs a warning instead of failing the session end, which is already committed. Verified by a CLI-handler test that stages a promotion, ends the session and asserts the entry was promoted and the counts printed.
- **The abstention gate never ran in `queryContext` (issue #199)**: `evaluateAbstentionGate` was implemented and unit-tested but the read path never called it, so a punctuation-only, greeting or stopword-only query still paid for a full candidate scan, every filter, scoring and access recording. The gate now runs at the top of `queryContext` and returns an empty `no_confident_match` result immediately; an empty or whitespace-only query is deliberately **not** gated, because it means "no query filter" and is what `formatPromptContext(store, dir, "")` relies on to return the general context pack. Verified by tests asserting `"!!!"` returns zero results with access counts unchanged, `""` still returns the pack, and a normal query still scores.

## [3.4.2] - 2026-11-14

**Full Changelog**: https://github.com/harshsinghmp/musememory/compare/v3.4.1...v3.4.2

### Fixed
- **`list()` resurrected erased memories and corrupted ranking (issues #406, #407)**: reconciliation derived the memory id from the YAML filename, but files are stored as a slug of the id — so for any id that is not already slug-clean the two differ. The row looked "new", the tombstone gate was bypassed, and the entry was written back without `deleted_at`, bringing a GDPR-erased memory back and duplicating it in every `list()`. The same loop also read through `get()`, which increments `access_count`: a single filtered `list()` issued 118 writes and inflated the counter on entries that were never retrieved, steering the ranking. Reconciliation now uses the unfiltered id set and a non-counting read, and the write path refuses to clear an existing tombstone.
- **Idempotency key could delete a tombstoned memory (audit F1)**: SQLite's `INSERT OR REPLACE` resolves a UNIQUE conflict by **deleting the conflicting row**. With the unique index on `idempotency_key`, an unrelated write reusing a key erased the row holding it — including a GDPR tombstone, which then vanished from the store entirely and defeated the "propose cannot resurrect a tombstone" guard. The colliding key is now released from other rows first.
- **`as_of` disabled every lifecycle gate (audit F2)**: the superseded/conflicted/archived/expired filters were nested under `if (options.as_of === undefined)`, so any historical query re-admitted **known-contradictory pairs and TTL-expired facts** into prompt-serving reads — violating the T-405 invariant. The gates now always apply, with expiry judged at the queried instant so a memory that has since expired is still retrievable at a time it was valid.
- **A stale YAML mirror reverted newer SQLite state on read (audit F3)**: `readEntry` wrote the mirror back unconditionally, so a failed rename or crash between the DB commit and the mirror write silently rolled authoritative data backwards — and the result depended on whether `get()` or `list()` ran first. The mirror is now rejected only when both its payload timestamp and its file time are older than the row, so a genuine external edit is never dropped under clock skew.
- **Secret scanner missed passwords with punctuation (audit F8)**: the generic credential value class stopped at the first `!`, `$`, `+`, `/` or `@`, so passwords like a typical human-chosen one were not detected at all and were persisted in plaintext by the write gate. The value class now matches any non-whitespace run after an assignment; prose that merely mentions the word does not fire.
- **Showreel demo script called a command that does not exist (D8)**: `assets/showreel/demo-script.sh` invoked `memory brief`; the command is `memory briefing`. Under `set -e` the demo aborted with exit 2 partway through, so a recording take would fail and the cause was easy to miss. Verified the corrected script now runs end-to-end with exit 0 in a scratch directory, and the README records that `set -e` makes a pre-record smoke run mandatory.
- **Changelog gate range bounded by tag date**: a squash-merged release rewrites history, so commits it shipped are not ancestors of the tag and `ref..HEAD` re-flagged work already documented. The gate now judges only commits made after the tag's commit time, which is exactly what the next cycle owes regardless of how many staged sections sit above it.
## [3.4.1] - 2026-11-10

**Full Changelog**: https://github.com/harshsinghmp/musememory/compare/v3.4.0...v3.4.1

### Added
- **Append-only observation merge (R31)**: `mergeObservations` unions peer observation ledgers by `id` under the single-writer store lock, appends each record with fsync, never rewrites an existing observation, and rejects malformed records so the ledger cannot be corrupted. Re-merging a batch is a no-op, which makes retries safe. Memory-level conflicts remain `merge3`'s job; the append-only observation channel was the missing half of R31.

### Changed
- **Pre-flight budget now bounds the whole pack (W26-2 follow-up)**: `--budget` measures the assembled markdown rather than the entry subset, and reports the budget it breached instead of the pack total — `192 tokens (over the 150 budget)` rather than `(over budget: 192 tokens)`, where 192 was the whole pack and the overage was 42.

### Fixed
- **`playbook --run` no longer pretends to execute (D7)**: the flag was a silent alias for `show`, so `memory playbook --run <id>` appeared to run a trajectory and only printed it. It now refuses with exit 2 and says playbooks are advisory. Execution is deliberately unimplemented: steps carry arbitrary shell commands and need a confirmation gate and security review.
- **`associated` contract documented (W26-4)**: the field is graph neighbours, not ranked results — excluded from `results` and **not counted in `totalTokensUsed`**, so callers injecting it must budget separately. Documented on the type rather than fused, since fusion would change ranking behaviour.
- **`muse_playbook_record` declares both mode contracts (D4)**: `anyOf` over `[id, success]` (record an outcome) and `[title, goal, steps]` (save), instead of no `required` at all. A flat `required` would have been wrong for one of the two modes.
- **Concurrent writes during sync are flagged, not clobbered (R31)**: `ingestKnowledge` compared `updated_at` alone, so when two agents edited the same memory after their last sync the later timestamp won and the other edit vanished silently — exactly what the roadmap forbids. Detection now uses the peer's last-sync time to recognise true concurrency, preserves both versions (the incoming copy under a deterministic `__conflict_<sender>` id so re-ingesting is idempotent), and records a `concurrent_write` contradiction for deliberate resolution.


## [3.4.0] - 2026-11-10

**Full Changelog**: https://github.com/harshsinghmp/musememory/compare/v3.3.0...v3.4.0

### Added
- **Flaky test and environment-drift detector (`T-442`)**: `src/doctor/flaky.ts` reconstructs runs from the `test_feedback` ledger and reports flaky tests (fail → pass → fail, analysed per command), failure bursts, and dependency-file changes shortly before a burst. Surfaces: `memory flaky` and `muse_flaky_tests`.
- **Remediation playbook generator (`T-443`)**: `src/cognition/remediation.ts` synthesizes playbook candidates from recurring failures, reusing regression-sentry guidance for steps and verification, and persists resolved candidates only (`--apply`). Surfaces: `memory remediation` and `muse_remediation_playbooks`. Tool count 124 → 126.
- **Test-outcome feedback (`T-440`)**: `src/quality/test_feedback.ts` parses bun, vitest, jest, cargo, pytest and go output and binds a real run to the memories applied during the work. Green runs reinforce every linked memory; red runs record a failed application and a regression strike only for anchor/symbol/reproduction-relevant memories (the T-313 rule). Surfaces: `memory test-feedback` and `memory_test_feedback`.
- **Regression sentry (`T-441`)**: `src/cognition/sentry.ts` matches failing tests against `BUG_PRONE_PATTERN` / `DO_NOT_USE` / failed-approach memories and returns remediation playbooks. Read-only: it never mutates the store or ledger. Surfaces: `memory sentry` and `muse_regression_sentry`. Tool count 122 → 124.
- **`memory io` (R29)**: process read/write counters from `/proc/self/io` plus on-disk SQLite, WAL, audit and observation bytes; `--json` for machines, and a clear "unavailable" line on platforms without procfs.
- **Audit ledger rotation (R29)**: `audit.jsonl` rolls over at 5 MiB into `audit-archive/`, retains five segments by default (`MUSE_AUDIT_MAX_BYTES` / `MUSE_AUDIT_MAX_SEGMENTS`), and records a chain anchor when pruning so `getAuditTrail`, `getLastAuditHash` and `verifyAuditChain` keep working across the retained window.
- **Ten-task outcome study (EVD-008)**: a condition-blind with/without study — both arms told to consult memory, only the seeding varied — measured **10/10 vs 6/10** on convention-sensitive tasks, with four discriminating tasks and no regressions. EVD-005 is no longer quarantined; its statement was narrowed to convention recall rather than an unqualified productivity claim.
- **Read-only MCP surfaces (W27-7)**: `muse_enclave_recall` (explicit client, audit-logged, credential-redacted), `muse_overlay_status` (list/inspect branch overlays, never mutates) and `muse_attestation_verify` (inline public key only). `listBranchOverlays` added; 119 → 122 tools with regenerated claims and CLI reference.
- **Studio recall debugging (R32)**: `POST /api/recall-debug` returns the top-K with the full `ScoreFactors` object, `why_retrieved` labels and token usage, computed by the canonical `rankAndRetrieveMemories`. Reusing the canonical ranker is the point — a second scoring path would let the panel disagree with what recall actually did. Empty queries are rejected rather than scoring the whole store.

### Changed
- **YAML mirror opt-out (R29)**: `openStore({ yamlMirror: false })` or `MUSE_YAML_MIRROR=0` skips the per-entry `memories/*.yaml` second copy. SQLite remains authoritative and reads/list/get are unchanged; the mirror stays the default for export and rollback.
- **Bounded WAL (R29)**: `wal_autocheckpoint = 512` and `journal_size_limit = 64 MiB` cap WAL growth between checkpoints.
- **Enclave vault layout (W27-8)**: each enclave entry is now its own AES-256-GCM file under `<client>/<division>/`, so a write no longer rewrites the whole vault and a corrupt record cannot take siblings down. Legacy single-file vaults remain readable and migrate on the next write; per-entry and per-vault size caps are enforced.
- **Overlay storage caps (W27-9)**: branch overlays fail loud above 1000 entries or 2 MiB.
- **Pre-flight honours the whole budget (W26-2)**: `tokenBudget` now bounds the assembled pack, not just the entry subset. Constraints, `USER.md`, `CORE.md` and the handoff block are appended after the entry search spends its budget, so a pack reported as 47 tokens against a 400 budget actually injected 1,120. The final markdown is measured and the entry allocation shrinks until it fits; mandatory blocks are never dropped, and `markdownTokens` / `withinBudget` report the real figure. When it cannot fit it says so instead of claiming compliance.
- **CI runs on stacked pull requests**: the `pull_request` trigger listed only `main`/`master`/`dev`, so a PR targeting its parent feature branch got no CI at all — it showed "no checks reported" and looked fine to a reviewer. Widened to any base branch.

### Fixed
- **Recursive CTE bounded inside the walk (W26-5)**: `maxNodes` was clamped and passed to SQL, but the `LIMIT` sat only on the outer `SELECT`, so SQLite materialised the whole reachable frontier before projecting. A 3000-node dense graph walked ~11.5k rows and took 269.8ms to return at most 100 nodes — on a path `preflightContext` calls on every file open. Bounded: 9.7ms with identical output.
- **Pre-flight over-budget message**: printed the pack total beside the word "over" — a 192-token pack against a 150 budget read as "over by 192" when the overage was 42. Now names the budget that was breached.

## [3.3.0] - 2026-11-09

**Full Changelog**: https://github.com/harshsinghmp/musememory/compare/v3.2.0...v3.3.0

### Added
- **Outcome pilot and RC blockers**: with/without memory pilot, T-450 ADR-008 tracking boundary, overlay archive prune, workspace-root branch identity, enclave put lock.
- **Evidence and enclave lifecycle**: dogfood retrieval benchmark + evidence ledger, benchmark title-less crash fix, `enclave keys`/`prune`, backup/restore drill and key-lifecycle runbook.
- **Enclave key rotation**: keyring under `.memory/enclave.keys/`, active key id, `memory enclave rotate` with optional lazy re-encryption and audit.
- **Wave 27 multi-tenant memory**: branch-scoped overlays (`memory overlay`, three-way merge with base snapshots), authenticated AES-256-GCM client vaults, domain-separated Ed25519 packet attestations, and a three-way semantic memory merge (`merge3`).
- **Unified file→memory resolver**: pre-flight anchored invariants and PR context now share one project/trust/freshness-aware matcher, ranking and reason tokens.
- **Pre-flight surfaces**: a matcher-scoped `PreToolUse` hook and read-only `muse_preflight` MCP tool expose anchored invariants, blast-radius risk and a token-budgeted pack before edits.
- **Wave 26 associative retrieval**: recursive-CTE associative expansion (`memory recall --associative`), speculative pre-flight context (`memory preflight`) with blast-radius risk scoring, and anchor-matched invariant auto-recall.
- **Episode fidelity and `muse_episodes`**: observation provenance no longer classifies failed test commands as verifications; explicit metadata phases win; recent causal episodes are available over MCP.
- **Studio left rail (`T-451`)**: fixed 76px numbered navigation (`01 OVERVIEW`–`06 ABOUT`), warm-dark palette, Archivo Black + JetBrains Mono, and an About anchor; all prior views remain reachable from a tools group.
- **Dual-scope memory switcher (`T-452`)**: project / global / cross-project-mesh selector with live refetch; global and mesh reads open stores read-only, writes stay project-scoped behind a visible banner.
- **Modular cached studio assets (`T-453`)**: CSS, markup and client JS split into `src/ui_assets.ts`; `/assets/studio.css` and `/assets/studio.js` serve per-encoding strong ETags, gzip, 304 and HEAD; standalone export inlines the same modules.
- **CI Bun fallback**: when GitHub release assets return 504, CI installs Bun from the npm registry instead of failing the job.

- **Wave 24 showcase and DX (`T-423`–`T-426`)**: reproducible terminal-demo script and recording recipe, vendored `sql.js` in-browser SQLite playground, capability-only benchmark matrix with methodology, and an accessible multi-agent demo switcher.
- **Wave 25 cognitive playbooks (`T-427`–`T-431`)**: atomic procedural playbooks (preconditions, steps, verification, rollback, outcomes), per-session episodic causal narratives, bi-temporal belief windows (`asserted_at`), reinforced Ebbinghaus decay, and `memory playbook` / `muse_playbook_*` CLI+MCP surfaces.
- **Studio performance (`T-466`–`T-468`)**: per-scope read projection cache invalidated on writes, hidden-tab rendering pause, and an executable sub-10ms UI benchmark.
- **About, quick start and command deck (`T-463`–`T-465`)**: poster-style About panel with live facts and privacy, copyable onboarding cards for four leading agents, and a filterable CLI palette.
- **Universal agents hub (`T-460`–`T-462`)**: WIRED/UNWIRED/ABSENT discovery, one-click wire/unwire with `.bak` backups and harness opt-in, and a point-any-agent manifest with a copyable MCP snippet.
- **Graph/list toggle (`T-454`)**: instant switch between the canvas graph and a sortable table (title, type, status, project, created) with a 100ms debounced filter and `aria-sort` headers.
- **Kinetic-settling graph (`T-455`)**: the canvas now measures per-step kinetic energy and stops its `requestAnimationFrame` loop once the layout settles (or the panel is hidden), waking on pointer, wheel, timeline, filter, search, tab and view changes; deterministic ring seeding and pointer capture.
- **Terrain token and secret gate (`T-459`)**: terrain maps are redacted at generation and a benchmark proves maps cost under half the raw corpus tokens.
- **Terrain vault UI (`T-458`)**: studio split-pane with the six terrain maps, GEN/MISSING badges, escaped markdown viewer and a REINDEX action with a scanline pass.
- **Workspace terrain maps (`T-457`)**: `memory terrain --workspace [--out]` compiles deterministic `repo.md`, `stack.md`, `habits.md`, `ownership.md`, `packages.md` and `logs.md` for token-efficient agent orientation.
- **Activity heatmap and sessions (`T-456`)**: scope-aware `GET /api/activity` returns 52 weeks of daily mutation counts plus agent session cards; the studio gains an Activity view with a 53x7 heatmap, legend, mutation badge and session log.

### Fixed
- **Site build and scaffolding wiring**: Astro builds through a Node launcher (QA 17/17), `memory briefing` prints causal episodes, `asserted_at` is a caller-settable belief clock used by `as_of`, and the duplicate decay module is removed.
- **Wave 24–25 review hardening**: playbook safety rails survive MCP step-only updates, corrupt stores fail loud and stay byte-identical, id-keyed playbook updates, unique episode ids, goal-first phase classification, epoch-based bi-temporal comparison, CLI `--dir`/`--global`/`--run`, and honest benchmark/playground copy.
- **Agents hub debt sweep**: 5s discovery cache (invalidated on wire/unwire), newest-3 `.bak` retention, memory tool grants removed on unwire, and a 2s mesh freshness bucket.
- **Agents hub and projection cache hardening**: complete XDG-aware timestamped config backups with fail-loud errors, unknown-agent 404s on wire/unwire, honest success reporting, WAL/layout-aware cache freshness (read-only POSTs stay HIT), and 44px phone controls.
- **Caller scan (`T-449`)**: `HeuristicFallbackProvider.getCallers` no longer reuses a stateful `g`-flag regex, no longer counts declarations as callers, and scans directories in sorted order; regression test added.
- **Test hermeticity (`T-449`)**: `findProjectRoot` no longer treats `$HOME`, its ancestors or `/` as project roots, so temp workspaces below home cannot adopt the global `~/.memory`; the doc-link scan also skips `.stversions` and `.commandcode`.

## [3.2.0] - 2026-10-26

**Full Changelog**: https://github.com/harshsinghmp/musememory/compare/v3.1.3...v3.2.0

### Summary
Minor feature release (Wave 29). Ships the native zero-dependency Vibeguard secret scanner CLI (`memory scan-secrets`), workstation hardware and agent ecosystem terrain collector (`memory terrain`), user profile persona engine with customizable archetypes & bracketed placeholders (`memory user init [developer|designer|marketer|casual|custom]`), and achieves complete sovereign decoupling from legacy external environments. Introduces the 4-phase "Golden Sequence" best-practice workflow for AI agents in README and agent reference guides.

### Added
- **Native Vibeguard Secret Scanner CLI (`memory scan-secrets`)**: Zero-external-dependency secret scanner detecting API keys (`sk-*`, `ghp_*`, `npm_*`), private keys, AWS access keys, and database connection strings, with instant terminal redaction (`test/cli_secrets.test.ts`).
- **Machine Terrain Collector (`memory terrain`)**: Deep hardware, toolchain, and coding agent map generator exporting deterministic markdown diagnostics to `.memory/system.md` (`test/vault_system.test.ts`).
- **Sovereign User Profile & Archetype System (`memory user [init|get|set]`)**: Sovereign persona engine supporting developer, designer, marketer, casual, and custom archetypes with bracketed placeholders (`[Name]`, `[Role]`, `[Preferences]`) and dynamic task intent detection (`test/user.test.ts`).
- **The Golden Sequence Guide**: Added comprehensive 4-phase end-to-end pair-programming workflow guide in `README.md` and `docs/agent-reference.md`.
- **Ecosystem Sovereignty Gate**: Automated test gate verifying zero external imports and sovereign operation (`test/sovereignty_gate.test.ts`).

### Changed
- **Latency claims corrected** to p95 targets; measured values shown.
- **Client scope descoped (ADR-007)**: enclaves stay explicit encrypted vaults.
- **Code-context security boundary**: project-scoped resolver, untrusted opt-in, sanitized agent output, capped inputs.
- Purged all legacy external imports and temporary import tools from source tree, achieving 100% self-contained memory operations.
- Updated project documentation and re-generated all claims, CLI references, and MCP tool matrixes.

## [3.1.3] - 2026-10-26

**Full Changelog**: https://github.com/harshsinghmp/musememory/compare/v3.1.2...v3.1.3

### Summary
Patch release. Fixes a CLI argument parsing defect where `memory sync --pool` without a path argument created a stray `./true` directory, modernizes README installation and update workflows to mandate `@latest` across all package managers, and records the Wave 23–29 architectural roadmap and Agent OS research specifications.

### Fixed
- **CLI sync `--pool` boolean flag handling**: `memory sync --pool` without a value passed `--pool "true"`, causing the path resolver to evaluate `./true` as a relative directory. `handleSyncCommand` now filters out boolean `"true"` and empty strings, falling back to the standard pool path unless an explicit directory string is provided.

### Documentation
- **Mandatory `@latest` package installation standards**: Updated README to enforce `@latest` across all package managers (`bun`, `npm`, `pnpm`, `yarn`, `npx`) and documented 3-tier update workflows (CLI/workstation, project/workspace, and storage self-healing).
- **Wave 23–29 Architectural Backlog**: Added exploded ticket plans and research specifications for dashboard overhaul, workspace terrain maps, universal agent hub, and tri-cognitive retrieval.

## [3.1.2] - 2026-10-25

**Full Changelog**: https://github.com/harshsinghmp/musememory/compare/v3.1.1...v3.1.2

### Summary
Patch release. Completes the silent-casing fan-out begun in v3.1.1: the same
case-insensitive project resolution and loud-failure behavior that was fixed on
`memory health` is now applied to all seven remaining audit surfaces (MCP
`memory_anchor_audit`, `memory_drift_audit`, `muse_bug_clusters`,
`muse_tech_debt`; Studio `/api/cognition/anchors`, `/api/cognition/debt`,
`/api/cognition/clusters`). Unknown project names now fail loudly instead of
returning a silent empty report labelled with the wrong-cased input.

### Fixed
- MCP and Studio audit surfaces now resolve project names case-insensitively
  via the shared `resolveProjectName()` owner; unknown projects return a tool
  error (MCP) or 404 (Studio) naming the available projects.

## [3.1.1] - 2026-10-24

**Full Changelog**: https://github.com/harshsinghmp/musememory/compare/v3.1.0...v3.1.1

### Summary
Patch release. Two defects found by the post-release bug-hunt are fixed and
delivered through the bounded gauntlet-loop process (contract-frozen scope,
blind fresh critics, mutation-verified tests): memories the contradiction
engine has flagged `conflicted` are no longer injected into agent prompts, and
project scoping on the health surfaces resolves case-insensitively and fails
loudly on unknown projects.

**A SemVer patch: both items are defect fixes ([#313](https://github.com/harshsinghmp/musememory/issues/313),
[#314](https://github.com/harshsinghmp/musememory/issues/314)) — the new `include_conflicted`
opt-in is additive, and every other surface keeps its shipped shape. Stores
carrying conflicted memories will notice their absence from prompts; pass
`include_conflicted: true` to reproduce the old (leaky) behavior deliberately.**

### Fixed
- **Conflicted memories are withheld from prompts by default ([#313](https://github.com/harshsinghmp/musememory/issues/313), [PR #321](https://github.com/harshsinghmp/musememory/pull/321))**: a memory the contradiction engine has marked `conflicted` is a known potential falsehood, yet it was only rank-discounted (−0.8), never filtered — it surfaced into recall results, ranked candidates (`kept:high_relevance`), fused muse context (`relevant_memories`, `confident_answers`, route manifests, code anchors) and FTS store queries with no badge. One shared `includeConflicted` opt-in is now honored at every prompt-serving gate: the `queryContext` lifecycle gate (hidden-count-aware, with the explicit-status guard so audit queries still reach conflicted rows), the FTS hidden-row gate with an overfetch connective armed whenever any post-fetch hide-gate stays active, the vector hybrid row gate and engine passthrough, the ranking candidate veto, and the muse-context pool choke point plus anchor/route lens strips, constraint projection and a withheld notice. The MCP `search`/`memory_recall` tools expose `include_conflicted` beside `include_superseded`, and the CLI mirrors `--include-conflicted`. Temporal/as-of queries deliberately keep serving state-at-the-time (a conflict verdict is dated after the historical point). The frozen golden recall fixture was untouched — the corpus carries zero conflicted entries (verified, not assumed); seven new tests pin the behavior, and the suite stands at **1408 pass / 0 fail** across 213 files. Fresh Critic verdict 9.5/10 after a mutation-verified overfetch test.
- **Project scoping is case-insensitive and fails loud ([#314](https://github.com/harshsinghmp/musememory/issues/314), [PR #322](https://github.com/harshsinghmp/musememory/pull/322))**: `memory health --project ALPHA` against a store holding `alpha` returned a silent empty report labelled with the caller's casing — the MCP `muse_health` tool and the studio `/api/health?project=` endpoint shared the silent-empty behavior. A single resolution owner (`resolveProjectName`, `src/health/resolve.ts` — exact match wins, unique case-insensitive match returns the store's spelling, unknown or ambiguous stays unresolved) is wired into all three surfaces, which now fail loudly (CLI exit 1, MCP error result, studio 404 — each echoing the requested name and the available projects) instead of silently. The gate itself stays a pure exact-canonical reporter (existing scope tests pass unmodified); `--json` output on the CLI stays pure (the resolution note rides stderr). Eight new tests; Fresh Critic verdict 9/10 after an empirical stdout-purity probe.

## [3.1.0] - 2026-10-24

**Full Changelog**: https://github.com/harshsinghmp/musememory/compare/v3.0.2...v3.1.0

### Summary
Engine release. The contradiction engine compares polarity *claims* instead
of keyword pairs, health reporting and every audit surface can be scoped to
one memory project from the CLI, MCP and the studio, `memory conflicts
--dry-run` previews what peer-to-peer sync would flag, and the delivery
discipline becomes machine-checked: the landing gate runs in CI on every
pull request and push.

**A SemVer minor: one new CLI command, optional `project` arguments on five
existing MCP tools, and one new studio control — no breaking changes to
existing surfaces.**

### Added
- **The Landing Gate (`scripts/check-landed.ts`, `.agents/standards/landing-gate.md`)**: a machine-checkable delivery contract. Work is **landed** only when it is reachable from the integration branch **on the remote**; until then it is **local**. The gate verifies that `HEAD` is an ancestor of `origin/dev` and that nothing is unpushed, and exits non-zero otherwise — printing the exact commands and SHAs so a report can quote the evidence instead of asserting it. A pre-review mode (`--pr --branch <name>`) verifies that a branch is pushed, has an open pull request, and has no failing checks. Wired into CI for both `pull_request` and `push` events.
- **A shared-worktree lease protocol (`.agents/artifacts/WORKTREE-LEASE.md`)**: the file was referenced by an earlier handoff but did not exist. It now defines when a checkout must be leased, how to take and release it (after the *push*, not the commit), and the staging rule — never `git add -A` in a checkout another agent may be writing.

- **Per-project health reporting (`src/store.ts`, `src/health/gate.ts`, `src/anchors/resolver.ts`, `src/adrs/drift.ts`, `src/cognition/clustering.ts`, `src/cognition/tech-debt.ts`)**: `memory health --project P`, a `project` argument on the `muse_health`, `muse_tech_debt` and `muse_bug_clusters` MCP tools, and `?project=` on the studio's `/api/health` endpoint. `listForProject()` is the single owner of the "filter by project, or take the whole store" decision.
- **Project scope on the remaining audit surfaces (`src/mcp.ts`, `src/ui.ts`)**: `memory_anchor_audit` and `memory_drift_audit` (MCP) now take a `project` argument, and the studio's `/api/drift`, `/api/cognition/clusters` and `/api/cognition/debt` endpoints accept `?project=`. The underlying functions already accepted the filter — only the surfaces did not, so a user could scope the health gate but not an anchor or drift audit.
- **A Project Scope control in the Cognitive Studio (`src/ui.ts`)**: a labelled input in the studio header that drives the health, drift, bug-cluster and technical-debt fetches, seeds from the URL query string so a scoped link is shareable and reloadable, and renders the report's `scope` back to the user in the CLI's own wording. The value is carried in the URL, so it survives a reload and can be pasted to a colleague.
- **`memory conflicts [--dry-run]` (`src/cli/conflicts.ts`)**: lists the contradictions recorded in the keep-both `conflicts` table, and with `--dry-run` performs a read-only scan reporting the memory pairs the engine *would* flag. Peer-to-peer sync ingestion is the one path that flags contradictions automatically; this is the operator's preview for it.
- **Dry-run contradiction detection (`src/store.ts`, `src/quality/contradiction.ts`)**: `propose({ checkConflict: true, conflictDryRun: true })` detects and audit-logs (`conflict_detected_dry_run`) without flagging either memory; `detectConflict(store, candidate, { dryRun: true })` returns the detection with `dryRun: true` and mutates nothing.
- **Calibration fixture for the contradiction engine (`test/calibration/contradiction_calibration.json`)**: 21 labelled memory pairs with an expected verdict, gated at precision and recall above 0.9.

### Fixed
- **A close-out could claim work was shipped when it was still local (`scripts/check-landed.ts`, `.agents/standards/landing-gate.md`, `AGENTS.md`)**: on 2026-10-22 two complete waves — the contradiction-engine calibration and the per-project health gate — were committed to a local branch and a local `dev`, and the session ended. No push, no pull request, no CI run. The close-out document nevertheless described them as landed, under a heading reading *"Recently Landed Waves (Verified on `dev`)"*, while `dev` did not contain them and `origin/dev` had already moved to v3.0.2 — so the branch had diverged and the work was invisible to review and to the release. The code was correct and every test was green; the failure was a **false claim about the remote that nothing had ever checked**. The gate now makes the claim conditional on a command, the vocabulary (*landed / shipped / merged / released / "verified on `dev`"*) is restricted to claims the gate has earned, the closeout DOX pass runs the gate before writing under a "Landed Waves" heading, and every final report carries a Remote State block. The staging rule was added at the same time: a broad `git add` in a shared checkout silently absorbs a concurrent agent's in-progress edits into your commit, producing a commit whose message describes work that is not in it.
- **The health gate attributed a store-wide number to one arbitrary project (`src/health/gate.ts`, `src/health/types.ts`)**: the gate, the bug-clustering scanner and the technical-debt scanner all read the whole store, and the report was then labelled with `entries[0].project` — whichever memory happened to sort first. A number that covered every project was presented as one project's health, and there was no way to ask for a single project's health at all. The report now states its scope explicitly (`scope.filter`, `scope.projects`, `scope.entry_count`, `scope.code_scope`), the label is the requested filter, the sole project present, or `all` — never a guess, and every memory-side pillar is scoped to the requested project. Code-side metrics stay workspace-wide by design: source code is shared between projects and cannot be attributed to one of them.
- **Contradiction engine flagged unrelated memories as contradictory (`src/quality/contradiction.ts`, `src/quality/polarity.ts`, `src/quality/scope.ts`)**: the engine compared two memories by testing seven bare regex pairs against their concatenated title and content, so any two memories that happened to contain an "enable"-ish and a "disable"-ish word were flagged as contradictory — regardless of subject or context. "Postgres connection pooling is enabled in production" and "Postgres connection pooling is disabled on localhost" are distinct contextual truths, not a conflict, yet the engine flagged them. Because flagging moves **both** memories to `conflicted`, one false positive cost 25 health points per memory (four false positives fail the store-integrity pillar outright), removed both memories from every future sync broadcast, and still served them into agent prompts. Detection now extracts **polarity claims** — subject, relation, target, scope — and only opposes claims about the same subject in a compatible scope. Measured against ten realistic non-contradictory pairs, the engine flagged 8 of 10 before and 0 of 10 after. Author-supplied fact triples keep the existing semantic path.
- **Scope was resolved per entry instead of per claim (`src/quality/invalidation.ts`)**: one qualifier anywhere in a memory assigned its scope to every fact extracted from it, so "enabled at tier 0" and "disabled at tier 2" were read as the same context. Scope is now resolved against the claim it qualifies.

## [3.0.2] - 2026-10-22

**Full Changelog**: https://github.com/harshsinghmp/musememory/compare/v3.0.1...v3.0.2

### Summary
Website release. The site is rebuilt on the developer-vertical anatomy with a
fluid token system, a new cinematic showreel replaces the old terminal
recording, and the qa-launch release gate becomes executable code that runs in
CI. No engine behaviour, public API, CLI surface or MCP tool name changes.

### Added
- **Rebuilt website** (`apps/website/`): the developer anatomy — hero → demo → architecture → code grid → proof → quickstart → licence — with copy on the AIDA spine and PAS driving the problem block. A token-first stylesheet with fluid `clamp()` spacing and type ramps, logical properties throughout, and no fixed values in components.
- **New showreel** (`apps/website/showreel/index.html`): an original twelve-second "Memory Lattice" film on the AIDA spine, rendered deterministically by a Playwright + ffmpeg pipeline. Every visual is a pure function of `t`, so the render is reproducible and needs no browser download to flatten a vector.
- **Graphic assets**: a twelve-icon line set on a 24px grid (`src/assets/icons/`), and three inline-SVG figures — a recall latency chart, the memory lifecycle state machine, and the system topology with a "your machine only" band around the engine and the store. Every figure is bound to `claims.json`, so no figure can drift from the code.
- **Executable release gate** (`apps/website/scripts/qa-gate.ts`): the qa-launch gate as code — critical paths, the keyboard-only path, 200% zoom reflow, the no-JavaScript first frame, animation performance, the header/footer chrome, a placeholder/debug sweep, the payload budget and a second rendering engine. It exits non-zero on any blocking failure and runs in CI.
- **Published-copy contract** (`test/published_copy_contracts.test.ts`): no user-facing surface may state a count of supported agents, and the latency bounds must come from one place in `claims.json`.

### Changed
- **The copy rule**: the project now says "the majority of coding agents" rather than a number. A number ages badly and invites a precision the registry cannot promise; the precise count stays in `claims.json`, where it is a fact about the code rather than a promise about the market.
- **Shared brand fonts**: moved from the showreel's private folder to `apps/website/src/assets/fonts/`, where the brand pipeline and the showreel renderer share one copy.
- **The agent-readable layer** (`llms.txt`, `llms-full.txt`) derives its figures from the same manifest as the site.

### Fixed
- **The page read blank without JavaScript**: all 43 `.reveal` elements shipped at `opacity: 0` and relied on an `IntersectionObserver` to show them. A `<noscript>` fallback now restores the static document.
- **The mobile menu overflowed the viewport**: `.nav-actions` packed to the start of its flex row, dragging the absolutely-positioned sheet off the left edge.
- **The header rendered as raw inline text**: the stylesheet rewrite dropped the nav rules. A missing CSS rule does not throw — the element takes its browser defaults, invisible to axe and to an overflow check. The chrome moved into the component that owns it and is now measured by the gate.
- **The copy button's fallback hint** read "Press ⌘C" on every platform; it now names the platform's modifier.
- **A `<p>` inside a `<dl>`'s wrapper div** — an axe-core `definition-list` violation on the metric grid.
- **Two animated elements combined `filter: blur()` with a transform animation**, forcing a per-frame re-rasterisation of the blur. The softness now comes from the gradient stops, so the motion stays on the compositor.

### Removed
- The HyperFrames showreel composition and its private font copy.

### Known issues
None. The release gate reports 17/17, SHIP
(`.agents/artifacts/qa-gate-2026-10-22.md`).

## [3.0.1] - 2026-10-22

**Full Changelog**: https://github.com/harshsinghmp/musememory/compare/v3.0.0...v3.0.1

### Summary
Correctness release. Fixes five defects found by a cross-file invariant audit: a prompt-injection channel through `CURRENT.md`, a store that could fail its own schema validator, bi-temporal queries answered from a stale cache entry, a tiered context path that silently dropped `as_of`, and an access counter that never accumulated. Also makes every published number machine-verified, and redesigns the website.

### Fixed
- **Prompt-injection channel through `CURRENT.md` (`src/governor.ts`, `src/mcp.ts`)**: the stored *memory* was sanitised by `propose()`, but the constraint copy written to `CURRENT.md` was not. Because `CURRENT.md` is replayed verbatim into every later prompt, a single `memory_capture(type="constraint")` or `memory_current(action="append")` could persist an injected instruction that reached every future session in the workspace. Sanitisation now happens at the sink — inside `setCurrent()` — so all five callers are covered, and the session-handoff discovery line is sanitised too.
- **Store could fail its own schema validator (`schema.json`)**: `schema.json` declared `additionalProperties: false` but omitted `stale_embedder`, a flag the embedder writes onto entries. Every entry that failed embedding was permanently reported as corrupt by `memory validate`, `memory doctor` and `memory verify --strict`.
- **Bi-temporal queries served the wrong snapshot (`src/retrieval.ts`)**: the L1 context cache key omitted `as_of` (and the include/type/tag flags), so a "what did we believe in Q1?" query could be answered from a 30-second-old *current-state* cache entry.
- **Tiered context dropped `as_of` and `depth` (`src/mcp.ts`)**: `get_context(tier=1, as_of=…)` returned the current state while the untiered path returned the historical one. Both branches now forward the declared arguments.
- **Access counter never accumulated (`src/store.ts`)**: `readEntry()` re-inserted the YAML mirror over the SQLite row on every read, resetting `access_count` to its baseline. The counter feeds the access-frequency ranking axis, the LangMem frequency axis and the access-weighted retention half-life — all three were permanently starved. The database row is now authoritative for the counter.
- **Tier token budget was declared but never enforced (`src/retrieval/tiered.ts`)**: `resolveTierBudget()` was exported and documented but never called, so Tier 0 routinely emitted 327 tokens against a 200-token budget. The budget now bounds the rendered output and reports what it dropped.
- **MCP server advertised a stale version (`src/mcp.ts`, `src/version.ts`)**: the server reported `1.6.0` while the package was at `3.0.0`. The version now comes from `package.json`.
- **Undiscoverable MCP tools (`src/mcp.ts`, `src/connect.ts`)**: `memory_recall`, `memory_get_constraints` and `memory_set_constraints` were callable through the tool switch but absent from `ListTools`, so no client could find them by listing. All three are now registered and allow-listed.
- **Undeclared destructive flags on `memory_delete` (`src/mcp.ts`)**: the dry-run default was disabled by undocumented `apply` and `force` aliases that appeared in no schema. Only the declared `dry_run` and `confirm` can now disable it.
- **Snapshot restore had no path containment (`src/snapshot.ts`)**: `restoreSnapshotRing()` now resolves strictly inside `.memory/snapshots/`, matching the sibling loader's sanitiser.
- **Untyped audit operation (`src/types.ts`, `src/compaction/engine.ts`)**: `"checkpoint"` was written into the hash-chained ledger through an `as any` cast because it was missing from the `AuditOperation` union. It is now a declared member.
- **Corroboration predicate duplicated (`src/quality/corroboration.ts`, `src/promotion/engine.ts`)**: the "is this source synthetic" predicate existed verbatim in two files. The predicate is now shared; the two *bars* it feeds — the stricter multi-day promotion bar and the signal-count confidence bar — remain deliberately different and are documented as such.
- **Title and tag limits declared but not enforced (`src/types.ts`, `src/store.ts`, `src/harvest.ts`)**: `MAX_TITLE_LENGTH` and `MAX_TAGS` existed while the enforced values were magic numbers, and the draft path used a third, undeclared limit. The store and harvester now use the constants, and `MAX_DRAFT_TITLE_LENGTH` declares the draft limit explicitly.
- **Inaccurate published figures across the site and CLI**: the website advertised "80+ coding agents" (52), "45+ credential shapes" (8 rule families) and "69 tools across 6 profiles" (115 across 7), and the CLI `--help` text repeated the agent-platform figure. All corrected against the source.

### Changed
- **Every published number is now generated from the source**: `scripts/generate-claims.ts` derives the tool, profile, platform, import-format, credential-rule and test counts from `src/` into `claims.json`; `scripts/generate-cli-reference.ts` generates `docs/cli-reference.md` and `docs/mcp-tool-matrix.json`. The website imports the manifest instead of hard-coding figures, and `test/marketing_claims.test.ts` fails the build on any drift — including a stale figure in the README prose, a hand-typed count in a page, or an agent-facing document naming a tool that does not exist.
- **Documentation restructured for human and machine readers separately**: `docs/agent-reference.md` (new) is the agent contract — install, file layout, mandatory session protocol, trust gates, failure semantics, and an explicit table of commands that do *not* exist. `docs/cli-reference.md` (new, generated) replaces a hand-written tool table that named five non-existent tools. `docs/roadmap.md` (new) moves the sprint board out of the README. The README gains a 60-second start, a "How it works" section, a "Where your memory lives" section and a documentation map, and shrinks from 54KB to 39KB.
- **Website redesign**: shared `Nav`/`Footer`/`Logo` components (the 404 page previously had no navigation at all), a working mobile menu (the nav links were hidden below 860px with no replacement), a complete SEO head (canonical, Open Graph, Twitter cards, icon set, web manifest, skip link), a capability grid replacing eight long editorial bands, and a new "Your memory is a folder" section. All four pages pass axe-core with zero critical/serious findings and all nine responsive viewports pass the visual audit.
- **New brand system**: a redesigned monogram (the previous mark read as a zigzag rather than an "M"), favicon, Apple touch icon, PWA icons, Open Graph card, Twitter card and README banner — generated deterministically with resvg from the fonts already vendored in the repository, replacing a pipeline that required a 150MB browser download to flatten a vector.
- **Agent-readable website layer**: `llms.txt` and `llms-full.txt` are published and generated from the built HTML, so they cannot drift from the site.
- **Documentation link integrity is enforced**: `scripts/check-doc-links.ts` runs in CI and catches dead relative links and machine-specific `file:///` URLs. Thirteen such links — all pointing into the original author's local checkout — were fixed.
- **Removed the legacy `web/` directory**: a second, hand-written copy of the site that the Astro build superseded, unreferenced and not deployed.

### Security
- **Attestation v2 and merge poisoning guard**: signed sequence + terminal head with key pinning; semantic merge refuses untrusted/self-asserted supersession, content inflation, and protected constraints.
- **The `CURRENT.md` injection channel is closed** — see *Fixed* above. This is the T-110 defence extended to the sink that was bypassing it.
- **Secret scanning is unchanged**: the Vibeguard rules still cover 8 credential families (AI API keys, GitHub and npm tokens, AWS keys, private key blocks, Slack tokens, credentialed connection strings and generic credential assignments). The published figure was wrong, not the scanner.

### Known issues (unchanged, tracked in `docs/roadmap.md`)
Three larger duplications whose correction changes runtime behaviour were deliberately deferred rather than fixed blind: the three divergent per-type TTL tables in `src/retention.ts`, the eight separate token estimators, and the divergent limit-clamping ceilings across retrieval paths.

## [3.0.0] - 2026-10-20

### Summary
Major release introducing closed-loop failure attribution, trajectory fix-pair mining into negative lessons, active working set retrieval compounding via HOT.md, and LangMem logarithmic frequency ranking.

### Added
- **Scoped Failure Attribution Engine (`src/learning/feedback.ts`, `src/quality/utility.ts`) (T-313)**:
  - Scopes failure attribution to memories with matching code anchors (`anchor.file_path`, `anchor.symbol_name`), `graph.affected_paths`, `test_command`, or distinctive keywords, eliminating bystander demotions.
  - Per-session strike deduplication ensuring at most 1 strike is levied against a memory per working session regardless of retry attempts.
  - Dual-decay strike counter decaying active strikes after 2 consecutive clean runs or 30 days of inactivity.
  - Constitutional gate requiring 3 distinct corroborated strikes before demoting `status: "confirmed"` to `"disputed"`.
  - Immunity protection against automated dispute for `type: "constraint"`, `temporal_mode: "timeless"`, and foundational memories with `salience >= 0.95`.
  - Audit trail logging emitting `regression_strike`, `strike_decay`, and `dispute_triggered` events.
- **Trajectory Fix-Pair Mining (`src/learning/distill.ts`, `src/learning/negative.ts`) (T-144)**:
  - Discovers negative memories from sequential observation trajectories adhering to the *Error ➔ Remediation ➔ No Recurrence* pattern.
  - Affinity filters rejecting informational and non-mutating commands (`ls`, `cat`, `grep`, `pwd`, `status`, `git branch`).
  - Dynamic line number normalization in compiler and stack trace errors to prevent candidate duplicates across code shifts.
  - Automated Vibeguard secret scrubbing across all error logs and remediation command snippets.
  - Bounded session volume cap enforcing a maximum of 3 mined candidates per harvest pass.
- **Source-Tagged Recall Hits & HOT.md Compounding (`src/compounding/temporal.ts`, `src/retrieval.ts`) (T-314)**:
  - Extracts and caches candidate IDs from `.memory/HOT.md` with memoized filesystem `mtime` invalidation.
  - Tags recall hits with origin channels (`source_channels: ("hot" | "fts" | "vector" | "tree" | "distilled")[]`).
  - Applies a relevance-gated `sourceBonus` (+0.20) for candidates present in `HOT.md` matching active query semantics.
  - Emits attribution tokens in explainability logs (`source:hot`, `source:fts`).
- **LangMem Logarithmic Frequency Rank Axis (`src/retrieval.ts`, `src/retrieval/ranking.ts`) (T-315)**:
  - Sub-linear logarithmic frequency curve ($0.25 \times \frac{\ln(1 + \text{effectiveCount})}{\ln(1 + 50)}$) replacing unbounded linear access counts.
  - Multiplier weighting verified successful memory applications $2\times$ over passive context loads.
  - 7-day recency bonus (+0.05) for freshly reinforced memories with smooth ceiling saturation at 0.30.
  - Surfaces `freq:high` explainability tokens when frequency score exceeds 0.15.

### Changed
- **Failure Feedback**: `evaluateSessionOutcomes` no longer penalizes bystander memories recalled in a session when unrelated test commands fail.
- **Audit Operations**: Extended `AuditOperation` union in `src/types.ts` with `regression_strike`, `strike_decay`, and `dispute_triggered`.
- **Anchor Types**: Standardized `CodeAnchor` properties across failure attribution to `file_path` and `symbol_name` with backwards-compatible legacy fallbacks.

### Added
- **Optional Local Semantic Embeddings (R21)**: an OpenAI-compatible `/v1/embeddings` endpoint (llama.cpp server, Ollama, or hosted) can supply a semantic cosine dimension to multi-factor ranking. Configured with `retrieval.embedderUrl` / `retrieval.embedderModel`; unset means retrieval is unchanged.
- **`memory embed [status|build|reindex]`**: embedding lifecycle CLI. `status` runs offline; `build` and `reindex` probe the configured endpoint. Embeddings are cached as float32 blobs in SQLite behind a pipeline fingerprint (model, dimensions, endpoint) — a changed pipeline refuses recall until you run `memory embed reindex`.
- **Recall quality eval harness (R27)**: a golden-fixture suite that fails when recall@5 drops below its configured floor, so retrieval regressions break the build instead of shipping silently.
- **Memory versioning CLI (R23)**: `memory branch`, `memory checkout`, `memory blame`, and `memory ls-branches` add Git-like variant tagging over memories.
- **Access-weighted retention (R23)**: half-life decay curves where frequently accessed entries are retained longer.

### Changed
- **Ranking**: the semantic cosine dimension is opt-in and additive — with no embedder configured, scoring is unchanged.
- **Hook pack install is harness-independent (T-390)**: `memory hooks install` and `memory connect --with-hooks` now target `<project>/.agents/hooks.json` (or `~/.agents/hooks.json`) instead of `~/.claude/settings.json`. Reaching `~/.claude/settings.json` requires an explicit `--harness claude`; a pre-existing Claude config no longer implies consent.
- **Claude Code MCP wiring requires explicit opt-in (T-390)**: `memory connect` skips `~/.claude*` paths and reports the skip unless `--harness claude` is passed.

### Security
- **`test_command` is template-gated (T-001)**: `memory verify` no longer runs entry commands through a shell. A command must match one of three fixed templates — `bun test <relative *.test|*.spec path>`, `node --check <relative path>`, or `bunx tsc --noEmit` — and is executed as a direct argv with no shell. Shell metacharacters, absolute paths, `..` traversal, flag-smuggling paths, and code-execution flags (`-e`, `--import`, `--env-file`, …) are refused. Refusals execute nothing and are recorded in the audit trail as `verify_refused`, so probing attempts stay visible.
- **`test_command` schema guard (T-001)**: `validateEntry` now rejects non-string, over-long (500 chars), or non-executable `test_command` values at both `/test_command` and `/verification/test_command`.
- **Strict path containment (T-363)**: new `src/paths.ts` guards `.memory`-relative writes. Wiki concept/entity lookups and PageIndex build/load/delete resolve through `resolveWithin`, which rejects absolute segments, NUL bytes, and lexical escapes including sibling prefixes such as `../memory-evil`. PageIndex index ids must additionally be bare filenames.
- **External paths stay explicit (T-363)**: shared-pool sync directories and `mesh link` targets are legitimately outside `.memory`; they now route through `resolveExternal`, which normalizes and rejects NUL bytes without confining them.

### Fixed
- **`connect` no longer writes a Claude config the user did not ask for (T-390)**: `~/.claude.json`, `~/.claude/settings.json`, and injected `allowedTools` are only touched with `--harness claude`.
- **PageIndex reads fail soft on hostile ids (T-363)**: a traversing `project`/`indexId` is a miss (`null`), not an exception, so `loadPageIndex` stays a safe read-only query.

## [2.3.0] - 2026-09-03

### Summary
Feature release introducing the Autonomous Memory Optimizer Engine with zero-daemon auto-cadence, Embedded Web UI dashboard optimization controls, clean `CURRENT.md` operational guidelines for Humans and Agents, and Concurrent Multi-Agent Workstream Tracking to prevent file collisions in parallel agent swarms.

### Added
- **Autonomous Memory Optimizer Engine (`src/optimize.ts`)**:
  - High-precision pruning of test assertion noise (`expect(...)` traces, runner mock logs, assertion failures).
  - Junk fragment detection pruning single-character noise (`'1'`, `'+'`), micro-snippets, accidental system transcript dumps (`MODEL PLANNER_RESPONSE`, `</SYSTEM_MESSAGE>`, `The above content does NOT show the entire file contents`, and truncated outputs).
  - Normalization-based candidate memory deduplication preserving high-value human-confirmed rules and architecture decisions.
  - Automatic SQLite `VACUUM;` and `PRAGMA optimize;` defragmentation in WAL mode to reclaim wasted disk pages.
  - Operational audit logging emitting `operation: "optimize"` events and persisting metadata in `.memory/optimization_meta.json`.
- **Zero-Daemon Automated Cadence Engine**:
  - Automatically evaluates store health on turn start (`get_context`, `muse_context`) and CLI invocation:
    - **7-Day Cadence**: Triggers automatic defragmentation and pruning every 7 days.
    - **48-Hour Inactivity Window**: Triggers optimization when workspace is idle for 48 hours and hasn't been optimized in 48 hours.
- **CLI Command: `memory optimize`**:
  - Full-featured terminal optimization command supporting `--dry-run`, `--force`, `--project`, `--days-interval`, and `--inactivity-hours`, with a formatted terminal audit scoreboard.
- **Dashboard "⚡ Optimize" Trigger & Endpoints (`src/ui.ts`)**:
  - Added `#optimizeBtn` with `⚡ Optimize` icon and hover tooltip to the Web Observability Studio header.
  - Added `POST /api/optimize` and `GET /api/optimize/status` REST endpoints.
  - Added `optimizeStoreDashboard()` frontend handler with real-time spinner feedback and flash toasts reporting reclaimed bytes and pruned units.
- **Concurrent Multi-Agent Workstream Tracking (`src/governor.ts`)**:
  - Introduced `AgentWorkstream` interface tracking `agent`, `sessionId`, `task`, `targetScope`, `status`, `lastActive`, and `lastInstruction`.
  - Added `WorkspaceGovernor.registerWorkstream(memoryDir, workstream)` and `registerAgentWorkstream()` with 48-hour completion auto-pruning.
  - Renders live `## 🤖 Active Concurrent Agent Workstreams` Markdown table in `CURRENT.md`.
  - Injected active concurrent workstreams into `formatPromptContext` (`src/retrieval.ts`) and `resolveMuseContext` (`src/orchestrator/context.ts`) so parallel agents across separate chats or IDE windows stay mutually aware and avoid file collisions.
- **Automated Test Suite**:
  - Added `test/optimize.test.ts` verifying test noise detection, junk fragment detection, 7-day / 48-hour auto-cadence, and end-to-end SQLite defragmentation.
  - Extended `test/governor.test.ts` for concurrent workstream management and `test/ui.test.ts` for optimize endpoints.

### Changed
- **`CURRENT.md` Operational Guidelines & Sanitation**:
  - Cleaned `.memory/CURRENT.md` from 5,234 lines of raw terminal logs down to 26 clean lines of authoritative invariants.
  - Established explicit guidelines: single-pane executive summary for Humans (zero verbose logs) vs. mandatory grounding contract and concurrency awareness for AI Agents.
  - Hardened `syncConstraints` and `parseCurrentFile` in `src/governor.ts` with `isValidConstraintLine(text)` and normalized deduplication, preventing multi-line terminal debris from ever re-bloating `CURRENT.md`.
- **Agent Skill Documentation**:
  - Updated `.agents/skills/muse-current/SKILL.md` with operational guidelines and the multi-agent coordination protocol.

## [2.2.1] - 2026-09-03

### Fixed
- **Command Injection Hardening**: Replaced shell string invocation in `generatePrContext` (`src/compaction/pr-context.ts`) with direct argument array execution via `execFileSync("git", ...)` and validated git reference names against strict identifier patterns.
- **SQLite Concurrency & Lock Contention**: Configured `PRAGMA busy_timeout = 5000;` and `PRAGMA foreign_keys = ON;` in both Bun and Node SQLite database drivers (`src/sqlite.ts`), preventing immediate `SQLITE_BUSY` crashes in multi-agent and concurrent workflows.
- **Store Listing O(N) Stat Storm**: Optimized `list(store)` (`src/store.ts`) to query indexed SQLite records directly and discover external YAML files via single-pass `readdirSync`, eliminating thousands of redundant synchronous filesystem `statSync` calls.
- **Accurate Benchmark Cold Startup**: Corrected cold startup latency measurement in `runMemoryBenchmark` (`src/benchmark/suite.ts`) to benchmark actual unprimed store opening and initialization instead of in-memory array property access.
- **Dual-Write Persistence Observability**: Replaced silent error swallowing in `save(store, entry)` (`src/store.ts`) with structured warning logs when YAML filesystem persistence fails.
- **Impact Analysis Precision**: Tightened ADR matching in `analyzeMemoryCodeImpact` (`src/intelligence/impact.ts`) with normalized path checks, exact code anchor matching, and regex word boundaries, eliminating false-positive risk inflation on common filenames.
- **Atomic Reconciler Transactions**: Wrapped anchor reconciliation writes in `reconcileCodeAnchors` (`src/health/reconcile.ts`) inside an atomic SQLite transaction (`BEGIN TRANSACTION` ... `COMMIT`).

## [2.2.0] - 2026-09-03

### Summary
Feature release introducing Unified Code & Memory Impact Analysis, PR Context Generator, Interactive Code Anchor Reconciler, Latency & Quality Benchmark Suite, and 5 turnkey Agent Skills.

### Added
- **Unified Code & Memory Impact Analysis (`src/intelligence/impact.ts`)**:
  - Pre-flight blast radius analysis evaluating AST callers, test suites, governing ADRs, negative warnings, and risk levels.
  - CLI command: `memory code-impact <file> [--symbol <name>]`.
  - MCP tool: `muse_code_impact`.
- **PR & Change Context Generator (`src/compaction/pr-context.ts`)**:
  - Automatically turns git diffs into rich, memory-grounded GitHub PR descriptions linking touched anchors and active constraints.
  - CLI command: `memory pr-context [--base <branch>] [--out <file>]`.
  - MCP tool: `muse_pr_context`.
- **Interactive Code Anchor Reconciler (`src/health/reconcile.ts`)**:
  - Audits and repairs code anchors across memories, pruning dead references and updating structural hashes.
  - CLI command: `memory reconcile [--prune] [--mark-stale] [--update-hashes] [--dry-run]`.
  - MCP tool: `muse_reconcile_anchors`.
- **Latency & Quality Telemetry Suite (`src/benchmark/suite.ts`)**:
  - Benchmarks microsecond hot caches, FTS5 BM25 search, knapsack token packing, and ROI in a clean ASCII scoreboard.
  - CLI command: `memory benchmark [--iterations N] [--budget N]`.
- **Agent Skills Roster**:
  - Shipped 5 turnkey skills: `.agents/skills/muse-health`, `muse-drift`, `muse-why`, `muse-sync`, and `muse-mesh`.

## [2.1.0] - 2026-09-03

### Summary
Major feature expansion introducing Cross-Agent Knowledge Sync & P2P Gossip Protocol (R14), Full Web Observability Studio (R15), and Multi-Repo & Monorepo Cross-Project Mesh (R16).

### Added
- **Cross-Agent Knowledge Sync & P2P Gossip Protocol (`src/sync/`)**:
  - `SyncPacket` engine with whole-packet SHA-256 integrity verification and vector clock causal ordering (`src/sync/packet.ts`).
  - Gossip state machine with deduplication, inline Vibeguard credential scrubbing, and semantic contradiction tagging with mutual `conflict_ids` (`src/sync/engine.ts`).
  - Shared filesystem drop-directory gossip pool (`src/sync/pool.ts`) for zero-daemon multi-agent pods.
  - CLI command: `memory sync` (`--status`, `--broadcast`, `--ingest`, `--pool`, `--agent-id`, `--pool-dir`).
  - MCP tools: `muse_sync_broadcast`, `muse_sync_ingest`, `muse_sync_status`, `muse_sync_pool`.
- **Full Web Observability Studio (`src/ui.ts`)**:
  - Embedded web dashboard control plane accessible via `memory studio` (or `memory ui`).
  - 5-Pillar Project Health Gate card with letter grade (A-F), composite score (0-100), pillar progress bars, and actionable remediation checklist.
  - Interactive ADR registry and bi-directional documentation ↔ code drift audit table.
  - Autonomous historical "Why" reasoner query interface explaining code evolution.
  - Fragility bug clustering heatmap and technical debt scanner report.
  - Live P2P gossip mesh status and interactive broadcast/shared pool sync controls.
  - 9 REST API endpoints: `/api/health`, `/api/adrs`, `/api/drift`, `/api/cognition/why`, `/api/cognition/clusters`, `/api/cognition/debt`, `/api/sync/status`, `/api/sync/pool`, `/api/sync/broadcast`.
- **Multi-Repo & Monorepo Cross-Project Mesh (`src/mesh/`)**:
  - Workspace monorepo discovery (`src/mesh/discovery.ts`): auto-detects pnpm, npm, bun, lerna workspaces, and sibling git repositories.
  - Explicit external repository linking via `.memory/mesh_links.json`.
  - Cross-project memory query resolver (`src/mesh/resolver.ts`): queries memories across all package stores with origin package provenance tags (`[mesh:@scope/pkg]`).
  - Shared invariant and working constraint propagation across the workspace mesh (`propagateConstraintToMesh`).
  - Cross-package dependency contract and entrypoint export auditor (`src/mesh/contracts.ts`) validating cross-package imports and cross-repo code anchors.
  - CLI command: `memory mesh` (`query`, `check`, `link`, `unlink`, `propagate`).
  - MCP tools: `muse_mesh_status`, `muse_mesh_query`, `muse_mesh_audit`, `muse_mesh_link`.
  - Studio panel: 🕸️ Monorepo Mesh tab with topology cards, package node grid, cross-project search, and contract audit table.

## [2.0.0] - 2026-09-03 — Autonomous Cognitive Engine Major Overhaul

### Summary
Major architectural milestone evolving Muse Memory from an episodic store into an autonomous, self-correcting, evidence-aware cognitive engine with native code anchors, first-class ADRs, bidirectional drift auditing, "Why" reasoning, and a 5-pillar health gate.

## [1.22.0] - 2026-09-03

### Added
- **Unified 5-Pillar Project Health Gate (`src/health/gate.ts`)**:
  - Comprehensive single-call architectural and memory health evaluation across 5 critical pillars:
    1. *Memory Store Integrity*: Contradictions, unverified/expired memories, timeless constraints.
    2. *Native Code Anchor Validity*: Live AST structural verification, drift detection, orphaned anchors.
    3. *Documentation ↔ Code Alignment*: Bi-directional drift, undocumented exports, stale references.
    4. *Negative Lessons & Anti-Pattern Sentry*: Saliency and defense against known traps.
    5. *Technical Debt & Friction*: TODO/FIXME/HACK markers, `as any` type bypasses, recurring bug clusters.
  - Generates composite score ($0 \dots 100$), letter grade (`A`, `B`, `C`, `D`, `F`), and gate status (`PASS`, `WARN`, `FAIL`).
  - Produces an automated, prioritized Actionable Remediation Checklist.
- **CLI Health Command (`src/cli/health.ts`)**:
  - `musememory health`: Rich terminal dashboard with ANSI styling, pillar scorecards, and remediation lists.
  - Supports `--json` flag for CI/CD gates and exit code 1 on `FAIL` status.
- **New MCP Tool (`src/mcp.ts`)**:
  - `muse_health`: Exposes the 5-pillar health audit to AI coding agents with profile integration across `review`, `architecture`, and `maintenance`.

## [1.21.0] - 2026-09-03

### Added
- **Autonomous Engineering Cognition & "Why" Reasoner (`src/cognition/why.ts`)**:
  - `explainWhyCodeIsTheWayItIs`: Synthesizes the historical rationale behind a piece of code, symbol, or constraint.
  - Chronological timeline reconstructing initial architectural decisions, hardening bug fixes, accepted trade-offs, negative warnings, and timeless invariants.
  - Generates evidence-backed confidence scores ($0.0 \dots 1.0$) based on authoritative verifications and native code anchors.
- **Recurring Bug & Friction Clustering (`src/cognition/clustering.ts`)**:
  - `clusterRecurringBugsAndFriction`: Automatically clusters bug fixes, negative lessons, and failure records into architectural fragility hotspots.
  - 5 root-cause categories: race conditions, type drift, missing boundary guards, resource leaks, and architecture flaws.
  - Computes fragility scores per subsystem and formulates root-cause hypotheses with preventative recommendations.
- **Technical Debt & Workaround Registry (`src/cognition/tech-debt.ts`)**:
  - `analyzeTechnicalDebt`: Scans repository files and memory store for debt markers (`// TODO:`, `// FIXME:`, `// HACK:`, `// WORKAROUND:`), dangerous `as any` type assertions, and drifted code anchors.
  - Calculates composite technical debt score ($0 \dots 100$) and surfaces top hotspot files.
  - Generates prioritized, memory-grounded refactoring recommendations.
- **New MCP Tools (`src/mcp.ts`)**:
  - `muse_why`: Autonomous "Why" code explanation engine.
  - `muse_bug_clusters`: Recurring bug hotspot clustering and fragility analysis.
  - `muse_tech_debt`: Technical debt and workaround scanner.

## [1.20.0] - 2026-09-03

### Added
- **First-Class Architecture Decision Records (`src/adrs/engine.ts`)**:
  - Treats ADRs as living, queryable memory entities rather than static dead files.
  - Auto-incrementing sequential ADR numbering (`ADR-1`, `ADR-2`, etc.).
  - Structured ADR format: status (`proposed`, `accepted`, `superseded`, `rejected`), context & drivers, decision, consequences (positive, negative trade-offs, neutral), options considered (with pros, cons, rejection reasons), and native code anchors.
  - Native ADR supersession workflow: mutually links older ADRs to newer replacements with append-only audit tracking.
- **Bidirectional Documentation ↔ Code Drift Engine (`src/adrs/drift.ts`)**:
  - `detectDocumentationCodeDrift`: Compares memory/ADR claims against live filesystem ASTs and conversely scans code for undocumented exports.
  - 6-state alignment classification:
    - `DOCUMENTED`: Documented memory confirmed present in live codebase.
    - `IMPLEMENTED`: ADR decision verified in source implementation.
    - `PARTIAL`: Code signature or implementation body drifted from documented hash.
    - `CONFLICTING`: Direct contradiction with active architectural rules.
    - `STALE`: Outdated documentation pointing to deleted or renamed files/symbols.
    - `MISSING`: Exported code symbols lacking any documentation or architectural record.
  - Computes repository alignment score and provides actionable remediation suggestions.
- **New MCP Tools (`src/mcp.ts`)**:
  - `memory_adr_record`: Record a first-class Architecture Decision Record.
  - `memory_adr_list`: List ADRs filtered by status.
  - `memory_drift_audit`: Run bidirectional documentation ↔ code drift audit.

## [1.19.0] - 2026-09-03

### Added
- **Flagship Unified Context Orchestrator (`src/orchestrator/context.ts`)**:
  - `muse_context`: Single-call fused entry point accepting query, active file, symbol, error message, task intent, and token budget.
  - Returns ranked memories, code anchor matches, negative anti-pattern warnings, active `CURRENT.md` constraints, and actionable next steps in one unified payload.
  - Strict token-budget knapsack packing: prioritizes active invariants and negative lessons to prevent context overflow while preserving essential constraints.
- **Bidirectional Code ↔ Memory Lookups (`src/orchestrator/bidirectional.ts`)**:
  - `muse_code_for_memory`: Given a memory ID, extracts all anchored code files, symbols, and backtick references.
  - `muse_memory_for_code`: Given a file path or symbol, returns all associated decisions, negative lessons, and constraints.
- **Task-Focused MCP Profiles (`src/orchestrator/profiles.ts`)**:
  - 6 dedicated profiles reducing agent context bloat: `core`, `coding`, `debugging`, `review`, `architecture`, `maintenance` (plus `full`).
  - Filter tools dynamically via `MUSE_MCP_PROFILE` environment variable or `createServer` initialization.
- **New MCP Tools (`src/mcp.ts`)**:
  - `muse_context`: Flagship unified context fusion.
  - `muse_code_for_memory`: Code reference extraction for memory entry.
  - `muse_memory_for_code`: Associated memory search for codebase file/symbol.
  - `muse_profile_list`: Profile inspector and tool definitions.

## [1.18.0] - 2026-09-03

### Added
- **Native Code Anchors & Stable Structural Code Identity (`src/anchors/`)**:
  - First-class code anchor entities independent of any external provider (`repository`, `file`, `directory`, `module`, `symbol`, `qualified_symbol`, `route`, `test`, `commit`, `pr`).
  - Structural fingerprinting engine (`src/anchors/fingerprint.ts`): normalizes comments, punctuation spacing, and whitespace to generate stable, line-independent SHA-256 structural hashes.
  - Immunity to line shifts, formatting, and documentation comments while remaining strictly sensitive to AST/logic changes.
  - Balanced brace block extractor for functions, classes, methods, and arrow expressions.
  - Code-aware drift and orphan verification (`src/anchors/resolver.ts`): detects deleted files/symbols (`orphaned`), code logic modifications (`drifted`), and verified matches (`valid`).
  - Repository-wide anchor audit (`auditMemoryAnchors`): calculates store integrity score and flags degraded anchors with append-only audit trail logging.
- **New MCP Tools for Code Anchors (`src/mcp.ts`)**:
  - `memory_anchor_create`: Create and attach a structural code anchor to a memory entry.
  - `memory_anchor_verify`: Verify code anchors on a memory entry against live repository files.
  - `memory_anchor_audit`: Run repository-wide audit of all code anchors and compute integrity metrics.

## [1.17.0] - 2026-09-03

### Added
- **Scoped Promotion & Generalization Engine (`src/promotion/`)**:
  - 3-tier scope migration ladder: `LOCAL` (workspace/session) → `PROJECT` (repo `.memory/`) → `GLOBAL` (reusable cross-project `~/.memory/`).
  - 5× Success Promotion Policy: enforces `>= 5` successful uses, 100% success rate, 0 regressions, 0 conflicts, and sufficient evidence before automatic global promotion.
  - Generalization Engine (`src/promotion/generalization.ts`): scrubs specific repository file paths, line numbers, and commit hashes into universal architectural principles.
  - Manual global promotion support bypassing 5× requirement with full provenance.
  - Promotion audit records in `.memory/audit.jsonl` with operation `promote`.
- **Extended Archival Lifecycle & Dynamic Rehydration (`src/promotion/archival.ts`)**:
  - Multi-tier lifecycle: `ACTIVE` → `COLD` → `DORMANT` → `ARCHIVED`.
  - Stale policy and utility evaluation sweeps automatically transitioning aging, unused, or superseded memories down the tier ladder.
  - Dynamic Rehydration: automatically restores `ARCHIVED`/`DORMANT` memories to `ACTIVE`/`CONFIRMED` upon high retrieval query relevance match.
  - Archival audit records with operations `archive` and `rehydrate`.
- **New MCP Tools for Promotion and Lifecycle (`src/mcp.ts`)**:
  - `memory_evaluate_promotion`: Evaluates an entry against the 3-tier promotion ladder and 5× success rule.
  - `memory_promote`: Executes scoped promotion (local → project or project → global) with generalization.
  - `memory_generalize`: Previews and tests content generalization.
  - `memory_archive`: Transitions memory entries to cold, dormant, or archived tiers.
  - `memory_rehydrate`: Restores archived memories back to active status.
  - `memory_lifecycle_status`: Inspects store-wide lifecycle distribution and triggers optional archival sweeps.

## [1.16.0] - 2026-09-03

### Added
- **Context Compaction & Interruption-Proof Session Handoff Engine (`src/compaction/`)**:
  - Context usage evaluation enforcing the 70% threshold invariant: `"Context at 70%. Compact now or continue?"`.
  - Canonical 5-invariant lockdown protocol:
    1. High level goal of your build spec
    2. Current architecture and data flow
    3. What is already implemented and considered done
    4. What is explicitly not done yet
    5. The next concrete task we are working on
  - Interruption-proof checkpoint compiler: writes structured handoffs into `.memory/CURRENT.md` with compact resumption prompt generation.
  - Continuous Session Memory Harvester (`src/compaction/harvester.ts`): automatically extracts durable decisions, bug fixes, invariants, and negative lessons directly from conversational turns without user friction.
- **New MCP Tools for Compaction and Harvesting (`src/mcp.ts`)**:
  - `memory_compaction_check`: Check token usage against the 70% threshold.
  - `memory_compact_handoff`: Lock down the 5 invariants and compile interruption-proof `CURRENT.md` handoff.
  - `memory_harvest_turn`: Continuously harvest durable knowledge from agent turns.

## [1.15.0] - 2026-09-03

### Added
- **Multi-Factor Ranking Engine (`src/retrieval/ranking.ts`)**:
  - Replaces naive retrieval with an 11-dimension scoring model:
    - Exact symbol match: +1.0
    - Path / directory match: +0.4
    - Lexical BM25 match via SQLite FTS5: +0.3
    - Graph / call-graph overlap: +0.3
    - Blast-radius relevance: +0.25
    - Recency decay: -0.05 per 30 days untouched (timeless constraints immune)
    - Utility / reuse success-rate bonus: +0.25 for verified high-utility memories
    - Negative lesson warning bonus: +0.3 for anti-patterns matching query/paths
    - Invariant / timeless boost: +0.2 for constraints
    - Status penalties: -0.8 conflicted, -0.5 stale/superseded
  - Priority-based knapsack token budget packing: ensures critical project invariants and constraints fit first without overflowing token budgets.
- **New MCP Tool for Multi-Factor Ranked Retrieval (`src/mcp.ts`)**:
  - `memory_ranked_retrieval`: Queries memories with full 11-factor scoring breakdowns and knapsack token packing.

## [1.14.0] - 2026-09-03

### Added
- **Pluggable Code Intelligence Provider Architecture (`src/intelligence/`)**:
  - Standardized `CodeIntelligenceProvider` interface specifying `resolveSymbols`, `getCallers`, `getCallees`, `getRelatedFiles`, `getBlastRadius`, and `extractGraphContext`.
  - Dynamic `ProviderRegistry` with automatic capability detection and zero-crash fault isolation.
  - Multi-tier fallback chain: CodeGraph → Graphify → LSP → Heuristic Fallback → Safe Empty.
  - Zero mandatory external dependencies: pure autonomous operation if no external intelligence engines are present.
- **Optional Provider Adapters (`src/intelligence/adapters/`)**:
  - `CodeGraphProvider`: Integrates with `.codegraph` indexes or CLI when available.
  - `GraphifyProvider`: Ingests graph networks and dependencies from `.graphify/graph.json`.
  - `LspProvider`: Hooks into language server protocols or agent-lsp when active.
  - `HeuristicFallbackProvider`: Built-in zero-dependency AST/regex file scanner providing baseline symbol and relationship resolution across workspace files.
- **Code Intelligence Memory Enrichment (`src/intelligence/enrichment.ts`)**:
  - Enriches memory entries with code intelligence evidence (symbol kinds, definition lines, source files) without modifying core content.
- **New MCP Tools for Code Intelligence (`src/mcp.ts`)**:
  - `memory_code_intel_status`: Query active providers and capabilities.
  - `memory_code_intel_symbols`: Resolve symbols across active providers with fallback.
  - `memory_code_intel_blast_radius`: Calculate ripple effects and blast radius for files and symbols.
  - `memory_enrich`: Enrich memories with code intelligence evidence.

## [1.13.0] - 2026-09-03

### Added
- **Ephemeral Observation Tier (`src/learning/observation.ts`)**:
  - Append-only `.memory/observations.jsonl` ledger for raw event streams (tool outputs, test outputs, build failures, code review comments, file edits).
  - Built-in Vibeguard secret defense preventing credential leakage into raw observation streams.
  - State tracking linking observations to extracted candidate memories.
- **First-Class Negative Memories (`src/learning/negative.ts`)**:
  - Dedicated `negative` memory type capturing `DO_NOT_USE`, `FAILED_APPROACH`, and `BUG_PRONE_PATTERN` lessons.
  - Structured fields: `failed_approach`, `failure_reason`, `alternative_recommended`, `reproduction_command`, and `severity`.
  - Enforced `timeless` temporal mode and elevated baseline salience (`0.85`) to safeguard future agent turns against known traps.
- **Autonomous Distillation Pipeline (`src/learning/distill.ts`)**:
  - Distills raw observation streams into structured candidate bug fixes (`fix`), architectural conventions (`architecture`), and anti-patterns (`negative`).
- **Session Outcome Feedback & Reinforcement Loop (`src/learning/feedback.ts`)**:
  - Automatically evaluates test and command exit codes against memories applied during the session.
  - Grants positive reinforcement on success and flags regressions with failure logs on command errors.
- **New MCP Tools for Autonomous Learning (`src/mcp.ts`)**:
  - `memory_observe`: Ingest ephemeral raw observation events.
  - `memory_distill_observations`: Trigger autonomous distillation of raw observations into candidates.
  - `memory_negative_capture`: Explicitly record negative patterns and failed approaches.

## [1.12.0] - 2026-09-03

### Added
- **Memory Quality, Deduplication & Canonical Consolidation (`src/quality/dedup.ts`)**:
  - Deterministic SHA-256 content fingerprinting on normalized markdown text.
  - Word-level Jaccard similarity and exact fingerprint duplicate detection.
  - Canonical memory consolidation: duplicate observations merge into existing canonical memories with supporting evidence arrays and reinforcement bonuses.
  - Temporal mode inference: distinguishes `current` facts, `historical` past architectures/migrations, and `timeless` constraints.
  - Categorical quality model: classifies entries into `LOW`, `MEDIUM`, `HIGH`, `VERIFIED`, `CONFLICTED`, `STALE`.
- **Contradiction Engine & Conflict Resolution (`src/quality/contradiction.ts`)**:
  - Semantic conflict detection flagging opposing polarities, technological clashes, and direct negations without silent overwrites.
  - First-class `conflicted` status with mutual `conflict_ids` linking opposing memories.
  - Deterministic resolution protocols: `supersede`, `historical` (preserves obsolete memory as historical context), `reject`, or `keep_both`.
- **Utility Tracking & Memory ROI Calculator (`src/quality/utility.ts`)**:
  - First-class memory utility tracking: `retrieval_count`, `application_count`, `successful_applications`, `failed_applications`, `regressions`, `reuse_success_rate`.
  - Automated safety threshold: flags memories as `disputed` when 3+ consecutive regressions occur.
  - Full Memory ROI report: overall reuse success rate, high-performing memories, and harmful regressions.
- **New MCP Tools for Quality and Feedback (`src/mcp.ts`)**:
  - `memory_feedback`: Agent outcome feedback loop to report task success, failure, or regression.
  - `memory_resolve_conflict`: Programmatic conflict resolution across competing memories.
  - `memory_roi`: Store-wide utility and return-on-investment telemetry.
- **In-Process L0 Hot Memory Cache & L1 Context Cache (`src/cache.ts`)**:
  - Microsecond-level O(1) in-memory cache for memory entries, filtered queries, and formatted prompt contexts.
  - Bounded LRU eviction, configurable TTL, and store-version generation invalidation on mutations.
  - Dual-persistence synchronization with disk `mtimeMs` verification: guarantees zero YAML parsing for untouched files while immediately detecting external edits or file corruptions.
- **SQLite FTS5 Full-Text Virtual Table & BM25 Search (`src/sqlite.ts`)**:
  - Integrated `memories_fts` virtual table using SQLite FTS5 with Unicode61 tokenizer.
  - Automatic backfill migration for existing databases and automatic synchronization on insert and delete.
  - High-performance `searchMemoriesFts()` API delivering sub-millisecond lexical and prefix search.
  - Performance-tuned PRAGMAs (WAL mode, synchronous=NORMAL, 64MB cache size, 256MB mmap).
- **Comprehensive Benchmarks & Latency Suite (`test/benchmark.test.ts`, `test/cache.test.ts`)**:
  - Hot cache lookup verified under 0.05ms (sub-50 microseconds).
  - Bulk listing with query cache verified under 0.1ms for 100+ entries.
  - FTS5 BM25 search verified under 2ms.

## [1.10.0] - 2026-08-31

### Added
- **Universal Multi-Agent Transcript Harvester & Auto-Learner (`memory learn` / `memory sync-chats`)**:
  - Automatically probes the host machine for active AI agent session transcripts across 80+ platforms (Antigravity, Gemini CLI, Claude Code, OpenCode, Hermes, Goose, Codex, Cursor, etc.).
  - Extracts conversational fixes, architectural decisions, hard constraints, user preferences, and open loops from natural language turns without requiring rigid markdown formatting.
  - Incrementally indexes chats with content-hash ledgers (`.memory/harvested-transcripts.json`) to guarantee zero duplicate re-harvests.
- **Proactive Background Auto-Sync**:
  - `memory ui` automatically synchronizes recent agent transcripts on launch so the visual graph reflects latest conversations immediately.
  - `get_context` in MCP automatically triggers non-blocking incremental transcript harvests on session start.
  - `memory doctor` surfaces real-time unharvested chat counts and diagnostic remediation steps.
- **Enhanced MCP Integration**:
  - `memory_harvest` tool now supports `{ all: true }` and `{ auto: true }` to trigger machine-wide background harvests directly from any connected IDE/CLI agent.

---

## [1.9.0] - 2026-08-31

### Added
- **Autonomous Upgrade & Self-Healing Engine (`memory upgrade` / `memory update`)**:
  - Automatically probes host environment to detect active package managers (`bun`, `npm`, `pnpm`, `yarn`).
  - Fetches the latest published release directly from npm registry and executes seamless global upgrades.
  - Automatically heals corrupted/missing files (`.memory/`, `CURRENT.md`, `USER.md`), auto-wires newly installed agent platforms, and re-indexes AST symbol graphs.
  - Added `--check` flag to inspect upstream updates without applying.
- **Gamified ASCII Level-Up & Onboarding Matrix**:
  - Integrated 5-level animated progress loaders (`[████████████] 100%`) with Level milestones across `memory install`, `memory upgrade`, and `memory uninstall`.
  - TTY-aware with graceful ANSI carriage return animations and clean CI logging fallbacks.
- **Comprehensive Upgrading & Self-Healing Maintenance Guide**: Detailed cross-toolchain upgrade instructions and verification procedures in `README.md`.

---

## [1.8.0] - 2026-08-31

### Added
- **SOW-201: Live Runtime File & Symbol Verification Gate**: Instant sub-millisecond CPU disk check verifying referenced code files in `affected_paths` with `STRONG`, `WEAK`, and `STALE` trust verdicts and scoring adjustments (+0.15 for verified live code, -0.4 for deleted files).
- **SOW-202: Deterministic Relevance Cutoff Gate**: Hard relevance score cutoff ($\text{Score} \ge 0.45$) preventing weakly-related memories from bloating LLM prompt windows and saving 500–2,000 prompt tokens on unrelated queries.
- **SOW-203: Git Code-Drift Scanner (`memory drift` / `memory check` CLI & `memory_drift` MCP tool)**: High-speed Git workspace scanner detecting modified or deleted code files and AST symbols, flagging drifted memories for re-verification or supersession.
- **SOW-204: Gradient-Free Hebbian Co-Activation Plasticity**: Associative synaptic link reinforcement incrementing edge weights (+0.05) when concepts are co-retrieved or confirmed together, enabling natural concept clustering with zero resident daemons.
- **SOW-205: Semantic Memory Prompt Compression (`memory compress` CLI & `memory_compress` MCP tool)**: Lossless prompt compression stripping redundant Markdown whitespace and verbose headers, reducing prompt context token usage by 30–40%.
- **4-Phase Sprint & Roadmap Operating Lifecycle**: Structured sprint pipeline (`Requested` ➔ `Planned` ➔ `In Progress` ➔ `Done`) with top-level Table of Contents and collapsible Roadmap board in `README.md`.

---

## [1.7.1] - 2026-08-30

### Fixed
- **Zero-Friction Global Installation**: Removed obsolete `postinstall` lifecycle hook from `package.json` to prevent package manager untrusted script blocks during `bun add -g musememory` and `npm install -g musememory`.

---

## [1.7.0] - 2026-08-30

### Added
- **Turnkey Agent Memory Skills Suite (`.agents/skills/` & `skills/`)**:
  - **`muse-ground`**: Session start pre-flight grounding injecting `USER.md` persona profile, `CURRENT.md` hard working constraints, and Top-$K$ relevant past decisions/fixes before writing code.
  - **`muse-capture`**: Post-fix and architectural decision distillation with empirical evidence validation, inline Vibeguard secret inspection, and automatic knowledge supersession.
  - **`muse-current`**: Active working constraints and interruption-proof session handoffs directly synchronized to `.memory/CURRENT.md`.
  - **`muse-graph`**: AST CodeGraph & Graphify symbol indexer and code-aware retrieval query optimizer with `+0.2` graph overlap bonus.
  - **`muse-wiki`**: Obsidian-compatible knowledge garden compiler and named entity co-occurrence graph generator.
  - **`muse-brief`**: Proactive daily briefing and knowledge hygiene governor tracking 90/180-day staleness policies and open loops with zero daemons.
- **AST Symbol Graph Integration (SOW-107, Issue #35)**: Pluggable CodeGraph & Graphify symbol provider detection, `memory graph index` symbol map caching under `.memory/graph-symbols.json`, auto-stamping on capture, and `graphSymbolOverlapBonus` (+0.2) in knapsack retrieval.
- **Complete Uninstallation & Removal Workflows**: Added comprehensive clean removal steps with dry-run safety and zero-trace agent unwiring in `README.md`.

---

## [1.6.1] - 2026-08-29

### Security & Hardening
- **Web UI Loopback & CORS CSRF Hardening**: Bound embedded dashboard server strictly to `127.0.0.1` (loopback only) and rejected untrusted third-party `Origin` headers on state-mutating POST endpoints (`HTTP 403 Forbidden`).
- **HTTP Security Headers**: Enforced `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy` across all embedded UI responses.
- **DoS Payload Limiter**: Enforced 1 MB request body streaming limit in `parseJsonBody`, terminating oversized streams to prevent memory exhaustion.
- **Path Traversal Containment**: Enforced strict directory boundary validation in `fileForId` and `slugifyId` to prevent file escape attempts.
- **Vibeguard Secret Scanner Scoping**: Corrected private key block regex precedence to eliminate false positives on technical prose while strictly intercepting actual private key blocks.

### Added & Refined
- **Asynchronous Tree Index Builder (`buildTreeIndexAsync`)**: Added non-blocking microtask-yielding hierarchical tree indexing for large stores.
- **Dynamic Schema Cache Invalidation (`clearSchemaCache`)**: Added exported schema cache reset for dynamic testing and custom schema reloading.
- **Punctuation-Resilient Entity Normalization**: Supported fuzzy entity lookups across punctuation variations (`next.js` $\leftrightarrow$ `nextjs`).
- **Wiki Frontmatter Deserialization**: Implemented robust native array, number, and boolean frontmatter parsing without body duplication.

---

## [1.6.0] - 2026-08-29

### Added
- **MCP Multi-Root Workspace Routing**: Authoritative per-request store routing across multi-root IDE workspaces.
- **CLI Positional Argument Alignment**: Corrected subcommand indexing for `settings` (`get`, `set`, `reset`) and `entities` (`show`, `related`).
- **Stale Command Status Filter**: Added staleness detection for decayed `confirmed` entries past policy lifetimes.
- **AST Symbol Overlap Provider**: Integrated CodeGraph AST symbol co-occurrence provider into the knapsack retrieval scoring engine.

---

## [1.5.0] - 2026-08-29

### Added
- **MemoryStore Shim Removal**: Deleted the deprecated `MemoryStore` class from `src/store.ts`; free functions are now the sole storage surface and `openStore()` returns a plain `Store` object.
- **Scene-Based Hierarchical Consolidation (`memory consolidate`)**: Clusters confirmed memories by (project, type) + weighted token-bag cosine similarity; clusters of ≥3 members become confirmed `Scene:` architecture rollups bidirectionally linked to every member. Idempotent (clusters already covered by a scene are skipped), supports `--project`/`--dry-run`, and is exposed as the `memory_consolidate` MCP tool.
- **Multi-Hop Causality Graph Tracer (`memory trace <id>`)**: Cycle-safe, depth-bounded (default 5) recursive walk of supersedes/superseded_by + related-memory edges, rendered as an indented tree with status/type/age per hop. Pure read path; exposed as the `memory_trace` MCP tool.
- **Ambient Open-Loop Tracker (`memory loops`)**: Read-only prioritized open-loop report grouped by source — workspace git state (uncommitted changes, unmerged local branches; tolerated in non-git dirs), memory-side loops (candidates older than 7 days never confirmed, disputed entries), and active CURRENT.md constraints. Exposed as the `memory_loops` MCP tool.
- **Self-Evolving Skill Distillation (`memory distill`)**: Clusters confirmed fix-type entries by tag overlap + title token similarity; clusters with ≥ `--min-count` (default 3) members become `.agents/skills/<slug>/SKILL.md` folders with frontmatter and deduplicated steps ordered oldest-first. Never overwrites existing skill folders; generated content is Vibeguard secret-scanned; supports `--dry-run`. Exposed as the `memory_distill` MCP tool.
- **Autonomous Verification Oracle (`memory verify <id>`)**: Executes a fix entry's `test_command` (new optional entry field) in the workspace root with a timeout (default 60s). Exit 0 promotes candidates to confirmed and stamps `independently-verified`; non-zero leaves status untouched. Both outcomes audit-logged. Exposed as the `memory_verify` MCP tool.
- **Automated Post-Turn Transcript Harvester Hook**: `memory hook install --git` writes an executable `.git/hooks/pre-commit` invoking `memory harvest-auto` (never clobbers an existing hook; creates nothing else). `memory harvest-auto [--from <glob>]` distills discovered transcripts — explicit glob, else newest `*.jsonl` in the lazily-created `.memory/inbox/` — proposing units strictly as candidates, then archives processed files to `.memory/inbox/processed/` with audit logging.
- **Real-Time Agency Hub (`memory daemon [--port N]`, default 7878)**: Live peer event notifications implemented as Server-Sent Events over plain `node:http` (zero dependencies; same capability as the planned WebSocket hub — SSE chosen because one-way fanout needs no protocol upgrade). `GET /events` streams JSON events; `POST /publish {type,payload}` fans out to all connected peers and echoes `{delivered:N}`; the daemon also fs.watch-debounces `.memory/memories/` and CURRENT.md, broadcasting `memory.changed` / `constraints.changed`.
- **Local Offline Hybrid Vector Engine**: Fully offline hybrid search with zero dependencies — deterministic hashed char-trigram embeddings (256-dim, L2-normalized) fused 0.5/0.5 with BM25 over word tokens. Index persisted at `.memory/index.json` via `memory reindex`; `memory search --hybrid` and the MCP `search` tool's `hybrid` param use it when present, falling back to live scoring (with a reindex hint) otherwise.
- **Knowledge Graph UI v2**: The embedded dashboard's graph is now a 3D force-directed canvas layout (repulsion + springs, perspective projection, drag-to-rotate, wheel-to-zoom) with nodes colored by type and sized by degree, a timeline slider filtering by `updated_at`, cluster filter checkboxes per project/type, and click-to-inspect in the side panel. All existing HTTP endpoints and the data shape stay backward-compatible; empty graphs render a friendly guard message.
- **Bi-Temporal Reinforcement Feedback**: Memory entries gain optional `valid_from`/`valid_to` valid-time stamps and a `reinforcement` counter (+1 on confirm, −1 on stale/reject/supersede). Retrieval decay now uses `valid_from` (event time) when set, and reinforcement adds a bounded ±0.05×min(|n|,5) score adjustment.
- **In-Place Core Memory Partitioning (`memory core`)**: Letta/MemGPT-style permanent operating guidelines in `.memory/CORE.md` across four tiers (`identity`, `directives`, `conventions`, `context`). CLI `memory core <tier> [--set T|--remove|--show]` plus bare listing; new `memory_core` MCP tool; CORE.md content injected into `get_context` between the USER profile and CURRENT constraints sections; Vibeguard secret scan guards writes.
- **Tree-Indexed Retrieval Architecture (`memory search --tree`, `memory_tree_search`)**: Hierarchical partition routing by `(project, type, YYYY-MM)` with automatic depth balancing, progressive disclosure token budgeting (L1/L2/L3), greedy best-first tree traversal, and incremental memory upsert.
- **Markdown Wiki Compilation Engine (`memory wiki [compile|list|show]`, `memory_wiki_*`)**: Compiles confirmed memory clusters into structured, Obsidian-compatible Markdown wiki pages under `.memory/wiki/` (`concepts/`, `entities/`, `index.md`, `log.md`) with bidirectional `[[slug]]` wikilinks and incremental change detection.
- **Named Entity & Concept Extraction (`memory extract-entities`, `memory entities`, `memory_entities_*`)**: Regex-based entity recognition for 5 entity types (`person`, `product`, `organization`, `file`, `concept`), alias normalization, frequency scoring, and co-occurrence relationship building stored in `.memory/entities.json`.
- **PageIndex Native Reasoning Engine (`memory_pageindex_*`)**: Ingests Markdown/text documents (up to 10MB) into hierarchical tree representations with Vibeguard secret inspection, reasoning-based search with explanation trails, and direct memory import conversion.
- **Scaled Graph UI with Barnes-Hut Repulsion & Standalone Export**: 3D force-directed layout upgraded with Barnes-Hut quadtree spatial subdivision for $O(n \log n)$ repulsion scaling on large memory stores ($n > 50$), along with offline standalone HTML export via `exportStandaloneHtml()` and `/api/export-html`.
- **Unified Global & Project Settings Module (`memory settings`, `memory_settings_*`)**: Centralized type-safe settings schema with Zod/AJV validation, directory traversal security guards (`validateSafePath`), file watcher hot-reload, version migrations, and project override scoping.
- **3-Layer Progressive Disclosure**: `get_context` gains a `depth` tier (default L2). L1 = one line per memory (id + title), L2 = current behavior (title + content + tags), L3 = full raw entry with complete metadata block. Exposed via MCP `depth` param and CLI `memory context --depth L1|L2|L3`.

### Changed
- **Shared Command Core (`src/commands/`)**: CLI and MCP now route lifecycle mutations (propose, supersede, confirm, link, mark-stale, reject, delete) and the harvest distillation loop through a single command core with structured results; adapters only parse args and format output. Duplicate MCP handler logic, double secret-scanning, and divergent error strings eliminated.
- **Single Storage Interface**: Free functions in `src/store.ts` are now the sole production surface.
- **Migrator Respects Lifecycle State Machine**: Migration writes now flow through audited store transitions (`markSuperseded`, `markStale`, `addConstraint`) instead of raw status assignment — every migrated entry lands in `audit.jsonl`.
- **Registry-Driven Connectors**: 19 near-identical `connectX()` wrappers collapsed into a factory over the agent registry metadata (468 → 439 LOC, zero behavior change).
- **Deduplicated Root Detection**: Memory-dir suffix detection unified into one shared helper (`src/root.ts`) used by store, migrator, and root bootstrap.
- **Harvest/Snapshot Separation**: Portable JSON snapshot export/import moved to `src/snapshot.ts`; `harvest.ts` keeps transcript distillation.

### Planned (Phase 3 & Beyond)
- **Knowledge Graph UI v2**: 3D force-directed WebGL graph with timeline scrubbing and cluster filtering.

---

## [1.2.0] - 2026-08-22

### Added
- **Zero-Install NPX & BunX Distribution (`npx musememory <cmd>`)**:
  - Single-file standalone Node.js production bundle (`dist/index.js`) supporting instant zero-install execution via `npx` or `bunx` with no global `npm i -g` required.
- **One-Line System Installer & Diagnostic Doctor (`memory install` / `memory doctor`)**:
  - `memory install`: One-line initialization, auto-connecting all detected coding agents and checking legacy memory stores.
  - `memory doctor`: In-depth health check across storage paths, YAML schema validity, credential leaks, MCP auto-approvals, and operational audit trail.
- **Clean Agent Uninstaller (`memory uninstall`)**:
  - Safely unwires memory MCP server from all configured coding agent configs without leaving orphaned configuration entries or damaging user settings.
- **80+ Coding Agent Baseline & Smart Auto-Connect (`memory agents` / `memory connect --all`)**:
  - Comprehensive registry and detector for 80+ terminal coding agents, OpenClaw ecosystems, and major AI IDEs (Claude Code, Cursor, Hermes Agent, OpenCode, OpenClaw, Codex CLI, Gemini CLI, Goose, Continue, Cline, Roo Code, Pi, Crush, Warp, GitHub Copilot, etc.).
  - **Clean Workspace Guarantee**: `memory connect --all` auto-detects installed coding agents and wires MCP **only into installed agents**, leaving out uninstalled systems to prevent generating unwanted files/folders.
  - Dedicated CLI command `memory agents` (alias: `memory detect-agents`) displaying installed, connected, binary, and config paths across all supported agents.
- **Universal Multi-Provider Auto-Detection & Migrator (`memory detect` / `memory migrate`)**:
  - Probes local workspace and machine directories for 24+ external memory formats (AgentMemory, Beads, Mem0, Letta/MemGPT, EverOS, ByteRover, Supermemory, and generic markdown/JSON formats).
  - Deterministic state preservation mapping: `active`/`open` ➔ `confirmed`, `archived`/`closed` ➔ `superseded`, and core constraints/personas ➔ `.memory/CURRENT.md`.
  - Non-destructive `--dry-run`, `--overwrite`, and `--from <provider>` filtering controls.
- **Vibeguard Ingestion Defense**: Real-time secret scanning on all imported memories, masking sensitive credentials as `[REDACTED_SECRET]` during migration.
- **Multi-Runtime Resilient Installer (`scripts/install.sh`)**:
  - Auto-configures Bun, Node.js/NPM (bypassing `EALLOWGIT`), local repository linking, and `$PATH` verification.
- **MCP Agent Tools**: Registered `memory_detect_agents`, `memory_connect`, `memory_detect_providers`, and `memory_migrate` with zero-permission auto-approval across all supported agent platforms.
- **Interactive 24-Provider Comparison Dashboard (`musememory-comparison.html`)**:
  - Standalone dark-mode responsive comparison dashboard with live search, category filter chips, and provider deep-dives.
- **Extended Test Suite**: 107 automated tests passing across 19 test suites with 0 TypeScript static type errors.

---

## [1.1.0] - 2026-08-21

### Added
- **Dynamic Prompt Token Budgeter**: Exact token packing (`--token-budget <N>` / `token_budget` in MCP) using greedy knapsack packing with character heuristics to eliminate prompt bloat.
- **Universal JSONL Transcript Ingestion**: Ingest raw `.jsonl` session transcripts from Claude Code, Antigravity, Cursor, and Codex into structured outcome, decision, and fix units (`memory import-transcript`).
- **Operational Compliance Audit Ledger**: Append-only log (`.memory/audit.jsonl` / `memory audit`) capturing actor, operation, timestamp, and details with `memory delete` tombstone auditing.
- **Zero-Permission Multi-Agent Connect (`memory connect <agent>`)**: Automatically configures MCP settings and pre-approves tools without permission dialogs across Claude Code, Cursor, Antigravity, Windsurf, Codex, and Gemini CLI.
- **Default `.memory/` Storage Path**: Switched default workspace storage to `.memory/` and global storage to `~/.memory/` while preserving backward compatibility with `.musememory/`.
- **Automatic `CURRENT.md` Bootstrapping**: Automatically generates and syncs `.memory/CURRENT.md` hard constraints file upon agent and project initialization.

---

## [1.0.0] - 2026-08-21

### Added
- **Core Storage Engine**: Atomic file write mechanism (`.tmp` + atomic rename) with zero external database dependencies or locks, storing human-readable YAML documents in `.memory/memories/`.
- **Lifecycle State Machine**: Strict lifecycle state transitions (`candidate` ➔ `confirmed` ➔ `superseded` / `stale` / `disputed` / `rejected`) preventing knowledge rot and hallucinations.
- **Outcome & Fix Harvester**: Automated distillation engine (`memory harvest`) extracting root causes, fixes, decisions, constraints, and failures from raw chat logs and transcripts.
- **Mathematical Salience & Relevance Ranker**: Calibrated scoring function combining query applicability, verification level, graph symbols, salience weighting, and exponential temporal decay.
- **Vibeguard Zero-Leakage Secret Defense**: Built-in, pure TypeScript secret scanner intercepting 8 credential classes (API keys, GitHub tokens, NPM tokens, AWS keys, private keys, database connection strings, passwords) before disk write.
- **Deep Store Referential Validator**: Schema and link auditor (`memory validate`) detecting schema violations, broken relation links, missing supersession pointers, and stored credentials.
- **Provider-Neutral Graph AST Integration**: Automatic detection of CodeGraph indices awarding bounded relevance bonuses for matching AST symbols.
- **Embedded Web Dashboard (`memory ui`)**: Self-contained, zero-dependency HTML5 Canvas 2D interactive force-directed knowledge graph and live search inspector running on a native HTTP server.
- **Agency Network Snapshot Sync**: Portable JSON snapshot `export` and `import` for team-wide cross-machine memory synchronization.
- **Dual Tool Surface**: 19 CLI commands with concise `memory` command and conflict-safe `musememory` alias, plus 13 Model Context Protocol (MCP 2024-11-05 stdio) tools for AI agents.
