/**
 * WCAG 2.2 AA audit for the Muse Memory site.
 *
 * 1. axe-core against every built page (zero critical/serious tolerance,
 *    per .agents/brand/a11y.md).
 * 2. Manual computed-contrast verification of every text/background token
 *    pair actually used (axe only samples rendered pairs; this checks the
 *    token system itself, incl. gradient fallbacks and table cells).
 *
 * Usage: bun run apps/website/scripts/audit-a11y.ts
 */
import { chromium } from "playwright-core";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, "../dist");

function chromiumPath(): string {
  const base = join(process.env.HOME || "", ".cache", "ms-playwright");
  for (const dir of readdirSync(base)) {
    if (dir.startsWith("chromium_headless_shell-")) {
      return join(base, dir, "chrome-headless-shell-linux64", "chrome-headless-shell");
    }
  }
  throw new Error("chromium headless shell not found");
}

// ─── Contrast math ───────────────────────────────────────────────────────────
function parseColor(raw: string): [number, number, number, number] {
  // Handles #rgb/#rrggbb and rgb()/rgba() as returned by getComputedStyle.
  const m = raw.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b, a = "1"] = m[1].split(",").map((s) => parseFloat(s.trim()));
    return [r, g, b, a];
  }
  const hex = raw.replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
    1,
  ];
}

function composite(fg: [number, number, number, number], bg: [number, number, number, number]): [number, number, number] {
  const a = fg[3];
  return [
    fg[0] * a + bg[0] * (1 - a),
    fg[1] * a + bg[1] * (1 - a),
    fg[2] * a + bg[2] * (1 - a),
  ];
}

function relLum([r, g, b]: [number, number, number]): number {
  const ch = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(fg: string, bg: string): number {
  const f = relLum(composite(parseColor(fg), parseColor(bg)));
  const b = relLum(parseColor(bg) as any);
  const [hi, lo] = f > b ? [f, b] : [b, f];
  return (hi + 0.05) / (lo + 0.05);
}

// ─── Token pairs actually used on the site (from global.css + page styles) ──
const PAIRS: Array<{ label: string; fg: string; bg: string; min: number; where: string }> = [
  // Body text on canvases
  { label: "body text", fg: "#e8ecf8", bg: "#07090f", min: 4.5, where: "body on --bg" },
  { label: "body text raised", fg: "#e8ecf8", bg: "#0c1019", min: 4.5, where: "text on --bg-raised" },
  { label: "body text panel", fg: "#e8ecf8", bg: "#101624", min: 4.5, where: "text on --bg-panel (cards, terms)" },
  // Dim text (descriptions, notes) — used at 0.9-1rem = normal size
  { label: "dim text", fg: "#9aa5c3", bg: "#07090f", min: 4.5, where: "sub/lede text on bg" },
  { label: "dim text raised", fg: "#9aa5c3", bg: "#0c1019", min: 4.5, where: "dim text on raised" },
  { label: "dim text panel", fg: "#9aa5c3", bg: "#101624", min: 4.5, where: "dim text on panel (card body)" },
  // Faint text — lightened token; used for small meta text
  { label: "faint text", fg: "#8791ad", bg: "#07090f", min: 4.5, where: "meta/notes on bg" },
  { label: "faint text raised", fg: "#8791ad", bg: "#0c1019", min: 4.5, where: "meta on raised" },
  { label: "faint text panel", fg: "#8791ad", bg: "#101624", min: 4.5, where: "card-stat / bench-note on panel" },
  // Accents as text
  { label: "cyan link", fg: "#4fd6e0", bg: "#07090f", min: 4.5, where: "links on bg" },
  { label: "cyan link raised", fg: "#4fd6e0", bg: "#0c1019", min: 4.5, where: "links on raised" },
  { label: "cyan eyebrow", fg: "#4fd6e0", bg: "#0c1019", min: 4.5, where: "eyebrow on section-alt" },
  { label: "violet chip", fg: "#8b7cf7", bg: "#101624", min: 4.5, where: "chip text on panel" },
  { label: "cyan chip", fg: "#4fd6e0", bg: "#101624", min: 4.5, where: "chip text on panel" },
  { label: "amber chip", fg: "#f5b455", bg: "#101624", min: 4.5, where: "chip text on panel" },
  { label: "green chip", fg: "#5fd39a", bg: "#101624", min: 4.5, where: "chip text on panel" },
  { label: "red chip", fg: "#f27b7b", bg: "#101624", min: 4.5, where: "chip text on panel" },
  // Table cells
  { label: "table yes", fg: "#5fd39a", bg: "#101624", min: 4.5, where: "✓ cells on panel" },
  { label: "table no", fg: "#8791ad", bg: "#101624", min: 4.5, where: "✕ cells on panel" },
  { label: "table part", fg: "#f5b455", bg: "#101624", min: 4.5, where: "~ cells on panel (compare page)" },
  { label: "th label", fg: "#9aa5c3", bg: "#101624", min: 4.5, where: "thead on panel (th bg is 5% violet over panel)" },
  // Primary button (white on violet gradient ~ #8b7cf7..#6d5cf0; worst case darker end)
  { label: "btn-primary text", fg: "#ffffff", bg: "#6d5cf0", min: 4.5, where: "white on primary gradient end" },
  // Nav link dim on translucent nav over bg
  { label: "nav dim", fg: "#9aa5c3", bg: "#07090f", min: 4.5, where: "nav links" },
  // Footer dim
  { label: "footer dim", fg: "#9aa5c3", bg: "#0c1019", min: 4.5, where: "footer text" },
];

// ─── Static server ───────────────────────────────────────────────────────────
const MIME: Record<string, string> = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".svg": "image/svg+xml", ".png": "image/png", ".mp4": "video/mp4",
  ".woff2": "font/woff2", ".json": "application/json",
};

function serveSite(port: number): void {
  const BASE = "/musememory"; // must match astro.config.mjs
  const srv = createServer((req, res) => {
    let p = (req.url || "/").split("?")[0];
    // Strip the site base path the way the real host does; without this the
    // built asset URLs (/_astro/* under /musememory) 404 and the page renders
    // unstyled, collapsing every measured touch target.
    if (p.startsWith(BASE)) p = p.slice(BASE.length) || "/";
    // GitHub Pages semantics: a directory path (/docs) serves /docs/index.html.
    // Without this, directory routes 404'd and the audit silently measured the 404 page.
    const candidates = p.endsWith("/")
      ? [join(DIST, p, "index.html")]
      : p.endsWith(".html")
        ? [join(DIST, p)]
        : [join(DIST, p, "index.html"), join(DIST, p)];
    let file = "";
    for (const c of candidates) {
      try { readFileSync(c); file = c; break; } catch { /* try next candidate */ }
    }
    try {
      readFileSync(file);
      res.writeHead(200, { "content-type": MIME[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream" });
      res.end(readFileSync(file));
    } catch {
      // Astro 404 page for anything unknown
      try {
        const nf = join(DIST, "404.html");
        res.writeHead(404, { "content-type": "text/html" });
        res.end(readFileSync(nf));
      } catch {
        res.writeHead(500); res.end();
      }
    }
  });
  srv.listen(port, "127.0.0.1");
}

const PAGES = ["/", "/docs", "/compare", "/nope-404"];
const DEBUG_AXE = process.env.A11Y_DEBUG === "1";

async function main() {
  let failures = 0;

  // 1. Token-pair contrast audit
  console.log("\n== Token contrast audit (WCAG 2.2 AA) ==");
  for (const p of PAIRS) {
    const ratio = contrast(p.fg, p.bg);
    const ok = ratio >= p.min;
    if (!ok) failures++;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${ratio.toFixed(2)}:1 (min ${p.min})  ${p.label}  [${p.where}]`,
    );
  }

  // 2. axe-core page audit
  console.log("\n== axe-core page audit (zero critical/serious tolerance) ==");
  serveSite(4630);
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox"] });

  for (const path of PAGES) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`http://127.0.0.1:4630${path === "/nope-404" ? "/does-not-exist" : path}`, { waitUntil: "networkidle" });
    // Reveal all .reveal elements, then FREEZE all motion so axe measures the
    // settled presentation state. Without the freeze, staggered scroll-reveal
    // transitions are caught mid-flight and partially-faded text produces
    // phantom contrast failures (WCAG evaluates the end state, and users with
    // prefers-reduced-motion already get the frozen state via our media query).
    await page.evaluate(() => {
      document.querySelectorAll(".reveal").forEach((el) => el.classList.add("is-visible"));
      const style = document.createElement("style");
      style.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";
      document.head.appendChild(style);
    });
    await page.waitForTimeout(120);

    const axeSource = readFileSync(resolve(__dirname, "../node_modules/axe-core/axe.min.js"), "utf8");
    await page.addScriptTag({ content: axeSource });
    const debug = DEBUG_AXE;
    const results = await page.evaluate(async (debugFlag: boolean) => {
      const r = await (window as any).axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      });
      return {
        violations: r.violations.map((v: any) => ({
          id: v.id, impact: v.impact, help: v.help,
          nodes: v.nodes.slice(0, 3).map((n: any) =>
            debugFlag
              ? JSON.stringify({ t: n.target.join(" "), d: n.any[0]?.data, m: (n.any[0]?.message || "").slice(0, 150) })
              : n.target.join(" ")),
        })),
        passes: r.passes.length,
      };
    }, debug);

    const bad = results.violations.filter((v: any) => v.impact === "critical" || v.impact === "serious");
    const minor = results.violations.filter((v: any) => v.impact !== "critical" && v.impact !== "serious");
    failures += bad.length;
    console.log(`  ${path} — ${results.passes} passes, ${bad.length} critical/serious, ${minor.length} minor`);
    for (const v of [...bad, ...minor]) {
      console.log(`     [${v.impact}] ${v.id}: ${v.help}  e.g. ${v.nodes[0] ?? "?"}`);
    }
    await page.close();
  }

  await browser.close();
  console.log(`\n${failures === 0 ? "✅ ALL CHECKS PASSED" : `❌ ${failures} failure(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
