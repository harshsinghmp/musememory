/**
 * CycloneDX 1.7 SBOM + SHA256SUMS generator.
 *
 * Why this exists
 * ---------------
 * Releases published a tarball and `--provenance` (good) but attached no
 * dependency inventory, no checksums and no record of the one artefact the
 * JavaScript build graph never sees. `sqlite-vec` is a native, in-process
 * extension loaded at runtime from `node_modules`, and `bun run build` marks it
 * `--external`, so the bundler never reads it and no lockfile-derived SBOM can
 * name it. Build provenance says who built what, not what is inside it — the
 * 2026 incident class (Mini Shai-Hulud, Miasma) defeated provenance
 * attestation. Hence: inventory the runtime dependencies, and hash the native
 * extension the bundle loads.
 *
 * What it emits
 * -------------
 * - `dist/bom.cdx.json` — CycloneDX 1.7 JSON. `components[]` holds every
 *   runtime dependency in `package.json` at its **installed** version (read
 *   from `node_modules/<pkg>/package.json`, never the declared range), plus the
 *   platform package that carries the native binary (`sqlite-vec-linux-x64`,
 *   `sqlite-vec-darwin-arm64`, …) as its own component with the SHA-256 of the
 *   loadable file.
 * - `dist/SHA256SUMS` (`--checksums`) — `sha256sum -c`-compatible lines for
 *   `dist/index.js` and the generated BOM.
 *
 * Usage:
 *   bun scripts/generate-sbom.ts                      # write dist/bom.cdx.json
 *   bun scripts/generate-sbom.ts --checksums          # write the BOM, then dist/SHA256SUMS
 *   bun scripts/generate-sbom.ts --check              # verify the inventory, write nothing
 *   bun scripts/generate-sbom.ts --out /tmp/bom.json  # alternate output path (tests)
 *   bun scripts/generate-sbom.ts --checksums --out /tmp/bom.json --artifact /tmp/index.js
 *
 * `--check` exits 1 when the native extension cannot be required, when
 * `getLoadablePath()` returns a file that is not there, or when the hash
 * cannot be computed. A release with an unverifiable native binary is worse
 * than a release with no SBOM, because the SBOM would assert something false.
 *
 * The generated files are build output: `dist/` is gitignored and no BOM is
 * ever committed. A committed BOM goes stale the moment a dependency moves,
 * and nothing would notice.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

/** The specification revision ECMA-424 / CycloneDX 1.7 (2025-10-21). */
export const SPEC_VERSION = "1.7";

const DEFAULT_OUT = join(ROOT, "dist", "bom.cdx.json");
const DEFAULT_ARTIFACT = join(ROOT, "dist", "index.js");

interface InstalledPackage {
  name: string;
  version: string;
  license?: string;
  description?: string;
}

export interface NativeExtension {
  /** Package that owns the binary, e.g. `sqlite-vec-linux-x64`. */
  packageName: string;
  version: string;
  /** Absolute path returned by `getLoadablePath()`. */
  loadablePath: string;
  /** Path relative to the repository root, for humans and for CI logs. */
  relativePath: string;
  sha256: string;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** `@scope/name` -> `%40scope/name`, as purl requires. */
export function toPurl(name: string, version: string): string {
  const encoded = name.startsWith("@") ? `%40${name.slice(1)}` : name;
  return `pkg:npm/${encoded}@${version}`;
}

/** Read `<root>/node_modules/<name>/package.json`; throws when it is absent. */
function installedPackage(name: string): InstalledPackage {
  const manifest = join(ROOT, "node_modules", name, "package.json");
  if (!existsSync(manifest)) {
    throw new Error(
      `runtime dependency "${name}" is not installed at ${manifest} — run \`bun install\` before generating an SBOM`,
    );
  }
  const pkg = readJson<{ version?: string; license?: string; description?: string }>(manifest);
  if (!pkg.version) throw new Error(`${manifest} has no "version" field`);
  return { name, version: pkg.version, license: pkg.license, description: pkg.description };
}

/**
 * Locate and hash the native extension `sqlite-vec` loads.
 *
 * `getLoadablePath()` is the authoritative answer — it is the exact file the
 * runtime hands to SQLite — so this asks the package rather than guessing a
 * filename. The owning platform package is derived from the path because Bun
 * stores it under `node_modules/.bun/<pkg>@<version>/node_modules/<pkg>/`.
 */
export function resolveNativeExtension(): NativeExtension {
  let loadablePath: string;
  try {
    const mod = require("sqlite-vec") as { getLoadablePath?: () => string };
    if (typeof mod.getLoadablePath !== "function") {
      throw new Error("sqlite-vec does not export getLoadablePath()");
    }
    loadablePath = mod.getLoadablePath();
  } catch (err) {
    throw new Error(
      `cannot resolve the sqlite-vec native extension: ${(err as Error).message}. ` +
        `It is an optional, platform-specific binary; an SBOM that omits it hides the one artefact the JS build never sees.`,
    );
  }
  if (!loadablePath || !existsSync(loadablePath)) {
    throw new Error(`sqlite-vec getLoadablePath() returned ${JSON.stringify(loadablePath)}, which does not exist`);
  }

  const sha256 = sha256File(loadablePath);

  // Take the last `/node_modules/<pkg>/` segment of the resolved path.
  const matches = [...loadablePath.matchAll(/[/\\]node_modules[/\\]((?:@[^/\\]+[/\\])?[^/\\]+)[/\\]/g)];
  const last = matches.at(-1);
  const packageName = last?.[1]?.replace(/\\/g, "/") ?? `sqlite-vec-${process.platform}-${process.arch}`;

  let version = "unknown";
  if (last) {
    const pkgDir = loadablePath.slice(0, (last.index ?? 0) + last[0].length - 1);
    const manifest = join(pkgDir, "package.json");
    if (existsSync(manifest)) version = readJson<{ version?: string }>(manifest).version ?? "unknown";
  }
  if (version === "unknown") {
    // Fall back to the wrapper's own optionalDependencies table.
    try {
      const wrapper = installedPackage("sqlite-vec");
      const declared = readJson<{ optionalDependencies?: Record<string, string> }>(
        join(ROOT, "node_modules", "sqlite-vec", "package.json"),
      ).optionalDependencies?.[packageName];
      if (declared) version = declared;
      void wrapper;
    } catch {
      /* the wrapper is missing too — the caller's error message is clearer */
    }
  }

  return {
    packageName,
    version,
    loadablePath,
    relativePath: loadablePath.startsWith(ROOT + "/") ? loadablePath.slice(ROOT.length + 1) : loadablePath,
    sha256,
  };
}

/** Deterministic serial number so regenerating an unchanged tree is byte-stable. */
function serialNumber(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export interface BomResult {
  bom: Record<string, unknown>;
  native: NativeExtension;
  root: { name: string; version: string };
  components: { name: string; version: string }[];
}

/**
 * Build the BOM in memory. Throws when a runtime dependency is missing or the
 * native extension cannot be resolved — never emits a partial inventory.
 */
export function buildBom(options: { now?: Date } = {}): BomResult {
  const rootPkg = readJson<{ name?: string; version?: string; dependencies?: Record<string, string> }>(
    join(ROOT, "package.json"),
  );
  const rootName = rootPkg.name ?? "musememory";
  const rootVersion = rootPkg.version ?? "0.0.0";
  const runtimeDeps = Object.keys(rootPkg.dependencies ?? {}).sort();

  const components: Record<string, unknown>[] = [];
  const listed: { name: string; version: string }[] = [];

  for (const name of runtimeDeps) {
    const pkg = installedPackage(name);
    listed.push({ name: pkg.name, version: pkg.version });
    components.push({
      type: "library",
      "bom-ref": toPurl(pkg.name, pkg.version),
      name: pkg.name,
      version: pkg.version,
      purl: toPurl(pkg.name, pkg.version),
      scope: "required",
      ...(pkg.license ? { licenses: [{ license: { id: pkg.license } }] } : {}),
      ...(pkg.description ? { description: pkg.description } : {}),
      externalReferences: [
        { type: "distribution", url: `https://registry.npmjs.org/${pkg.name}/-/${basename(pkg.name)}-${pkg.version}.tgz` },
      ],
      properties: [{ name: "muse:declared-range", value: rootPkg.dependencies?.[name] ?? "" }],
    });
  }

  const native = resolveNativeExtension();

  // The platform package is a component in its own right: it is what npm
  // installs, what the lockfile records, and what carries the binary.
  components.push({
    type: "library",
    "bom-ref": toPurl(native.packageName, native.version),
    name: native.packageName,
    version: native.version,
    purl: toPurl(native.packageName, native.version),
    scope: "required",
    hashes: [{ alg: "SHA-256", content: native.sha256 }],
    externalReferences: [
      {
        type: "distribution",
        url: `https://registry.npmjs.org/${native.packageName}/-/${native.packageName}-${native.version}.tgz`,
      },
    ],
    properties: [
      { name: "muse:native-extension", value: "true" },
      { name: "muse:native-extension-path", value: native.relativePath },
      { name: "muse:native-extension-loaded-by", value: "sqlite-vec" },
      { name: "muse:native-extension-platform", value: `${process.platform}-${process.arch}` },
    ],
  });
  listed.push({ name: native.packageName, version: native.version });

  // Honour SOURCE_DATE_EPOCH so a rebuild of the same tree is byte-identical.
  const epochSeconds = Number(process.env.SOURCE_DATE_EPOCH);
  const now = options.now ?? (Number.isFinite(epochSeconds) ? new Date(epochSeconds * 1000) : new Date());

  const bom: Record<string, unknown> = {
    bomFormat: "CycloneDX",
    specVersion: SPEC_VERSION,
    serialNumber: serialNumber(`${rootName}@${rootVersion}`),
    version: 1,
    metadata: {
      timestamp: now.toISOString(),
      component: {
        type: "application",
        "bom-ref": toPurl(rootName, rootVersion),
        name: rootName,
        version: rootVersion,
        purl: toPurl(rootName, rootVersion),
      },
      // `tool` is the pre-1.5 single-tool key (deprecated, still read by older
      // consumers and named in issue #517); `tools.components` is the 1.5+
      // form. Both are emitted so neither reader comes up empty.
      tool: { vendor: "musememory", name: "scripts/generate-sbom.ts", version: rootVersion },
      tools: {
        components: [{ type: "application", name: "scripts/generate-sbom.ts", version: rootVersion }],
      },
    },
    components,
  };

  return { bom, native, root: { name: rootName, version: rootVersion }, components: listed };
}

/** Write `<dir>/SHA256SUMS` for the release artefacts, `sha256sum -c` format. */
export function writeChecksums(files: string[], outFile: string): { name: string; sha256: string }[] {
  const missing = files.filter((f) => !existsSync(f));
  if (missing.length) {
    throw new Error(
      `cannot checksum missing release artefact(s): ${missing.join(", ")} — run \`bun run build\` first`,
    );
  }
  const rows = files.map((file) => ({ name: basename(file), sha256: sha256File(file) }));
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, rows.map((r) => `${r.sha256}  ${r.name}`).join("\n") + "\n");
  return rows;
}

function usage(): void {
  console.log(`Usage: bun scripts/generate-sbom.ts [options]

  --out <path>        SBOM output path (default: dist/bom.cdx.json)
  --checksums         also write SHA256SUMS next to the SBOM
  --artifact <path>   release artefact to checksum (default: dist/index.js, repeatable)
  --check             verify the inventory and the native hash, write nothing
  --quiet             only errors
  -h, --help          this message

Exit codes: 0 ok, 1 the native extension or a runtime dependency could not be
resolved (or --check found a problem), 2 bad invocation.`);
}

function main(argv: string[]): number {
  const out = { bomPath: DEFAULT_OUT, checksums: false, check: false, artifacts: [DEFAULT_ARTIFACT], quiet: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error(`${arg} needs a value`);
      i += 1;
      return resolve(next);
    };
    if (arg === "--out") out.bomPath = value();
    else if (arg === "--artifact") {
      const artifact = value();
      if (out.artifacts.length === 1 && out.artifacts[0] === DEFAULT_ARTIFACT) out.artifacts = [];
      out.artifacts.push(artifact);
    } else if (arg === "--checksums") out.checksums = true;
    else if (arg === "--check") out.check = true;
    else if (arg === "--quiet") out.quiet = true;
    else if (arg === "--help" || arg === "-h") {
      usage();
      return 0;
    } else {
      console.error(`generate-sbom: unknown argument "${arg}"`);
      usage();
      return 2;
    }
  }

  try {
    const result = buildBom();
    if (!out.quiet) {
      console.log(`CycloneDX ${SPEC_VERSION}: ${result.components.length} components`);
      for (const c of result.components) console.log(`  ${c.name}@${c.version}`);
      console.log(`native: ${result.native.packageName}@${result.native.version} ${result.native.sha256}`);
    }

    if (out.check) {
      console.log("generate-sbom: inventory and native extension verified");
      return 0;
    }

    mkdirSync(dirname(out.bomPath), { recursive: true });
    writeFileSync(out.bomPath, JSON.stringify(result.bom, null, 2) + "\n");
    console.log(`Wrote ${out.bomPath}`);

    if (out.checksums) {
      const sumsPath = join(dirname(out.bomPath), "SHA256SUMS");
      const rows = writeChecksums([...out.artifacts, out.bomPath], sumsPath);
      for (const row of rows) console.log(`  ${row.sha256}  ${row.name}`);
      console.log(`Wrote ${sumsPath}`);
    }
    return 0;
  } catch (err) {
    console.error(`generate-sbom: ${(err as Error).message}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
