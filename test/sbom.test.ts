import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SCRIPT = join(ROOT, "scripts", "generate-sbom.ts");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[]): RunResult {
  const proc = Bun.spawnSync(["bun", SCRIPT, ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, SOURCE_DATE_EPOCH: "1790000000" },
  });
  return { code: proc.exitCode ?? -1, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

const rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  version?: string;
};

interface BomComponent {
  type?: string;
  name?: string;
  version?: string;
  purl?: string;
  hashes?: { alg?: string; content?: string }[];
  properties?: { name?: string; value?: string }[];
}

interface Bom {
  bomFormat?: string;
  specVersion?: string;
  metadata?: { tool?: { name?: string; version?: string }; tools?: { components?: { name?: string }[] } };
  components?: BomComponent[];
}

/**
 * The release inventory is only worth anything if it names what actually runs.
 *
 * `sqlite-vec` is loaded as a native extension at runtime and marked
 * `--external` in `bun run build`, so it is invisible to every lockfile-derived
 * dependency graph — the one component a build-time SBOM would silently omit.
 * These tests run the real generator and read what it wrote, because a unit
 * test of a helper would not catch a component that was never emitted.
 */
describe("release SBOM", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "muse-sbom-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function generateBom(): Bom {
    const out = join(dir, "bom.cdx.json");
    const result = run(["--out", out, "--quiet"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(existsSync(out)).toBe(true);
    return JSON.parse(readFileSync(out, "utf8")) as Bom;
  }

  test("emits CycloneDX 1.7 with the tool and every runtime dependency", () => {
    const bom = generateBom();

    expect(bom.bomFormat).toBe("CycloneDX");
    expect(bom.specVersion).toBe("1.7");
    expect(bom.metadata?.tool?.name).toBe("scripts/generate-sbom.ts");
    expect(bom.metadata?.tools?.components?.[0]?.name).toBe("scripts/generate-sbom.ts");

    const names = new Set((bom.components ?? []).map((c) => c.name));
    const runtime = Object.keys(rootPkg.dependencies ?? {});
    expect(runtime.length).toBeGreaterThan(0);
    for (const dep of runtime) expect(names).toContain(dep);

    // The installed version, not the declared range: a caret range in the BOM
    // would leave a consumer unable to say which build it describes.
    for (const component of bom.components ?? []) {
      expect(component.version).toBeTruthy();
      expect(component.version!.startsWith("^")).toBe(false);
      expect(component.version!.startsWith("~")).toBe(false);
      expect(component.purl).toBe(
        `pkg:npm/${component.name!.startsWith("@") ? `%40${component.name!.slice(1)}` : component.name}@${component.version}`,
      );
    }
  });

  test("includes the sqlite-vec native extension with its own SHA-256", () => {
    const bom = generateBom();
    const native = (bom.components ?? []).find((c) =>
      (c.properties ?? []).some((p) => p.name === "muse:native-extension" && p.value === "true"),
    );

    expect(native).toBeDefined();
    expect(native!.name!.startsWith("sqlite-vec-")).toBe(true);
    expect(native!.hashes?.[0]?.alg).toBe("SHA-256");
    expect(native!.hashes?.[0]?.content).toMatch(/^[0-9a-f]{64}$/);

    // The hash in the BOM must be the hash of the file the runtime loads.
    const pathProperty = (native!.properties ?? []).find((p) => p.name === "muse:native-extension-path");
    expect(pathProperty?.value).toBeTruthy();
    const nativePath = join(ROOT, pathProperty!.value!);
    expect(existsSync(nativePath)).toBe(true);
    const digest = new Bun.CryptoHasher("sha256").update(readFileSync(nativePath)).digest("hex");
    expect(native!.hashes![0]!.content).toBe(digest);
  });

  test("writes SHA256SUMS covering the bundle and the BOM", () => {
    const out = join(dir, "bom.cdx.json");
    const artifact = join(dir, "index.js");
    writeFileSync(artifact, "console.log('built bundle placeholder');\n");

    const result = run(["--out", out, "--checksums", "--artifact", artifact, "--quiet"]);
    expect(result.code).toBe(0);

    const sumsPath = join(dir, "SHA256SUMS");
    expect(existsSync(sumsPath)).toBe(true);
    const lines = readFileSync(sumsPath, "utf8").trim().split("\n");

    expect(lines.every((line) => /^[0-9a-f]{64} {2}\S+$/.test(line))).toBe(true);
    const names = lines.map((line) => line.slice(66));
    expect(names).toContain("index.js");
    expect(names).toContain("bom.cdx.json");

    const artifactLine = lines.find((line) => line.endsWith("  index.js"))!;
    const digest = new Bun.CryptoHasher("sha256").update(readFileSync(artifact)).digest("hex");
    expect(artifactLine.slice(0, 64)).toBe(digest);
  });

  test("--check verifies the native extension without writing an SBOM", () => {
    const out = join(dir, "check-only.cdx.json");
    const result = run(["--check", "--out", out, "--quiet"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("verified");
    expect(existsSync(out)).toBe(false);
  });

  test("a missing checksum artefact fails instead of releasing a partial manifest", () => {
    const result = run(["--out", join(dir, "bom.cdx.json"), "--checksums", "--artifact", join(dir, "absent.js"), "--quiet"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("absent.js");
  });
});

/**
 * The fixture convention's machine-checkable half: the allowlist in
 * `.gitleaks.toml` may exempt synthetic fixtures under `test/` and `docs/`,
 * and nothing else. An allowlist that grew to cover `src/` would turn the
 * scanner off where it matters.
 */
describe("secret scanner allowlist", () => {
  test(".gitleaks.toml exists and only allowlists test/ and docs/ paths", () => {
    const configPath = join(ROOT, ".gitleaks.toml");
    expect(existsSync(configPath)).toBe(true);
    const text = readFileSync(configPath, "utf8");

    // It must build on the default rules, not replace them.
    expect(text).toContain("useDefault = true");

    const block = text.match(/paths\s*=\s*\[([\s\S]*?)\]/);
    expect(block).not.toBeNull();
    const patterns = [...block![1]!.matchAll(/(?:'''|"|')([^'"]+)(?:'''|"|')/g)].map((m) => m[1]!);
    expect(patterns.length).toBeGreaterThan(0);
    for (const pattern of patterns) {
      expect(pattern).toMatch(/^\^(test|docs)\//);
    }
  });
});
