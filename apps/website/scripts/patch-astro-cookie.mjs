/**
 * Work around an Astro 7 packaging bug: its cookies module named-imports
 * `parseCookie`/`stringifySetCookie` from `cookie`, which Node loads as a
 * CommonJS module whose named exports are not statically detectable. Rewrite
 * the import to the default-export form. Idempotent; runs before every build.
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const astroDir = dirname(require.resolve("astro/package.json"));
const file = join(astroDir, "dist", "core", "cookies", "cookies.js");

const original = 'import { parseCookie, stringifySetCookie } from "cookie";';
const previous = 'import cookieModule from "cookie";\nconst { parseCookie, stringifySetCookie } = cookieModule;';
const patched = 'import * as cookieModule from "cookie";\nconst { parseCookie, stringifySetCookie } = cookieModule;';

let source = readFileSync(file, "utf8");
if (source.includes(original) || source.includes(previous)) {
  source = source.replace(original, patched).replace(previous, patched);
  writeFileSync(file, source);
  console.log("patched Astro cookie import");
}
