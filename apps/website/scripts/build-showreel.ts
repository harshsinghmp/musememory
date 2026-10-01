/**
 * Build the showreel from the HyperFrames composition.
 *
 * Pipeline: hyperframes render (1920x1080 master) → ffmpeg scale to
 * 1280x720 H.264 web deliverable → poster frame → CI hash seed.
 *
 * Replaces the old screen-capture pipeline: the showreel is a
 * motion-designed composition rendered deterministically from
 * apps/website/showreel-hf/, not a recording of the site.
 *
 * Usage: bun run apps/website/scripts/build-showreel.ts
 */
import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const siteDir = resolve(here, "..");
const projDir = join(siteDir, "showreel-hf");
const master = join(projDir, "renders", "master.mp4");
const outMp4 = join(siteDir, "public", "showreel.mp4");
const outPoster = join(siteDir, "public", "showreel-poster.png");

function run(cmd: string, cwd = siteDir): string {
  console.log(`  $ ${cmd}`);
  return execSync(cmd, { cwd, stdio: ["ignore", "pipe", "inherit"] }).toString();
}

// 1. Render the master from the composition (deterministic seek-driven capture).
console.log("== hyperframes render ==");
run("HYPERFRAMES_SKIP_SKILLS=1 bunx hyperframes render --quiet -o renders/master.mp4", projDir);
if (!existsSync(master)) throw new Error("master.mp4 was not produced");
console.log(`  master: ${(statSync(master).size / 1e6).toFixed(2)} MB`);

// 2. Web encode: 1280x720 H.264, 30fps, faststart for progressive playback.
console.log("== ffmpeg web encode ==");
run(
  `ffmpeg -y -i "${master}" -vf "scale=1280:720:flags=lanczos" -r 30 ` +
    `-c:v libx264 -profile:v high -crf 20 -preset medium -pix_fmt yuv420p ` +
    `-movflags +faststart -an "${outMp4}"`,
);

// 3. Poster frame from the settled CTA scene.
console.log("== poster ==");
run(`ffmpeg -y -ss 8.6 -i "${master}" -frames:v 1 -update 1 -q:v 2 "${outPoster}"`);

// 4. Verify the deliverable with ffprobe.
console.log("== verify ==");
const probe = JSON.parse(
  run(
    `ffprobe -v error -select_streams v:0 -show_entries ` +
      `stream=width,height,codec_name:format=duration,size -of json "${outMp4}"`,
  ),
);
const stream = probe.streams?.[0];
const fmt = probe.format ?? {};
const duration = Number(fmt.duration ?? 0);
const ok =
  stream?.codec_name === "h264" &&
  stream?.width === 1280 &&
  stream?.height === 720 &&
  duration > 9.5 &&
  duration < 10.5;
if (!ok) {
  throw new Error(`unexpected showreel properties: ${JSON.stringify({ stream, duration })}`);
}
console.log(
  `  showreel.mp4: ${stream.width}x${stream.height} ${stream.codec_name}, ` +
    `${duration.toFixed(2)}s, ${((fmt.size ?? 0) / 1024).toFixed(0)} KB`,
);
console.log(`  poster: ${(statSync(outPoster).size / 1024).toFixed(0)} KB`);

// 5. Print the CI hash input (pages.yml hashes the design inputs + this script).
console.log("== done ==");
console.log("Update apps/website/public/brand/.showreel-hash if design inputs changed.");
process.exit(0);
