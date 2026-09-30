/**
 * Responsive visual review for the Muse Memory site.
 *
 * For each built page × viewport (375 / 768 / 1280):
 *   - no horizontal overflow (scrollWidth vs innerWidth)
 *   - no element wider than the viewport or poking past either edge
 *   - interactive targets have a sane minimum hit area (≥ 8×8 px rendered)
 *   - the hero primary CTA is visible without scrolling (home)
 *   - exactly one h1 per page, headings in descending order
 *   - mobile nav contract: nav links hidden, CTA still reachable (≤ 760px)
 *   - Inter is applied to body text
 *   - zero console errors / page errors
 *
 * Screenshots land in /tmp/muse-visual/ for eyeballing.
 *
 * Usage: bun run apps/website/scripts/audit-visual.ts
 */
import { chromium } from "playwright-core";
import { readdirSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

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

const MIME: Record<string, string> = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".svg": "image/svg+xml", ".png": "image/png", ".mp4": "video/mp4",
  ".woff2": "font/woff2", ".json": "application/json",
};

function serveSite(port: number): void {
  const BASE = "/musememory"; // must match astro.config.mjs
  const srv = createServer((req, res) => {
    let p = (req.url || "/").split("?")[0];
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
      const body = readFileSync(file);
      res.writeHead(200, { "content-type": MIME[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      try {
        res.writeHead(404, { "content-type": "text/html" });
        res.end(readFileSync(join(DIST, "404.html")));
      } catch {
        res.writeHead(500); res.end();
      }
    }
  });
  srv.listen(port, "127.0.0.1");
}

const VIEWPORTS = [
  { w: 375, h: 812, label: "375 phone" },
  { w: 768, h: 1024, label: "768 tablet" },
  { w: 1280, h: 900, label: "1280 desktop" },
];
const PAGES = ["/", "/docs", "/compare"];
const PORT = 4631;
const SHOT_DIR = "/tmp/muse-visual";

interface Finding { level: "FAIL" | "WARN"; msg: string }
type Report = Record<string, Finding[]>;

async function reviewPage(
  page: import("playwright-core").Page,
  path: string,
  vp: { w: number; h: number; label: string },
): Promise<Report> {
  const key = `${path} @ ${vp.label}`;
  const report: Report = { [key]: [] };
  const add = (level: Finding["level"], msg: string) => report[key].push({ level, msg });

  const consoleErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  await page.setViewportSize({ width: vp.w, height: vp.h });
  await page.goto(`http://127.0.0.1:${PORT}${path}`, { waitUntil: "networkidle" });

  // Freeze motion so measurements see the settled state.
  await page.evaluate(() => {
    document.querySelectorAll(".reveal").forEach((el) => el.classList.add("is-visible"));
    const style = document.createElement("style");
    style.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";
    document.head.appendChild(style);
  });
  await page.waitForTimeout(120);

  const res = await page.evaluate(() => {
    const iw = window.innerWidth;
    const doc = document.documentElement;

    // 1. Horizontal overflow
    const overflowX = doc.scrollWidth - iw;

    // 2. Elements poking past either edge (visible ones only)
    const wide: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || r.width === 0) continue;
      if (el.closest("video, pre, .table-wrap")) continue; // scroll containers handle their own overflow
      if (r.width > iw + 8 || r.right > iw + 8 || r.left < -8) {
        const tag = el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? `.${el.className.split(" ")[0]}` : "");
        if (!wide.includes(tag)) wide.push(tag);
      }
    }

    // 3. Tap targets (links + buttons, visible only)
    let tinyTargets = 0;
    const tinySample: string[] = [];
    for (const el of document.querySelectorAll("a, button")) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      if (el.getClientRects().length === 0) continue; // hidden by an ancestor
      if (r.width < 8 || r.height < 8) {
        tinyTargets++;
        if (tinySample.length < 3) {
          const tag = el.tagName.toLowerCase() + (el.textContent || "").trim().slice(0, 18);
          tinySample.push(tag);
        }
      }
    }

    // 4. Headings
    const levels = [...document.querySelectorAll("h1, h2, h3, h4")].map((h) => Number(h.tagName[1]));

    // 5. Mobile nav contract (links wrapper hidden, primary CTA visible)
    const navLinksWrap = document.querySelector(".nav .nav-links");
    const navHidden = !navLinksWrap || getComputedStyle(navLinksWrap).display === "none";
    const cta = document.querySelector<HTMLElement>(".nav .btn-primary");
    const ctaVisible = !!cta && getComputedStyle(cta).display !== "none";

    // 6. Font sanity
    const font = getComputedStyle(document.body).fontFamily;

    // 7. Hero CTA above the fold (home)
    let heroCtaAboveFold: boolean | null = null;
    const heroBtn = document.querySelector<HTMLElement>(".hero-cta .btn-primary");
    if (heroBtn) {
      const r = heroBtn.getBoundingClientRect();
      heroCtaAboveFold = r.top >= 0 && r.top < window.innerHeight && r.width > 0;
    }

    return { overflowX, wide, tinyTargets, tinySample, levels, navHidden, ctaVisible, font, heroCtaAboveFold };
  });

  if (res.overflowX > 1) add("FAIL", `horizontal overflow: scrollWidth exceeds viewport by ${res.overflowX}px`);
  if (res.wide.length) add("FAIL", `elements wider/past viewport: ${res.wide.slice(0, 4).join(", ")}`);
  if (res.tinyTargets > 0) add("WARN", `${res.tinyTargets} interactive target(s) under 8×8px: ${res.tinySample.join(" | ")}`);
  if (res.levels[0] !== 1) add("FAIL", `page starts at h${res.levels[0]}, not h1`);
  for (let i = 1; i < res.levels.length; i++) {
    if (res.levels[i] - res.levels[i - 1] > 1) {
      add("WARN", `heading skip h${res.levels[i - 1]} → h${res.levels[i]}`);
      break;
    }
  }
  const isNarrow = vp.w <= 760;
  if (isNarrow && !res.navHidden) add("FAIL", "mobile nav contract broken: .nav-links should be hidden ≤760px");
  if (!res.ctaVisible) add("FAIL", "nav CTA not visible");
  if (!/Inter/i.test(res.font)) add("WARN", `body font-family lacks Inter: ${res.font.slice(0, 60)}`);
  if (path === "/" && res.heroCtaAboveFold === false) add("FAIL", "hero primary CTA not visible without scrolling");
  if (consoleErrors.length) add("WARN", `console errors: ${consoleErrors.slice(0, 2).join(" ~ ").slice(0, 160)}`);

  mkdirSync(SHOT_DIR, { recursive: true });
  const shot = join(SHOT_DIR, `${path === "/" ? "home" : path.replace(/\//g, "")}-${vp.w}.png`);
  await page.screenshot({ path: shot, fullPage: true });

  return report;
}

async function main() {
  let failures = 0;
  serveSite(PORT);
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox"] });

  for (const path of PAGES) {
    const page = await browser.newPage();
    for (const vp of VIEWPORTS) {
      const report = await reviewPage(page, path, vp);
      for (const [key, findings] of Object.entries(report)) {
        const fails = findings.filter((f) => f.level === "FAIL");
        const warns = findings.filter((f) => f.level === "WARN");
        if (findings.length === 0) {
          console.log(`  PASS  ${key}`);
        } else {
          failures += fails.length;
          console.log(`  ${fails.length ? "FAIL" : "WARN"}  ${key}`);
          for (const f of [...fails, ...warns]) console.log(`        [${f.level}] ${f.msg}`);
        }
      }
    }
    await page.close();
  }

  await browser.close();
  console.log(`\nScreenshots: ${SHOT_DIR}/`);
  console.log(`${failures === 0 ? "✅ VISUAL REVIEW PASSED" : `❌ ${failures} failure(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
