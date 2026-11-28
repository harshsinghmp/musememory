# TypeScript 7 migration — scope

**Status:** scoped on `chore/typescript-7-scope` (draft PR). **Not merged.**
**Date:** 2026-11-29

## What changes

TypeScript 7 is the native (Go) compiler line, shipped as a set of platform
binaries. The only source change is the dev dependency:

```diff
-    "typescript": "^5.6.0"
+    "typescript": "7.0.2"
```

`bun.lock` gains 21 `@typescript/typescript-<os>-<arch>` entries. Consumers never
see this — it is a devDependency and the npm package ships compiled output.

## Evidence (this machine, linux x64)

| Check | TS 5.9.3 | TS 7.0.2 |
| --- | --- | --- |
| `tsc --noEmit` result | 0 errors | **0 errors, 0 output** |
| `tsc --noEmit` wall time | 9.44 s | **2.11 s** |
| `bun run build` | 2.36 MB | 2.36 MB (Bun bundles; tsc is only the gate) |
| `bunx tsc --version` | 5.9.3 | 7.0.2 |

`tsconfig.json` is accepted as-is: `target ES2022`, `module ESNext`,
`moduleResolution bundler`, `strict`, `noEmit`, `esModuleInterop`, `skipLibCheck`,
`allowImportingTsExtensions`, `resolveJsonModule`, `types: ["bun"]`. No removed
flags and no new diagnostics.

## Risks

1. **Platform matrix.** Only linux x64 was exercised here. The native binaries
   exist for macOS and Windows, but CI should prove the other runners before
   this merges.
2. **Editors do not follow automatically.** VS Code ships its own language
   service; installing TS 7 changes the CLI gate (`bunx tsc`) and anyone using
   the workspace TS, not the editor's bundled copy. Document the difference so
   diagnostics do not diverge silently.
3. **Native package size and supply chain.** 21 platform packages enter the
   lockfile (only the matching one installs). They are part of the TypeScript
   release, not third-party, but they are new lock entries and should be
   reviewed once.
4. **No emit.** The project never calls `tsc` to emit and Bun does the bundling,
   so the compiler's code-generation changes cannot affect the shipped bundle.

## Decision

Green on every check that matters, with a 4.5× speed-up on the only compiler
step CI runs. It is still a compiler major: merge it in its own PR after the
CI matrix proves macOS and Windows, not inside a feature branch. The rollback is
one dependency line plus the lockfile.

## Next steps

1. Run the CI matrix on this branch (linux, macOS, windows) and confirm
   `tsc --noEmit` on each.
2. Add a note to `CONTRIBUTING.md` that the workspace TypeScript is authoritative
   for the CLI gate and editors may differ.
3. Merge as a dev-only change; no release note beyond the dependency entry.
