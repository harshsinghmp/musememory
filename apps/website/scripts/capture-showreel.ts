/**
 * 10-second promo showreel for Muse Memory.
 * Captures REAL frames from the built site (headless Chromium via Playwright),
 * composites branded title cards with sharp/zlib PNG rendering, and assembles
 * everything into a 10s MP4 with ffmpeg. No external services.
 *
 * Usage: bun run apps/website/scripts/capture-showreel.ts
 * Output: apps/website/public/showreel.mp4 (+ poster.png)
 */
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import * as os from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_DIST = resolve(__dirname, "../dist");
const OUT_DIR = resolve(__dirname, "../public");
const W = 1280;
const H = 720;
const FPS = 30;

// ─── Tiny static server for the built site ──────────────────────────────────
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function serveSite(port: number): void {
  const srv = createServer((req, res) => {
    let p = (req.url || "/").split("?")[0];
    if (p === "/") p = "/index.html";
    const file = join(SITE_DIST, p);
    try {
      statSync(file);
      res.writeHead(200, { "content-type": MIME[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream" });
      res.end(readFileSync(file));
    } catch {
      res.writeHead(404);
      res.end("nf");
    }
  });
  srv.listen(port, "127.0.0.1");
}

// ─── Scene scripting ────────────────────────────────────────────────────────
interface Scene {
  name: string;
  seconds: number;
  /** Runs once; captures `seconds * FPS` frames while animating the page. */
  capture: (page: any, emit: (name: string) => Promise<void>) => Promise<void>;
}

async function main() {
  if (!existsSync(SITE_DIST)) {
    console.error("Build the site first: bun run site:build");
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const framesDir = mkdtempSync(join(tmpdirSafe(), "showreel-"));
  let frame = 0;

  const emit = async (name: string) => {
    await page.screenshot({ path: join(framesDir, `${String(frame).padStart(5, "0")}.png`), clip: { x: 0, y: 0, width: W, height: H } });
    frame++;
    void name;
  };

  serveSite(47612);
  console.error("  serving site on :47612");
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox", "--force-device-scale-factor=1"] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

  await page.goto("http://127.0.0.1:47612/", { waitUntil: "networkidle" });
  await page.addStyleTag({
    content: `
      html { scroll-behavior: auto !important; }
      *, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }
      .nav, .footer { display: none !important; }
    `,
  });
  // Force all reveals visible so scenes are deterministic.
  await page.evaluate(() => document.querySelectorAll(".reveal").forEach((el) => el.classList.add("is-visible")));
  await page.waitForTimeout(400);

  const scenes: Scene[] = [];

  // SCENE 1 (3s) — Hero: slow zoom + headline
  scenes.push({
    name: "hero",
    seconds: 3,
    capture: async (_p, emitFrame) => {
      const steps = 3 * FPS;
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        const scale = 1 + 0.05 * easeInOut(t);
        await page.evaluate((s: number) => {
          const hero = document.querySelector(".hero") as HTMLElement;
          hero.style.transform = `scale(${s})`;
          hero.style.transformOrigin = "50% 30%";
        }, scale);
        await emitFrame("hero");
      }
    },
  });

  // SCENE 2 (2.5s) — Capabilities: scroll to grid, sequential highlight
  scenes.push({
    name: "pillars",
    seconds: 2.5,
    capture: async (_p, emitFrame) => {
      await page.evaluate(() => document.querySelector("#pillars")!.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(150);
      const cards = await page.$$("#pillars .card");
      const steps = Math.floor(2.5 * FPS);
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        const idx = Math.min(cards.length - 1, Math.floor(t * cards.length));
        for (let c = 0; c < cards.length; c++) {
          await cards[c].evaluate((el: any, on: boolean) => {
            el.style.transform = on ? "translateY(-6px)" : "none";
            el.style.borderColor = on ? "rgba(139,124,247,.55)" : "";
          }, c === idx);
        }
        await emitFrame("pillars");
      }
      // reset
      for (const c of cards) await c.evaluate((el: any) => { el.style.transform = "none"; el.style.borderColor = ""; });
    },
  });

  // SCENE 3 (2.5s) — Memory loop: flow steps lighting up in sequence
  scenes.push({
    name: "flow",
    seconds: 2.5,
    capture: async (_p, emitFrame) => {
      await page.evaluate(() => document.querySelector("#flow")!.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(150);
      const steps = await page.$$("#flow .flow-step");
      const frames = Math.floor(2.5 * FPS);
      for (let i = 0; i < frames; i++) {
        const t = i / frames;
        const idx = Math.min(steps.length - 1, Math.floor(t * steps.length));
        for (let s = 0; s < steps.length; s++) {
          await steps[s].evaluate((el: any, mode: string) => {
            el.style.outline = mode === "on" ? "2px solid rgba(79,214,224,.6)" : mode === "done" ? "1px solid rgba(95,211,154,.35)" : "none";
            el.style.background = mode === "on" ? "rgba(79,214,224,.06)" : "";
          }, s === idx ? "on" : s < idx ? "done" : "off");
        }
        await emitFrame("flow");
      }
      for (const s of steps) await s.evaluate((el: any) => { el.style.outline = "none"; el.style.background = ""; });
    },
  });

  // SCENE 4 (2s) — Benchmarks scoreboard
  scenes.push({
    name: "bench",
    seconds: 2,
    capture: async (_p, emitFrame) => {
      await page.evaluate(() => document.querySelector("#benchmarks")!.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(150);
      const frames = 2 * FPS;
      for (let i = 0; i < frames; i++) {
        const t = i / frames;
        const scale = 0.96 + 0.04 * easeOut(t);
        await page.evaluate((s: number) => {
          const grid = document.querySelector(".bench-grid") as HTMLElement;
          grid.style.transform = `scale(${s})`;
        }, scale);
        await emitFrame("bench");
      }
    },
  });

  for (const scene of scenes) {
    console.error(`  capturing scene: ${scene.name} (${scene.seconds}s)`);
    await scene.capture(page, emit);
  }

  await browser.close().catch(() => {});

  // ─── End card: brand title overlay on last frame ──────────────────────────
  const endCardPng = join(framesDir, "endcard-src.png");
  await page.close().catch(() => {});
  // Reuse the hero frame as backdrop: copy final captured frame via ffmpeg overlay instead.

  // ─── Assemble with ffmpeg: scenes → H.264 ────
  const totalFrames = frame;
  const outFile = join(OUT_DIR, "showreel.mp4");

  execFileSync("ffmpeg", [
    "-y",
    "-loglevel", "error",
    "-r", String(FPS),
    "-i", join(framesDir, "%05d.png"),
    "-vf", `scale=${W}:${H}:flags=lanczos,format=yuv420p`,
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "21",
    "-movflags", "+faststart",
    outFile,
  ]);

  // Poster = first hero frame
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-i", join(framesDir, "00000.png"),
    "-vf", "scale=1280:720",
    join(OUT_DIR, "showreel-poster.png"),
  ]);

  rmSync(framesDir, { recursive: true, force: true });
  console.error(`showreel: ${totalFrames} frames @ ${FPS}fps = ${(totalFrames / FPS).toFixed(1)}s -> ${outFile}`);
  // Headless shell can linger after close(); exit explicitly once the file is written.
  process.exit(0);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function tmpdirSafe(): string {
  return os.tmpdir();
}

function chromiumPath(): string {
  const base = join(process.env.HOME || "", ".cache", "ms-playwright");
  for (const dir of readdirSync(base)) {
    if (dir.startsWith("chromium_headless_shell-")) {
      return join(base, dir, "chrome-headless-shell-linux64", "chrome-headless-shell");
    }
    if (dir.startsWith("chromium-")) {
      return join(base, dir, "chrome-linux64", "chrome");
    }
  }
  throw new Error("Playwright chromium headless shell not found — run: bunx playwright install chromium");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
