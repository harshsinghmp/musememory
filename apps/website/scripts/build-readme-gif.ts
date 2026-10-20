/**
 * Build the README showcase GIF.
 *
 * Pipeline: scene timeline → SVG frames (typing animation) → rsvg-convert PNG
 * → ffmpeg palettegen/paletteuse → optimized GIF.
 *
 * This is intentionally NOT a screen recording. It renders from a declarative
 * scene list, so the output is deterministic, reproducible in CI, and diffable
 * in review. All command output below is copied verbatim from a real `memory`
 * CLI session — see the header of each scene for the command that produced it.
 *
 * Usage: bun run apps/website/scripts/build-readme-gif.ts
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const siteDir = resolve(here, "..");
const repoDir = resolve(siteDir, "..", "..");
const outGif = join(repoDir, "assets", "muse-memory-demo.gif");
const workDir = join(siteDir, ".gif-build");

// --- Brand tokens (mirrors apps/website/src/styles/global.css) --------------
const C = {
  bg: "#07090f",
  panel: "#101624",
  raised: "#0c1019",
  line: "#24304a",
  text: "#e8ecf8",
  dim: "#9aa5c3",
  faint: "#64708f",
  violet: "#8b7cf7",
  cyan: "#4fd6e0",
  amber: "#f5b455",
  green: "#5fd39a",
  red: "#f27b7b",
};

const W = 1000;
const H = 460;
const FS = 15; // font-size
const CW = 9; // monospace advance width (JetBrains Mono ~0.6em)
const LH = 21; // line-height
const PAD = 26;
const TITLEBAR = 46;
const COLS = Math.floor((W - PAD * 2) / CW);
const TOP = TITLEBAR + PAD + 6;
/** Hard cap on rendered lines — anything beyond scrolls off like a real terminal. */
const MAX_LINES = Math.floor((H - 74 - TOP) / LH);

const FONT = "JetBrains Mono, DejaVu Sans Mono, monospace";

// --- Types ------------------------------------------------------------------
type LineKind = "cmd" | "out" | "dim" | "cyan" | "ok" | "warn" | "accent" | "blank" | "rule";
interface Line {
  kind: LineKind;
  text: string;
}
interface Scene {
  /** Terminal lines to append (typed one at a time). */
  lines: Line[];
  /** Frames to hold on the finished scene before moving on. */
  hold?: number;
  /** Caption shown under the window, e.g. "memory branch". */
  caption?: string;
}

// Real IDs/output captured from a live session in /tmp/mmedemo.
const RETRY_ID = "m_1790937292682_paymentretrypolicy";

const SCENES: Scene[] = [
  {
    // memory init .
    lines: [
      { kind: "cmd", text: "memory init ." },
      { kind: "dim", text: "[!] Git repository detected at ~/payments" },
      { kind: "dim", text: "  initialised .memory/ — SQLite + YAML, zero daemons" },
    ],
    hold: 34,
    caption: "memory init",
  },
  {
    // memory propose "..." --project payments --type architecture --confirmed
    lines: [
      {
        kind: "cmd",
        text: 'memory propose "Retry logic must use exponential backoff\n  with jitter, capped at 5 attempts" --project payments\n  --type architecture --confirmed',
      },
      { kind: "out", text: `created ${RETRY_ID}` },
      {
        kind: "dim",
        text: "  (secrets scanned by Vibeguard before every write)",
      },
    ],
    hold: 34,
    caption: "memory propose",
  },
  {
    // memory context "payment retry" --limit 3
    lines: [
      { kind: "cmd", text: 'memory context "payment retry" --limit 3' },
      { kind: "out", text: `- ${RETRY_ID} [confirmed] (payments) Payment retry policy` },
      { kind: "dim", text: "  Retry logic must use exponential backoff with jitter," },
      { kind: "dim", text: "  capped at 5 attempts" },
      { kind: "cyan", text: "  type: architecture" },
      { kind: "green", text: "  verification: user-confirmed" },
    ],
    hold: 40,
    caption: "memory context — recall that survives the session",
  },
  {
    // memory branch <id> --path payments.retry.backoff --label prod
    lines: [
      { kind: "cmd", text: "memory branch " + RETRY_ID },
      { kind: "dim", text: "  --path payments.retry.backoff --label prod" },
      { kind: "accent", text: `branched memory ${RETRY_ID}` },
      { kind: "dim", text: "  -> payments.retry.backoff" },
    ],
    hold: 38,
    caption: "memory branch — semantic paths, not opaque UUIDs",
  },
  {
    // memory blame <id>
    lines: [
      { kind: "cmd", text: `memory blame ${RETRY_ID}` },
      { kind: "out", text: `[BLAME] ${RETRY_ID} (payments)` },
      { kind: "dim", text: "  title: Payment retry policy" },
      { kind: "cyan", text: "  last_accessed_at: 2026-10-02T10:35:03.260Z" },
      { kind: "green", text: "  access_count: 3" },
      { kind: "dim", text: "  verification: user-confirmed" },
      { kind: "amber", text: "  staleness score: 0.000 (0=fresh, 1=stale)" },
      { kind: "amber", text: "  days to staleness threshold: 539" },
    ],
    hold: 46,
    caption: "memory blame — access-weighted decay (R23)",
  },
  {
    // memory checkout payments.retry.backoff
    lines: [
      { kind: "cmd", text: "memory checkout payments.retry.backoff" },
      { kind: "accent", text: "checked out branch 'payments.retry.backoff'" },
      { kind: "dim", text: `  -> ${RETRY_ID}` },
    ],
    hold: 38,
    caption: "memory checkout",
  },
];

// --- Render helpers ---------------------------------------------------------
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function wrap(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (raw.length <= COLS) {
      out.push(raw);
      continue;
    }
    let rest = raw;
    while (rest.length > COLS) {
      let cut = rest.lastIndexOf(" ", COLS);
      if (cut <= 0) cut = COLS;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^\s+/, "");
    }
    out.push(rest);
  }
  return out;
}

/** Convert a scene line (possibly multi-line) into wrapped physical lines. */
function physical(line: Line): { kind: LineKind; text: string }[] {
  return wrap(line.text).map((text) => ({ kind: line.kind, text }));
}

function colorFor(kind: LineKind): string {
  switch (kind) {
    case "cmd":
      return C.text;
    case "out":
      return C.dim;
    case "dim":
      return C.faint;
    case "cyan":
      return C.cyan;
    case "ok":
      return C.green;
    case "warn":
      return C.amber;
    case "accent":
      return C.violet;
    case "rule":
      return C.line;
    default:
      return C.dim;
  }
}

function frameSvg(allBuffer: { kind: LineKind; text: string }[], caption?: string): string {
  const body: string[] = [];
  // Scroll: keep only the tail that fits above the footer.
  const buffer = allBuffer.slice(-MAX_LINES);

  buffer.forEach((line, i) => {
    const y = TOP + i * LH;
    if (line.kind === "rule") {
      body.push(
        `<rect x="${PAD}" y="${y - 11}" width="${W - PAD * 2}" height="1" fill="${C.line}"/>`,
      );
      return;
    }
    // Prompt marker only on the first line of each cmd block.
    const isCmdStart = line.kind === "cmd" && (i === 0 || buffer[i - 1].kind !== "cmd");
    if (isCmdStart) {
      body.push(
        `<text x="${PAD}" y="${y}" font-family="${FONT}" font-size="${FS}" fill="${C.cyan}">$</text>`,
        `<text x="${PAD + CW * 2}" y="${y}" font-family="${FONT}" font-size="${FS}" fill="${C.dim}">~</text>`,
      );
    }
    const x = PAD + CW * (isCmdStart ? 5 : 2);
    const weight = line.kind === "cmd" || line.kind === "accent" ? 600 : 400;
    body.push(
      `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${FS}" font-weight="${weight}" ` +
        `fill="${colorFor(line.kind)}" xml:space="preserve">${esc(line.text)}</text>`,
    );
  });

  // Block cursor.
  const last = buffer.length ? buffer[buffer.length - 1] : null;
  if (last && last.kind === "cmd") {
    const y = TOP + (buffer.length - 1) * LH;
    const x = PAD + CW * 5 + last.text.length * CW;
    body.push(
      `<rect x="${x}" y="${y - FS + 3}" width="${CW - 1}" height="${FS}" fill="${C.cyan}" opacity="0.85"/>`,
    );
  }

  // In-window footer: rule + caption + brand, so short scenes still look composed.
  const footY = H - 54;
  const captionSvg =
    `<line x1="${PAD}" y1="${footY}" x2="${W - PAD}" y2="${footY}" stroke="${C.line}"/>` +
    `<text x="${PAD}" y="${footY + 24}" font-family="${FONT}" font-size="13" fill="${C.dim}">${esc(caption ?? "")}</text>` +
    `<text x="${W - PAD}" y="${footY + 24}" text-anchor="end" font-family="${FONT}" font-size="13" fill="${C.faint}">muse memory · local-first · zero daemons</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${C.violet}" stop-opacity="0.16"/>
      <stop offset="55%" stop-color="${C.cyan}" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="${C.bg}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <rect x="14" y="10" width="${W - 28}" height="${H - 20}" rx="14" fill="${C.panel}" stroke="${C.line}"/>
  <path d="M14 24a14 14 0 0 1 14-14h${W - 28 - 20}a14 14 0 0 1 14 14v${TITLEBAR - 24}H14z" fill="${C.raised}"/>
  <line x1="14" y1="${TITLEBAR}" x2="${W - 14}" y2="${TITLEBAR}" stroke="${C.line}"/>
  <circle cx="36" cy="23" r="5" fill="${C.red}" opacity="0.85"/>
  <circle cx="54" cy="23" r="5" fill="${C.amber}" opacity="0.85"/>
  <circle cx="72" cy="23" r="5" fill="${C.green}" opacity="0.85"/>
  <text x="${W / 2}" y="27" text-anchor="middle" font-family="${FONT}" font-size="12" fill="${C.faint}">~/payments — memory</text>
  <rect x="14" y="${TITLEBAR}" width="${W - 28}" height="120" fill="url(#sheen)"/>
  ${body.join("\n  ")}
  ${captionSvg}
</svg>`;
}

function assertLayout(): void {
  // Measure the WRAPPED lines that actually get drawn, not the raw source text
  // (a scene line may embed newlines and be far wider than one terminal row).
  let widest = 0;
  let widestText = "";
  for (const scene of SCENES) {
    for (const line of scene.lines) {
      for (const part of physical(line)) {
        if (part.text.length > widest) {
          widest = part.text.length;
          widestText = part.text;
        }
      }
    }
  }
  const rightEdge = PAD + CW * 5 + widest * CW;
  if (rightEdge > W - 20) {
    throw new Error(
      `line overflows canvas: ${widest} chars -> x=${rightEdge} > ${W - 20}\n  "${widestText}"`,
    );
  }
  for (const scene of SCENES) {
    const rows = scene.lines.reduce((a, l) => a + physical(l).length, 0);
    if (rows > MAX_LINES) {
      throw new Error(
        `scene "${scene.caption}" renders ${rows} rows but only ${MAX_LINES} fit; shorten it`,
      );
    }
  }
}

function endCardSvg(): string {
  const cx = W / 2;
  // Layout is tuned for the current H; every element must sit inside the
  // rounded window (x 14..W-14, y 10..H-10) or the text gets clipped.
  const cy = 150;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="42%" r="55%">
      <stop offset="0%" stop-color="${C.violet}" stop-opacity="0.22"/>
      <stop offset="60%" stop-color="${C.cyan}" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="${C.bg}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  <g>
    <circle cx="${cx}" cy="${cy}" r="42" fill="none" stroke="${C.violet}" stroke-width="1.6" opacity="0.85"/>
    <circle cx="${cx}" cy="${cy}" r="27" fill="none" stroke="${C.cyan}" stroke-width="1.2" opacity="0.7"/>
    <circle cx="${cx}" cy="${cy}" r="13" fill="none" stroke="${C.amber}" stroke-width="1.2" opacity="0.8"/>
    <circle cx="${cx}" cy="${cy - 42}" r="4.5" fill="${C.cyan}"/>
    <circle cx="${cx + 42}" cy="${cy}" r="4" fill="${C.violet}"/>
    <circle cx="${cx - 29}" cy="${cy + 25}" r="3.5" fill="${C.green}"/>
  </g>

  <text x="${cx}" y="256" text-anchor="middle" font-family="${FONT}" font-size="36" font-weight="700" fill="${C.text}">Muse Memory</text>
  <text x="${cx}" y="290" text-anchor="middle" font-family="${FONT}" font-size="16" fill="${C.dim}">Memory that outlives the session.</text>
  <text x="${cx}" y="314" text-anchor="middle" font-family="${FONT}" font-size="16" fill="${C.dim}">Local-first · Zero daemons · MCP-native</text>

  <rect x="${cx - 152}" y="338" width="304" height="50" rx="10" fill="${C.raised}" stroke="${C.violet}" stroke-width="1.3"/>
  <text x="${cx}" y="369" text-anchor="middle" font-family="${FONT}" font-size="19" fill="${C.violet}">npm i -g musememory</text>

  <text x="${cx}" y="424" text-anchor="middle" font-family="${FONT}" font-size="14" fill="${C.faint}">github.com/harshsinghmp/musememory</text>
</svg>`;
}

// --- Timeline ---------------------------------------------------------------
type Frame = { svg: string; hold: number };

function buildTimeline(): Frame[] {
  const frames: Frame[] = [];
  let buffer: { kind: LineKind; text: string }[] = [];

  for (const scene of SCENES) {
    // Continuous session: output accumulates like a real terminal and scrolls
    // once it exceeds MAX_LINES, so the window is never half-empty.
    for (const line of scene.lines) {
      const parts = physical(line);
      for (const part of parts) {
        // Type the line out a few characters per frame.
        const total = part.text.length;
        const chunk = part.kind === "cmd" ? 3 : Math.max(1, Math.ceil(total / 6));
        for (let c = 1; c <= total; c += chunk) {
          buffer = [...buffer, { kind: part.kind, text: part.text.slice(0, c) }];
          frames.push({ svg: frameSvg(buffer, scene.caption), hold: 1 });
        }
        if (total === 0) {
          buffer = [...buffer, { kind: part.kind, text: "" }];
          frames.push({ svg: frameSvg(buffer, scene.caption), hold: 1 });
        }
      }
    }
    frames.push({ svg: frameSvg(buffer, scene.caption), hold: scene.hold ?? 30 });
  }

  frames.push({ svg: endCardSvg(), hold: 75 });
  return frames;
}

// --- Main -------------------------------------------------------------------
function run(cmd: string, cwd = siteDir): string {
  return execSync(cmd, { cwd, stdio: ["ignore", "pipe", "inherit"] }).toString();
}

console.log("== clean ==");
if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });
mkdirSync(join(repoDir, "assets"), { recursive: true });

const timeline = buildTimeline();
assertLayout();
console.log(`  layout ok: max ${MAX_LINES} lines/frame`);
console.log(`== timeline: ${timeline.length} frames ==`);

console.log("== svg frames ==");
const svgDir = join(workDir, "svg");
mkdirSync(svgDir, { recursive: true });
timeline.forEach((f, i) => {
  writeFileSync(join(svgDir, `f${String(i).padStart(4, "0")}.svg`), f.svg, "utf8");
});

// Hold durations are expressed in frames at `fps`. The concat demuxer would
// read `duration` as SECONDS, so instead we materialize a flat frame sequence
// (one file per output frame, hardlinked) and encode it at a fixed -framerate.
const fps = 25;
console.log("== rasterize ==");
const pngDir = join(workDir, "png");
mkdirSync(pngDir, { recursive: true });
const svgFiles = readdirSync(svgDir).sort();
for (const f of svgFiles) {
  run(`rsvg-convert -w ${W} -h ${H} -o "${join(pngDir, f.replace(/\.svg$/, ".png"))}" "${join(svgDir, f)}"`);
}
console.log(`  rendered ${svgFiles.length} PNGs`);

console.log("== sequence ==");
const seqDir = join(workDir, "seq");
mkdirSync(seqDir, { recursive: true });
let seq = 0;
timeline.forEach((f, i) => {
  const src = join(pngDir, `f${String(i).padStart(4, "0")}.png`);
  for (let n = 0; n < f.hold; n++) {
    seq += 1;
    run(`ln -f "${src}" "${join(seqDir, `${String(seq).padStart(5, "0")}.png`)}"`);
  }
});
const seconds = seq / fps;
console.log(`  ${seq} output frames = ${seconds.toFixed(2)}s @ ${fps}fps`);
if (seconds > 45 || seconds < 5) {
  throw new Error(`unexpected GIF duration ${seconds.toFixed(2)}s (want 5-45s)`);
}

console.log("== encode ==");
const palettePng = join(workDir, "palette.png");
run(
  `ffmpeg -y -v error -framerate ${fps} -i "${join(seqDir, "%05d.png")}" ` +
    `-vf "scale=${W}:${H}:flags=lanczos,palettegen=stats_mode=diff:max_colors=192" "${palettePng}"`,
);
run(
  `ffmpeg -y -v error -framerate ${fps} -i "${join(seqDir, "%05d.png")}" -i "${palettePng}" ` +
    `-lavfi "scale=${W}:${H}:flags=lanczos[x];[x][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle" ` +
    `-loop 0 "${outGif}"`,
);

console.log("== verify ==");
const kb = statSync(outGif).size / 1024;
if (kb > 6000) throw new Error(`GIF too large for a README: ${kb.toFixed(0)} KB`);
// GIF carries no duration metadata; count decoded frames instead.
const counted = JSON.parse(
  run(
    `ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames,width,height ` +
      `-of json "${outGif}"`,
  ),
);
const vs = counted.streams?.[0] ?? {};
const framesOut = Number(vs.nb_read_frames ?? 0);
if (vs.width !== W || vs.height !== H) {
  throw new Error(`unexpected dimensions ${vs.width}x${vs.height}`);
}
if (framesOut !== seq) {
  throw new Error(`frame count mismatch: expected ${seq}, got ${framesOut}`);
}
console.log(`  ${outGif}`);
console.log(`  ${kb.toFixed(0)} KB, ${framesOut} frames = ${(framesOut / fps).toFixed(2)}s @ ${fps}fps, ${W}x${H}`);
console.log("== done ==");
process.exit(0);