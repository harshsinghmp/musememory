/**
 * Renders the SVG brand assets to PNG for README/OG compatibility.
 * SVG alone is not reliable in GitHub READMEs (no <text> on some renderers)
 * or in social scrapers (most don't support SVG at all) — PNG is required.
 *
 * Usage: bun run apps/website/scripts/render-brand-assets.ts
 */
import { chromium } from "playwright-core";
import { readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRAND_DIR = resolve(__dirname, "../public/brand");

function chromiumPath(): string {
  const base = join(process.env.HOME || "", ".cache", "ms-playwright");
  for (const dir of readdirSync(base)) {
    if (dir.startsWith("chromium_headless_shell-")) {
      return join(base, dir, "chrome-headless-shell-linux64", "chrome-headless-shell");
    }
  }
  throw new Error("chromium headless shell not found — bunx playwright install chromium");
}

const targets = [
  { svg: "og.svg", png: "og.png", w: 1200, h: 630 },
  { svg: "banner.svg", png: "banner.png", w: 1280, h: 640 },
  { svg: "og.svg", png: "twitter-card.png", w: 1200, h: 628 }, // 2:1-ish variant
];

async function main() {
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox"] });

  for (const t of targets) {
    const page = await browser.newPage({ viewport: { width: t.w, height: t.h }, deviceScaleFactor: 1 });
    await page.goto(`file://${join(BRAND_DIR, t.svg)}`, { waitUntil: "networkidle" });
    // Fonts: Inter loads only if installed; fallbacks are fine for scrapers.
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(BRAND_DIR, t.png), clip: { x: 0, y: 0, width: t.w, height: t.h } });
    console.log(`rendered ${t.png}`);
    await page.close();
  }

  await browser.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
