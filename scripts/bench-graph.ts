/**
 * Graph & dashboard scaling harness — baseline measurement only.
 *
 * Workstream C ("make the memory graph instant") needs numbers before any source
 * change. This harness bootstraps the *real* UI server in-process on a throwaway
 * port against a synthetic store of 100 / 1k / 10k memories, then measures:
 *
 *   server  — median + cold total latency and payload bytes for the endpoints the
 *             graph view actually hits (/api/memories is the graph's data source;
 *             there is no dedicated /api/graph route yet).
 *   client  — first graph paint (canvas pixel probe, no source instrumentation),
 *             DOM node count, graph node/edge counts, long-task blocking via
 *             PerformanceObserver, and rAF frame deltas during a drag + wheel burst.
 *
 * Deliberate constraints:
 *   - No source edits, so the baseline cannot be contaminated by the fix.
 *   - Synthetic memories are seeded through the public `propose` API, with one
 *     structural link each so the force simulation has edges to resolve.
 *   - `constraint` is excluded from the type rotation: `propose` calls
 *     `syncConstraints` for that type, which is O(store) per call and would turn
 *     seeding into an O(n^2) benchmark of the wrong thing.
 *
 * Playwright resolution: the repo keeps `playwright-core` as a devDependency of
 * the website workspace only, so the bare specifier is tried first and the
 * website's copy is used as a fallback. Nothing has to be installed to run this.
 *
 * Usage:
 *   bun scripts/bench-graph.ts                       # 100, 1000, 10000
 *   bun scripts/bench-graph.ts --sizes 100,1000      # subset
 *   bun scripts/bench-graph.ts --fresh               # re-seed from scratch
 *   bun scripts/bench-graph.ts --no-client           # server timings only
 *   bun scripts/bench-graph.ts --cdn-fonts           # allow fonts.g* (default: blocked)
 *   bun scripts/bench-graph.ts --json out.json       # persist the raw report
 *   bun scripts/bench-graph.ts --assert              # exit 1 on target breach
 *
 * Environment note: the dashboard ships a render-blocking stylesheet from
 * fonts.googleapis.com (src/ui.ts). That is an external network dependency in a
 * local-first tool, and in a sandboxed CI environment the request stalls until it
 * times out, which shows up as a multi-second long task unrelated to the engine.
 * The font CDN is therefore blocked by default so the client numbers measure the
 * dashboard itself; pass --cdn-fonts to include it.
 */
import { readdirSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { openStore, propose, link, list, type Store } from "../src/store.ts";
import { startUiServer } from "../src/ui.ts";

// ── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes(`--${name}`);
const value = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const SIZES = value("sizes", "100,1000,10000")
  .split(",")
  .map((s) => Number.parseInt(s.trim(), 10))
  .filter((n) => Number.isFinite(n) && n > 0);
const FRESH = flag("fresh");
const CLIENT = !flag("no-client");
const ASSERT = flag("assert");
/** Off by default: see the environment note in the header. */
const CDN_FONTS = flag("cdn-fonts");
const JSON_OUT = value("json", "");
/** Per-size wall budget for the client phase, in seconds. */
const BUDGET_MS = Number.parseInt(value("budget", "600"), 10) * 1000;
/** Client repeats per size. Chromium startup jitter is non-monotonic, so one sample
 *  is not a baseline — the reported run is the median of these by first paint. */
const REPS = Math.max(1, Number.parseInt(value("reps", "1"), 10));

const SEED_ROOT = join(tmpdir(), "muse-bench-graph");

/** Mirrors src/types.ts MemoryType, minus `constraint` (see header note). */
const TYPES = [
  "session",
  "decision",
  "fix",
  "failure",
  "architecture",
  "operation",
  "preference",
  "discovery",
] as const;
const PROJECTS = ["alpha", "beta", "gamma", "delta"];

// ── Playwright loader ────────────────────────────────────────────────────────
type Playwright = typeof import("playwright-core");
async function loadPlaywright(): Promise<Playwright> {
  try {
    return (await import("playwright-core")) as Playwright;
  } catch {
    const local = join(
      import.meta.dir,
      "..",
      "apps",
      "website",
      "node_modules",
      "playwright-core",
      "index.mjs",
    );
    if (!existsSync(local)) {
      throw new Error(
        "playwright-core not found (tried the bare specifier and apps/website/node_modules)",
      );
    }
    return (await import(pathToFileURL(local).href)) as Playwright;
  }
}

function chromiumPath(): string {
  const base = join(process.env.HOME || "", ".cache", "ms-playwright");
  for (const dir of readdirSync(base)) {
    if (dir.startsWith("chromium_headless_shell-")) {
      return join(base, dir, "chrome-headless-shell-linux64", "chrome-headless-shell");
    }
  }
  for (const dir of readdirSync(base)) {
    if (dir.startsWith("chromium-")) {
      return join(base, dir, "chrome-linux", "chrome");
    }
  }
  throw new Error(`no chromium build found in ${base}`);
}

// ── Seeding ──────────────────────────────────────────────────────────────────
function memoryCount(memoryDir: string): number {
  const memoriesDir = join(memoryDir, "memories");
  if (!existsSync(memoriesDir)) return 0;
  return readdirSync(memoriesDir).filter((f) => f.endsWith(".yaml")).length;
}

function seedStore(store: Store, memoryDir: string, n: number): { ms: number; seeded: boolean } {
  const before = memoryCount(memoryDir);
  if (!FRESH && before === n) return { ms: 0, seeded: false };
  if (before > 0) rmSync(memoryDir, { recursive: true, force: true });

  const started = performance.now();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const type = TYPES[i % TYPES.length];
    const project = PROJECTS[i % PROJECTS.length];
    const id = `m_${n}_bench-${String(i).padStart(6, "0")}`;
    propose(store, {
      id,
      project,
      type,
      confirmed: true,
      title: `Benchmark seed memory ${i} (${type})`,
      content:
        `Synthetic seed entry ${i} for the ${project} project. Used only to profile ` +
        `dashboard graph scaling: it carries no code references, so anchor stamping stays cheap.`,
      tags: ["bench", type, project],
      source: "bench-graph",
    });
    ids.push(id);
  }
  // Sparse chain: one structural link per entry keeps the edge set realistic
  // without turning seeding into a link-storm benchmark.
  for (let i = 1; i < ids.length; i++) link(store, ids[i], [ids[i - 1]]);
  return { ms: performance.now() - started, seeded: true };
}

// ── Server-side timings ──────────────────────────────────────────────────────
interface ServerTiming {
  name: string;
  coldMs: number;
  medianMs: number;
  bytes: number;
  status: number;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

async function timeEndpoint(
  port: number,
  name: string,
  path: string,
  init?: RequestInit,
  runs = 5,
): Promise<ServerTiming> {
  const url = `http://127.0.0.1:${port}${path}`;
  const samples: number[] = [];
  let bytes = 0;
  let status = 0;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    const res = await fetch(url, init);
    const buf = await res.arrayBuffer();
    samples.push(performance.now() - t0);
    bytes = buf.byteLength;
    status = res.status;
  }
  return { name, coldMs: samples[0], medianMs: median(samples), bytes, status };
}

// ── Client-side instrumentation ──────────────────────────────────────────────
/**
 * Installed before any document script runs:
 *  - a canvas pixel probe that stamps `firstGraphPaintMs` on the first frame with
 *    visible graph content (downscaled drawImage + getImageData, so it stays cheap)
 *  - a long-task observer
 *  - an rAF wrapper that timestamps every frame, so the interaction fps window is
 *    sliced after the fact. A dead animation loop then shows up as zero frames in
 *    the window rather than as a silently missing measurement.
 */
const INIT_SCRIPT = `
(() => {
  window.firstGraphPaintMs = null;
  window.longTasks = [];
  window.frames = [];
  window.lastFrameAtMs = null;

  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.longTasks.push({ start: e.startTime, dur: e.duration });
    }).observe({ entryTypes: ['longtask'] });
  } catch (_) {}

  const probe = document.createElement('canvas');
  probe.width = 32; probe.height = 18;
  const pctx = probe.getContext('2d');
  const iv = setInterval(() => {
    if (window.firstGraphPaintMs !== null) { clearInterval(iv); return; }
    const c = document.getElementById('graphCanvas');
    if (!c || !c.width || !c.height) return;
    try {
      pctx.clearRect(0, 0, 32, 18);
      pctx.drawImage(c, 0, 0, 32, 18);
      const d = pctx.getImageData(0, 0, 32, 18).data;
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] > 0) { window.firstGraphPaintMs = performance.now(); clearInterval(iv); return; }
      }
    } catch (_) {}
  }, 16);

  const origRaf = window.requestAnimationFrame.bind(window);
  let last = 0;
  window.requestAnimationFrame = (cb) => origRaf((ts) => {
    const t = typeof ts === 'number' ? ts : performance.now();
    if (last) {
      window.frames.push({ t, d: t - last });
      if (window.frames.length > 8000) window.frames.shift();
    }
    last = t;
    window.lastFrameAtMs = t;
    return cb(t);
  });
})();
`;

interface ClientMetrics {
  firstGraphPaintMs: number | null;
  domNodes: number;
  graphNodes: number | null;
  graphEdges: number | null;
  longTasks: { count: number; totalMs: number; maxMs: number };
  longTaskList: { start: number; dur: number }[];
  interaction: { frames: number; medianFrameMs: number; p95FrameMs: number; fps: number; longFrames: number } | null;
  /** False when the dashboard's requestAnimationFrame loop stopped repainting. */
  loopAlive: boolean;
  consoleErrors: string[];
  notes: string[];
}

/** Read a top-level `let`/`const` binding from the dashboard's inline classic script. */
async function readGlobal<T>(page: any, expr: string, timeout = 5000): Promise<T | null> {
  try {
    return (await page.evaluate(expr, undefined)) as T;
  } catch {
    return null;
  }
}

async function measureClient(
  playwright: Playwright,
  port: number,
  n: number,
): Promise<ClientMetrics> {
  const browser = await playwright.chromium.launch({
    executablePath: chromiumPath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const notes: string[] = [];
  const consoleErrors: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    if (!CDN_FONTS) {
      await page.route("**/*", (route: any) => {
        const u = route.request().url();
        return /fonts\.(googleapis|gstatic)\.com/.test(u) ? route.abort() : route.continue();
      });
    }
    page.on("console", (m: any) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e: unknown) => consoleErrors.push(String(e)));
    await page.addInitScript(INIT_SCRIPT);

    const t0 = performance.now();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "commit", timeout: BUDGET_MS });
    await page.waitForFunction(() => document.readyState === "complete", undefined, {
      timeout: BUDGET_MS,
      polling: 250,
    });
    const loadMs = performance.now() - t0;

    // First paint probes the canvas itself, so a blocked main thread shows up as
    // a timeout rather than as a fake number.
    try {
      await page.waitForFunction(() => window.firstGraphPaintMs !== null, undefined, {
        timeout: Math.min(BUDGET_MS, 120_000),
        polling: 250,
      });
    } catch {
      notes.push("first graph paint not observed inside the budget (main thread starved)");
    }

    const firstGraphPaintMs = await readGlobal<number>(page, "window.firstGraphPaintMs");
    const domNodes = await readGlobal<number>(page, "document.getElementsByTagName('*').length");
    const graphNodes = await readGlobal<number>(page, "(0, eval)('nodes3d.length')");
    const graphEdges = await readGlobal<number>(page, "(0, eval)('edges3d.length')");
    const longTasksRaw = (await readGlobal<{ start: number; dur: number }[]>(page, "window.longTasks")) ?? [];

    // Interaction burst: drag across the canvas, then wheel-zoom.
    let interaction: ClientMetrics["interaction"] = null;
    let loopAlive = false;
    try {
      const box = await page.locator("#graphCanvas").boundingBox();
      if (box) {
        const burstStart = (await readGlobal<number>(page, "performance.now()")) ?? 0;
        const started = performance.now();
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        for (let i = 0; i < 24; i++) {
          await page.mouse.move(cx + Math.cos(i / 4) * 160, cy + Math.sin(i / 4) * 110, { steps: 2 });
        }
        await page.mouse.up();
        await page.mouse.wheel(0, -240);
        await page.mouse.wheel(0, 120);
        const wall = performance.now() - started;
        const burstEnd = (await readGlobal<number>(page, "performance.now()")) ?? burstStart;
        const allFrames = (await readGlobal<{ t: number; d: number }[]>(page, "window.frames")) ?? [];
        const lastFrameAt = await readGlobal<number>(page, "window.lastFrameAtMs");
        // If the loop stopped, the newest frame predates the burst entirely.
        loopAlive = typeof lastFrameAt === "number" && lastFrameAt >= burstEnd - 50;
        const deltas = allFrames
          .filter((f) => f.t >= burstStart && f.t <= burstEnd)
          .map((f) => f.d);
        if (deltas.length > 0) {
          const frames = deltas.length;
          const p95 = [...deltas].sort((a, b) => a - b)[Math.min(frames - 1, Math.floor(frames * 0.95))];
          const med = median(deltas);
          interaction = {
            frames,
            medianFrameMs: med,
            p95FrameMs: p95,
            fps: 1000 / med,
            longFrames: deltas.filter((d) => d > 33).length,
          };
        }
        notes.push(`interaction burst wall time ${Math.round(wall)}ms, ${deltas.length} frames`);
        if (!loopAlive) notes.push("animation loop stopped repainting");
      }
    } catch (err) {
      notes.push(`interaction burst failed: ${(err as Error).message}`);
    }

    return {
      firstGraphPaintMs,
      domNodes: domNodes ?? -1,
      graphNodes,
      graphEdges,
      longTasks: {
        count: longTasksRaw.length,
        totalMs: longTasksRaw.reduce((a, b) => a + b.dur, 0),
        maxMs: longTasksRaw.reduce((m, b) => Math.max(m, b.dur), 0),
      },
      longTaskList: longTasksRaw,
      interaction,
      loopAlive,
      // The blocked font request reports itself as a console error; it is our own
      // deliberate abort, not a page fault, so keep it out of the count.
      consoleErrors: CDN_FONTS
        ? consoleErrors
        : consoleErrors.filter((e) => !/ERR_FAILED/.test(e)),
      notes: [`load event ${Math.round(loadMs)}ms`, ...notes],
    };
  } finally {
    await browser.close();
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
interface SizeResult {
  size: number;
  seedMs: number;
  seedReused: boolean;
  storeCount: number;
  server: ServerTiming[];
  /** Median run by first paint, across REP client repeats. */
  client: ClientMetrics | null;
  clientRuns: ClientMetrics[];
  paintSpreadMs: [number, number] | null;
}

const kb = (b: number): string => (b / 1024).toFixed(1);
const pad = (s: string | number, w: number): string => String(s).padEnd(w);

async function runSize(n: number, playwright: Playwright | null): Promise<SizeResult> {
  const memoryDir = join(SEED_ROOT, String(n), ".memory");
  mkdirSync(SEED_ROOT, { recursive: true });
  const store = openStore(memoryDir);
  const { ms: seedMs, seeded } = seedStore(store, memoryDir, n);
  console.error(
    `  seed ${n}: ${seeded ? `wrote ${n} entries in ${Math.round(seedMs)}ms` : "reused existing store"}`,
  );

  const srv = await startUiServer({ port: 0, memoryDir, store });
  try {
    const server: ServerTiming[] = [];
    server.push(await timeEndpoint(srv.port, "GET /api/memories", "/api/memories"));
    server.push(await timeEndpoint(srv.port, "GET /api/snapshot", "/api/snapshot"));
    server.push(await timeEndpoint(srv.port, "GET /api/stats", "/api/stats"));
    server.push(
      await timeEndpoint(srv.port, "POST /api/search", "/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "seed memory", limit: 10 }),
      }),
    );

    const clientRuns: ClientMetrics[] = [];
    if (playwright) {
      for (let rep = 0; rep < REPS; rep++) {
        console.error(`  client ${n}: headless chromium, repeat ${rep + 1}/${REPS} ...`);
        try {
          clientRuns.push(await measureClient(playwright, srv.port, n));
        } catch (err) {
          console.error(`  client ${n}: repeat ${rep + 1} FAILED — ${(err as Error).message}`);
        }
      }
    }
    const ranked = [...clientRuns].sort(
      (a, b) => (a.firstGraphPaintMs ?? Infinity) - (b.firstGraphPaintMs ?? Infinity),
    );
    const client = ranked.length ? ranked[Math.floor((ranked.length - 1) / 2)] : null;
    const paints = clientRuns
      .map((c) => c.firstGraphPaintMs)
      .filter((p): p is number => typeof p === "number");
      const paintSpreadMs: [number, number] | null = paints.length
      ? [Math.min(...paints), Math.max(...paints)]
      : null;

    return {
      size: n,
      seedMs,
      seedReused: !seeded,
      storeCount: list(store).length,
      server,
      client,
      clientRuns,
      paintSpreadMs,
    };
  } finally {
    srv.close();
  }
}

async function main(): Promise<void> {
  const playwright = CLIENT ? await loadPlaywright() : null;
  const results: SizeResult[] = [];
  for (const n of SIZES) {
    console.error(`\n=== ${n} memories ===`);
    results.push(await runSize(n, playwright));
  }

  // Server table
  console.log("\n## Server-side (median of 5 warm calls, cold call in parentheses)\n");
  console.log(
    "| memories | store | " +
      results[0].server.map((s) => s.name.replace("GET ", "").replace("POST ", "")).join(" | ") +
      " |",
  );
  console.log(
    "| ---: | ---: | " + results[0].server.map(() => "---:").join(" | ") + " |",
  );
  for (const r of results) {
    const cells = r.server.map((s) => {
      const bad = s.status !== 200 ? ` (HTTP ${s.status})` : "";
      return `${s.medianMs.toFixed(1)} ms / ${kb(s.bytes)} KB (${s.coldMs.toFixed(1)})${
        bad
      }`;
    });
    console.log(`| ${r.size} | ${r.storeCount} | ${cells.join(" | ")} |`);
  }

  // Client table
  console.log("\n## Client-side (headless chromium, 1280x900)\n");
  console.log(
    "| memories | first graph paint | DOM nodes | graph nodes | graph edges | long tasks | interaction | notes |",
  );
  console.log("| ---: | ---: | ---: | ---: | ---: | --- | --- | --- |");
  for (const r of results) {
    const c = r.client;
    if (!c) {
      console.log(`| ${r.size} | — | — | — | — | — | — | not measured |`);
      continue;
    }
    const spread =
      r.paintSpreadMs && r.paintSpreadMs[0] !== r.paintSpreadMs[1]
        ? ` (${Math.round(r.paintSpreadMs[0])}–${Math.round(r.paintSpreadMs[1])} over ${r.clientRuns.length} runs)`
        : "";
    const paint =
      c.firstGraphPaintMs === null
        ? `never${spread}`
        : `${Math.round(c.firstGraphPaintMs)} ms${spread}`;
    const lt = `${c.longTasks.count} / ${Math.round(c.longTasks.totalMs)}ms (max ${Math.round(
      c.longTasks.maxMs,
    )}ms)`;
    const inter = !c.loopAlive
      ? "**loop dead** (0 repaints)"
      : c.interaction
        ? `${c.interaction.fps.toFixed(1)} fps med, ${(1000 / c.interaction.p95FrameMs).toFixed(
            1,
          )} fps p95, ${c.interaction.longFrames}/${c.interaction.frames} frames >33ms`
        : "—";
    const notes = [...c.notes, ...(c.consoleErrors.length ? [`${c.consoleErrors.length} console errors`] : [])]
      .join("; ")
      .replace(/\|/g, "/");
    console.log(
      `| ${r.size} | ${paint} | ${c.domNodes} | ${c.graphNodes ?? "?"} | ${c.graphEdges ?? "?"} | ${lt} | ${inter} | ${notes} |`,
    );
  }

  if (JSON_OUT) {
    writeFileSync(
      JSON_OUT,
      JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2),
    );
    console.log(`\nraw report → ${JSON_OUT}`);
  }

  if (ASSERT) {
    // Targets from the Workstream C plan. Only assertions this harness can
    // actually observe are checked; the "no full re-fetch when the revision is
    // unchanged" target needs the /api/graph route that does not exist yet.
    const failures: string[] = [];
    for (const r of results) {
      if (!r.client) continue;
      if (r.size >= 1000 && r.client.firstGraphPaintMs !== null && r.client.firstGraphPaintMs > 150) {
        failures.push(
          `${r.size}: first graph paint ${Math.round(r.client.firstGraphPaintMs)}ms > 150ms`,
        );
      }
      if (r.client.firstGraphPaintMs === null) {
        failures.push(`${r.size}: graph never painted inside the budget`);
      }
      if (r.client.graphNodes && r.client.graphNodes >= 1000) {
        if (!r.client.loopAlive) {
          failures.push(
            `${r.size}: graph repaint loop died with ${r.client.graphNodes} nodes (no pan/zoom at all)`,
          );
        } else if (r.client.interaction && r.client.interaction.fps < 55) {
          failures.push(
            `${r.size}: interaction ${r.client.interaction.fps.toFixed(1)} fps < 55 fps with ${
              r.client.graphNodes
            } nodes`,
          );
        }
      }
    }
    if (failures.length) {
      console.error(`\nASSERT FAILURES (${failures.length}):`);
      for (const f of failures) console.error(`  - ${f}`);
      process.exit(1);
    }
    console.log("\nassertions passed");
  }
  process.exit(0);
}

await main();
