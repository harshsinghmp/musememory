/**
 * Run Astro's CLI with Node instead of Bun.
 *
 * Astro 7's prerenderer named-imports from `cookie` (ESM). Bun's CJS/ESM
 * interop rejects that import, while Node resolves it correctly. The site
 * scripts therefore delegate to Node; the rest of the repository stays on Bun.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("astro/package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.astro;
const cli = join(dirname(pkgPath), bin || "astro.js");

const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(result.status ?? 1);
