/**
 * Computes the showreel freshness hash.
 *
 * The Pages deploy fails if the composition has changed without the video
 * being re-rendered. This computes the hash of every input to that render:
 * the composition, the render script, and the fonts it uses.
 *
 * It is a SCRIPT, not an inline shell command, because the hash was once
 * computed from `apps/website/` while CI computed it from the repository
 * root — and `sha256sum` embeds the filename in its output, so the two
 * disagreed and the deploy failed on a freshly rendered video. One
 * implementation, called from both places, removes the whole class of bug.
 *
 * Usage:
 *   bun run scripts/showreel-hash.ts           # print the hash
 *   bun run scripts/showreel-hash.ts --write   # write it to the stored file
 *   bun run scripts/showreel-hash.ts --check   # exit 1 if the stored hash is stale
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

/** Every input to the render, in a fixed order. */
const COMPOSITION = "apps/website/showreel/index.html";
const RENDER_SCRIPT = "apps/website/scripts/build-showreel.ts";
const FONT_DIR = "apps/website/src/assets/fonts";

const STORED = "apps/website/public/brand/.showreel-hash";

function main(): void {
  const hash = createHash("sha256");
  const update = (rel: string) => {
    // The path is part of the hash, and it is always repository-relative —
    // never relative to the caller's working directory.
    hash.update(readFileSync(join(ROOT, rel)));
    hash.update("\0");
  };

  update(COMPOSITION);
  update(RENDER_SCRIPT);
  for (const font of readdirSync(join(ROOT, FONT_DIR)).sort()) {
    if (!font.endsWith(".woff2")) continue;
    update(`${FONT_DIR}/${font}`);
  }

  const digest = hash.digest("hex");

  if (process.argv.includes("--write")) {
    writeFileSync(join(ROOT, STORED), digest + "\n");
    console.log(`wrote ${relative(ROOT, join(ROOT, STORED))} = ${digest}`);
    return;
  }

  if (process.argv.includes("--check")) {
    let stored = "";
    try {
      stored = readFileSync(join(ROOT, STORED), "utf8").trim();
    } catch {
      stored = "";
    }
    if (stored !== digest) {
      console.error(
        `showreel.mp4 is stale — the composition changed without a re-render.\n` +
          `  stored: ${stored || "(none)"}\n` +
          `  actual: ${digest}\n` +
          `Refresh locally with: bun run site:showreel\n` +
          `Then commit the new public/showreel.mp4, showreel-poster.png, and ${STORED}.`,
      );
      process.exit(1);
    }
    console.log("showreel inputs and the rendered video are in sync.");
    return;
  }

  console.log(digest);
}

main();
