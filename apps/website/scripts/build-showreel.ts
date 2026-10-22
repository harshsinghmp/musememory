/**
 * Renders the showreel from its composition.
 *
 * The composition (`apps/website/showreel/index.html`) is a deterministic
 * function of time: every visual is derived from a `?t=<seconds>` query
 * parameter, with a seeded PRNG for the dust field. So the render is
 * reproducible — the same composition always yields the same pixels.
 *
 * Pipeline:
 *   1. Playwright captures each frame as a PNG (the browser is already a
 *      devDependency; no extra download).
 *   2. ffmpeg assembles the PNG sequence into a 1280x720 H.264 MP4 with
 *      faststart, plus a poster frame.
 *   3. ffprobe verifies the deliverable's real properties.
 *
 * Usage:
 *   bun run apps/website/scripts/build-showreel.ts
 *   FFMPEG=/path/to/ffmpeg bun run apps/website/scripts/build-showreel.ts
 *
 * The composition is NOT a recording of the site: it is an original piece
 * with its own visual language (the memory lattice) and its own script.
 */
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const siteDir = resolve(here, "..");
const projDir = join(siteDir, "showreel");
const frameDir = join(projDir, "frames");
const outMp4 = join(siteDir, "public", "showreel.mp4");
const outPoster = join(siteDir, "public", "showreel-poster.png");

const FPS = 30;
const DURATION = 12.0;
const WIDTH = 1280;
const HEIGHT = 720;
const TOTAL = Math.round(DURATION * FPS);

function run(cmd: string, args: string[]): string {
  console.log(`  $ ${cmd} ${args.join(" ")}`);
  return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"] }).toString();
}

/** Locate ffmpeg/ffprobe: PATH first, then the env override. */
function tool(name: string): string {
  const override = process.env[name.toUpperCase()];
  if (override && existsSync(override)) return override;
  // Playwright ships a minimal ffmpeg without libx264 or ffprobe, so it is
  // not a usable fallback here — PATH or the override only.
  for (const dir of (process.env.PATH || "").split(":")) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `${name} not found. Install ffmpeg (with libx264) or set ${name.toUpperCase()}=/path/to/${name}.`,
  );
}

function chromiumPath(): string {
  const base = join(process.env.HOME || "", ".cache", "ms-playwright");
  for (const dir of readdirSync(base)) {
    if (dir.startsWith("chromium_headless_shell-")) {
      return join(base, dir, "chrome-headless-shell-linux64", "chrome-headless-shell");
    }
  }
  throw new Error("chromium headless shell not found — run: bunx playwright-core install chromium-headless-shell");
}

async function main() {
  const ffmpeg = tool("ffmpeg");
  const ffprobe = tool("ffprobe");

  console.log("== capture frames ==");
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });

  const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox"] });
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });

  const composition = `file://${join(projDir, "index.html")}`;
  for (let i = 0; i < TOTAL; i++) {
    const t = (i / FPS).toFixed(4);
    await page.goto(`${composition}?t=${t}`, { waitUntil: "load" });
    await page.waitForFunction(() => document.documentElement.getAttribute("data-frame-ready") === "1");
    const name = `f${String(i).padStart(4, "0")}.png`;
    await page.screenshot({ path: join(frameDir, name) });
    if (i % 60 === 0) console.log(`  frame ${i}/${TOTAL}`);
  }
  await browser.close();

  const captured = readdirSync(frameDir).filter((f) => f.endsWith(".png")).length;
  if (captured !== TOTAL) {
    throw new Error(`expected ${TOTAL} frames, captured ${captured}`);
  }

  console.log("== encode ==");
  mkdirSync(join(siteDir, "public"), { recursive: true });
  run(ffmpeg, [
    "-y",
    "-framerate", String(FPS),
    "-i", join(frameDir, "f%04d.png"),
    "-c:v", "libx264",
    "-profile:v", "high",
    "-crf", "19",
    "-preset", "medium",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-an",
    outMp4,
  ]);

  console.log("== poster ==");
  run(ffmpeg, [
    "-y",
    "-ss", "9.6",
    "-i", outMp4,
    "-frames:v", "1",
    "-update", "1",
    "-q:v", "2",
    outPoster,
  ]);

  console.log("== verify ==");
  const probe = JSON.parse(
    run(ffprobe, [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,codec_name,nb_frames:format=duration,size",
      "-of", "json",
      outMp4,
    ]),
  );
  const stream = probe.streams?.[0] ?? {};
  const fmt = probe.format ?? {};
  const duration = Number(fmt.duration ?? 0);
  const ok =
    stream.codec_name === "h264" &&
    stream.width === WIDTH &&
    stream.height === HEIGHT &&
    duration > DURATION - 0.5 &&
    duration < DURATION + 0.5;
  if (!ok) {
    throw new Error(`unexpected showreel properties: ${JSON.stringify({ stream, duration })}`);
  }
  console.log(
    `  showreel.mp4: ${stream.width}x${stream.height} ${stream.codec_name}, ` +
      `${duration.toFixed(2)}s, ${((fmt.size ?? 0) / 1024).toFixed(0)} KB`,
  );
  console.log(`  poster: ${(statSync(outPoster).size / 1024).toFixed(0)} KB`);

  rmSync(frameDir, { recursive: true, force: true });
  console.log("\n== done ==");
  console.log("Update apps/website/public/brand/.showreel-hash if the composition changed.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
