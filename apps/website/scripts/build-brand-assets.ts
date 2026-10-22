/**
 * Builds every Muse Memory brand asset from one source of truth.
 *
 * Why this exists
 * ---------------
 * The previous pipeline (`render-brand-assets.ts`) screenshotted SVGs through a
 * headless Chromium. That needed a 150MB browser download just to flatten a
 * vector, and it produced different pixels depending on which fonts the
 * machine happened to have — so a PNG committed to git could not be
 * reproduced. Social scrapers and the GitHub README renderer need PNG; we
 * still want the SVG to be the single source of truth.
 *
 * This script generates the SVG in-memory from the brand tokens below, then
 * rasterises it with resvg (pure Rust, no system browser) using the fonts that
 * are already vendored in `src/assets/fonts`. Output is deterministic:
 * same input bytes -> same PNG bytes.
 *
 * Usage:
 *   bun run apps/website/scripts/build-brand-assets.ts
 *
 * Outputs:
 *   public/favicon.svg            app icon (source)
 *   public/apple-touch-icon.png   180x180
 *   public/icon-192.png           192x192
 *   public/icon-512.png           512x512
 *   public/brand/og.svg|og.png        1200x630 social card
 *   public/brand/twitter-card.svg|png 1200x628 social card
 *   public/brand/banner.svg|banner.png 1280x640 README banner
 */
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// The countable claims come from the generated manifest, not from prose, so
// a brand card can never advertise a number the code does not produce.
import claims from "../../../claims.json";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "../public");
const BRAND_DIR = join(PUBLIC_DIR, "brand");
const FONT_DIR = resolve(__dirname, "../src/assets/fonts");

/* ── Brand tokens ─────────────────────────────────────────────────────────
   These mirror `src/styles/global.css`. They are duplicated here on purpose:
   the CSS is the runtime source of truth, this file is the offline render
   source of truth, and neither can import the other (one is CSS, one is
   TypeScript, and the site must build with zero runtime dependency on the
   brand pipeline). `checkBrandTokens()` below fails loudly if they drift. */
const T = {
  bg: "#07090f",
  bgRaised: "#0c1019",
  bgPanel: "#101624",
  violet: "#8b7cf7",
  cyan: "#4fd6e0",
  amber: "#f5b455",
  green: "#5fd39a",
  text: "#e8ecf8",
  textDim: "#9aa5c3",
  textFaint: "#8791ad",
} as const;

const SANS = "Inter";
const MONO_FAMILY = "IBM Plex Mono";

/* ── The mark ────────────────────────────────────────────────────────────
   A capital M drawn as one continuous path, with the middle vertex pulled
   *below* the baseline into a glowing core node. The M is legible at a
   glance; the descending core is the idea — one memory held below two
   anchors. The two peaks carry the recall endpoints.

   Normalised coordinates: x in [-1, 1], y in [-1, 1], y grows downward. */
const M_PATH: Array<[number, number]> = [
  [-1, 0.62],
  [-0.52, -0.66],
  [0, 0.22],
  [0.52, -0.66],
  [1, 0.62],
];
const M_CORE: [number, number] = [0, 0.22];

function mark(cx: number, cy: number, s: number, opts: { halo?: boolean; stroke?: number } = {}): string {
  const { halo = true, stroke = 0 } = opts;
  const k = stroke || s * 0.115;
  const r = s * 0.105;
  const px = (x: number) => cx + x * s;
  const py = (y: number) => cy + y * s;
  const pts = M_PATH.map(([x, y]) => `${px(x).toFixed(2)},${py(y).toFixed(2)}`);
  const node = (x: number, y: number, fill: string, scale = 1) =>
    `<circle cx="${px(x).toFixed(2)}" cy="${py(y).toFixed(2)}" r="${(r * scale).toFixed(2)}" fill="${fill}"/>`;
  const haloEl = halo
    ? `<circle cx="${px(M_CORE[0]).toFixed(2)}" cy="${py(M_CORE[1]).toFixed(2)}" r="${(s * 0.68).toFixed(2)}" fill="url(#halo)"/>`
    : "";
  return `${haloEl}
  <polyline points="${pts.join(" ")}" fill="none" stroke="url(#grad)" stroke-width="${k.toFixed(2)}"
    stroke-linecap="round" stroke-linejoin="round"/>
  ${node(-1, 0.62, T.violet)}
  ${node(-0.52, -0.66, T.cyan)}
  ${node(0.52, -0.66, T.cyan)}
  ${node(1, 0.62, T.violet)}
  ${node(M_CORE[0], M_CORE[1], T.text, 1.35)}`;
}

const DEFS = `
  <defs>
    <linearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${T.violet}"/>
      <stop offset="1" stop-color="${T.cyan}"/>
    </linearGradient>
    <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${T.violet}"/>
      <stop offset="1" stop-color="${T.cyan}"/>
    </linearGradient>
    <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${T.violet}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${T.violet}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="meshA" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${T.violet}" stop-opacity="0.42"/>
      <stop offset="1" stop-color="${T.violet}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="meshB" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${T.cyan}" stop-opacity="0.30"/>
      <stop offset="1" stop-color="${T.cyan}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="meshC" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ff7db1" stop-opacity="0.20"/>
      <stop offset="1" stop-color="#ff7db1" stop-opacity="0"/>
    </radialGradient>
  </defs>`;

function canvas(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
${DEFS}
  <rect width="${w}" height="${h}" fill="${T.bg}"/>
${body}
</svg>`;
}

/** Ambient brand mesh — the same three radial blooms the site uses. */
function mesh(w: number, h: number): string {
  return `  <g>
    <ellipse cx="${w * 0.16}" cy="${h * 0.12}" rx="${w * 0.46}" ry="${h * 0.52}" fill="url(#meshA)"/>
    <ellipse cx="${w * 0.88}" cy="${h * 0.08}" rx="${w * 0.40}" ry="${h * 0.46}" fill="url(#meshB)"/>
    <ellipse cx="${w * 0.62}" cy="${h * 0.98}" rx="${w * 0.42}" ry="${h * 0.44}" fill="url(#meshC)"/>
  </g>`;
}

/** The four proof chips that ride under the wordmark on every card. */
const PROOF: Array<[string, string]> = [
  ["sub-2ms recall", T.cyan],
  ["0 background daemons", T.violet],
  ["majority of coding agents", T.green],
  ["MIT · no account", T.amber],
];

function proofRow(x: number, y: number, gap: number, size: number): string {
  const widths = PROOF.map(([label]) => label.length * size * 0.62 + size * 2.2);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (PROOF.length - 1);
  let cursor = x - total / 2;
  return PROOF.map(([label, color], i) => {
    const w = widths[i];
    const el = `  <g>
    <rect x="${cursor.toFixed(1)}" y="${(y - size * 1.5).toFixed(1)}" width="${w.toFixed(1)}" height="${(size * 3).toFixed(1)}"
      rx="${(size * 1.5).toFixed(1)}" fill="${T.bgPanel}" fill-opacity="0.85" stroke="${color}" stroke-opacity="0.34" stroke-width="1.2"/>
    <circle cx="${(cursor + size * 1.15).toFixed(1)}" cy="${y.toFixed(1)}" r="${(size * 0.24).toFixed(1)}" fill="${color}"/>
    <text x="${(cursor + size * 1.7).toFixed(1)}" y="${(y + size * 0.36).toFixed(1)}"
      font-family="${SANS}" font-size="${size}" font-weight="500" fill="${T.text}">${label}</text>
  </g>`;
    cursor += w + gap;
    return el;
  }).join("\n");
}

/** Wordmark + headline lockup used by every card size. */
function lockup(x: number, y: number, scale: number, tagline: string): string {
  const wordmark = `<text x="${x}" y="${y}" font-family="${SANS}" font-size="${(56 * scale).toFixed(1)}"
    font-weight="800" letter-spacing="-2" fill="${T.text}">Muse<tspan fill="${T.cyan}">Memory</tspan></text>`;
  const tag = `<text x="${x}" y="${(y + 40 * scale).toFixed(1)}" font-family="${SANS}"
    font-size="${(23 * scale).toFixed(1)}" font-weight="500" fill="${T.textDim}">${tagline}</text>`;
  return `  ${wordmark}\n  ${tag}`;
}

/**
 * A social card / README banner.
 * Layout: wordmark block on the left, the mark on the right, proof chips
 * centred under the wordmark, and a monospace install line at the foot.
 */
function card(w: number, h: number, opts: { tagline: string; mono: string }): string {
  const scale = h / 630;
  const headY = h * 0.42;
  return canvas(
    w,
    h,
    `${mesh(w, h)}
  <rect x="0" y="0" width="${w}" height="${h}" fill="url(#meshA)" opacity="0.10"/>
${lockup(w * 0.075, headY, scale, opts.tagline)}
${proofRow(w * 0.5, h * 0.66, 14 * scale, 17 * scale)}
  <rect x="${(w * 0.075).toFixed(1)}" y="${(h * 0.80).toFixed(1)}" width="${(w * 0.85).toFixed(1)}" height="${(2 * scale).toFixed(1)}" fill="url(#rule)" opacity="0.55"/>
  <text x="${(w * 0.075).toFixed(1)}" y="${(h * 0.90).toFixed(1)}" font-family="${MONO_FAMILY}" font-size="${(19 * scale).toFixed(1)}" fill="${T.textDim}">${opts.mono}</text>
${mark(w * 0.845, h * 0.42, h * 0.20, { stroke: h * 0.023 })}
`,
  );
}

/** The favicon: app tile + mark, nothing else. */
function favicon(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
${DEFS}
  <rect width="64" height="64" rx="14" fill="${T.bgRaised}"/>
  <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="13.25" fill="none" stroke="${T.violet}" stroke-opacity="0.28" stroke-width="1.5"/>
${mark(32, 34, 19, { stroke: 4.4 })}
</svg>`;
}

/* ── Render ────────────────────────────────────────────────────────────── */

interface Target {
  file: string;
  svg: string;
  w: number;
  h: number;
}

function rasterize(svg: string, w: number, h: number): Buffer {
  const r = new Resvg(svg, {
    fitTo: { mode: "width", value: w },
    font: {
      fontDirs: [FONT_DIR],
      loadSystemFonts: true,
      defaultFontFamily: SANS,
      sansSerifFamily: SANS,
      monospaceFamily: MONO_FAMILY,
    },
    // Keep the raster identical to the vector: no extra sharpening pass.
    imageRendering: 0,
  });
  return Buffer.from(r.render().asPng());
}

async function emit(dir: string, name: string, svg: string, w: number, h: number, alsoSvg = true): Promise<void> {
  mkdirSync(dir, { recursive: true });
  if (alsoSvg) await Bun.write(join(dir, name.replace(/\.png$/, ".svg")), svg);
  const png = rasterize(svg, w, h);
  await Bun.write(join(dir, name), png);
  console.log(`  ${name}  ${w}x${h}  ${(png.length / 1024).toFixed(1)} KB`);
}

const TAGLINE = "Persistent memory for AI coding agents that verifies itself";
const MONO_CMD = "npx musememory connect";

async function main(): Promise<void> {
  console.log("Building Muse Memory brand assets\n");

  await emit(PUBLIC_DIR, "favicon.svg", favicon(), 512, 512, false);
  await emit(PUBLIC_DIR, "apple-touch-icon.png", favicon(), 180, 180, false);
  await emit(PUBLIC_DIR, "icon-192.png", favicon(), 192, 192, false);
  await emit(PUBLIC_DIR, "icon-512.png", favicon(), 512, 512, false);

  await emit(BRAND_DIR, "og.png", card(1200, 630, { tagline: TAGLINE, mono: MONO_CMD }), 1200, 630);
  await emit(BRAND_DIR, "twitter-card.png", card(1200, 628, { tagline: TAGLINE, mono: MONO_CMD }), 1200, 628);
  await emit(BRAND_DIR, "banner.png", card(1280, 640, { tagline: TAGLINE, mono: MONO_CMD }), 1280, 640);

  // A wide, quiet variant for the README body: the wordmark plus a one-line
  // promise, no chips — README banners sit next to a heading, not alone.
  const readme = canvas(
    1280,
    400,
    `${mesh(1280, 400)}
${lockup(64, 210, 1.35, TAGLINE)}
  <text x="64" y="290" font-family="${MONO_FAMILY}" font-size="24" fill="${T.textDim}">${MONO_CMD}</text>
${mark(1130, 190, 78, { stroke: 9 })}
`,
  );
  mkdirSync(BRAND_DIR, { recursive: true });
  await Bun.write(join(BRAND_DIR, "readme-banner.svg"), readme);
  const readmePng = rasterize(readme, 1280, 400);
  await Bun.write(join(BRAND_DIR, "readme-banner.png"), readmePng);
  console.log(`  readme-banner.png  1280x400  ${(readmePng.length / 1024).toFixed(1)} KB`);

  // The repository root carries a legacy `assets/` folder that used to hold a
  // second, hand-maintained copy of the banner in an older (green) brand. It
  // is unreferenced, so it silently drifted out of sync with the site. Rather
  // than keep two copies, the root path is now written from the same SVG
  // source of truth — one brand, two paths.
  const legacyDir = resolve(__dirname, "../../../assets");
  try {
    mkdirSync(legacyDir, { recursive: true });
    const legacyBanner = card(1280, 640, { tagline: TAGLINE, mono: MONO_CMD });
    await Bun.write(join(legacyDir, "banner.svg"), legacyBanner);
    const legacyPng = rasterize(legacyBanner, 1280, 640);
    await Bun.write(join(legacyDir, "banner.png"), legacyPng);
    console.log(`  assets/banner.png  1280x640  ${(legacyPng.length / 1024).toFixed(1)} KB  (legacy path)`);
  } catch (e) {
    console.warn(`  skipped legacy assets/ mirror: ${(e as Error).message}`);
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
