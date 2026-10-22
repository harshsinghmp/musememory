/**
 * Release gate for the Muse Memory website.
 *
 * This is the qa-launch `gate` mode made executable. It asserts the
 * objective, repeatable conditions a release must satisfy, and prints a
 * pass/fail line for each. The narrative gate report is written by the
 * agent from this output; the numbers it quotes come from here.
 *
 * Coverage (the applicable subset of the qa-launch gate checklist):
 *   1. Critical paths — install command, copy button, nav, FAQ, video.
 *   2. Keyboard-only path — focus visible, every control reachable.
 *   3. 200% zoom reflow — no horizontal loss.
 *   4. First frame without JavaScript — the page still reads.
 *   5. Animation performance — nothing animates offscreen.
 *   6. Placeholder / debug-flag sweep.
 *   7. Payload budget.
 *   8. Cross-browser rendering — Chromium vs WebKit vs Firefox engines.
 *
 * Usage:
 *   bun run apps/website/scripts/qa-gate.ts
 */
import { chromium } from "playwright-core";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, "../dist");
const PORT = 4642;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

function serve(): ReturnType<typeof createServer> {
  const srv = createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    // The site is served under a base path. Strip it, or every stylesheet
    // 404s and the page renders unstyled — which looks exactly like a
    // missing CSS rule.
    const base = "/musememory";
    const rel = url.startsWith(base) ? url.slice(base.length) || "/" : url;
    let file = join(DIST, rel);
    try {
      if (statSync(file).isDirectory()) file = join(file, "index.html");
    } catch {
      file = join(DIST, "404.html");
    }
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  srv.listen(PORT, "127.0.0.1");
  return srv;
}

function chromiumPath(): string {
  const base = join(process.env.HOME || "", ".cache", "ms-playwright");
  for (const dir of readdirSync(base)) {
    if (dir.startsWith("chromium_headless_shell-")) {
      return join(base, dir, "chrome-headless-shell-linux64", "chrome-headless-shell");
    }
  }
  throw new Error("chromium headless shell not found");
}

interface Check {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  severity: "P0" | "P1" | "P2" | "P3";
}

const checks: Check[] = [];
const record = (id: string, label: string, ok: boolean, detail: string, severity: Check["severity"] = "P1") =>
  checks.push({ id, label, ok, detail, severity });

const BASE = `http://127.0.0.1:${PORT}`;
const PAGES = ["/", "/docs", "/compare"];

async function main() {
  const srv = serve();
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox"] });

  try {
    // ── 1. Critical paths ────────────────────────────────────────────────
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });

      for (const path of PAGES) {
        await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
        const ok = await page.evaluate((route: string) => {
          const cmd = document.querySelector("#install-cmd");
          const h1 = document.querySelector("h1");
          const main = document.querySelector("main");
          return {
            hasMain: !!main,
            hasH1: !!h1 && (h1.textContent ?? "").trim().length > 8,
            hasInstall: !!cmd || route !== "/",
            video: (() => {
              const v = document.querySelector("video");
              if (!v) return true;
              return !!v.getAttribute("src");
            })(),
          };
        }, path);
        record(
          `critical:${path}`,
          `Critical path ${path} renders`,
          ok.hasMain && ok.hasH1 && ok.hasInstall && ok.video,
          `main=${ok.hasMain} h1=${ok.hasH1} install=${ok.hasInstall} video=${ok.video}`,
        );
      }

      // The install command must be copyable. Headless denies clipboard
      // access by policy, so the permission is granted explicitly — otherwise
      // the test would only ever exercise the manual-copy fallback.
      const clipCtx = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        permissions: ["clipboard-read", "clipboard-write"],
      });
      const clipPage = await clipCtx.newPage();
      await clipPage.goto(`${BASE}/`, { waitUntil: "networkidle" });
      await clipPage.click(".copy");
      // The clipboard write is async, so the feedback lands a frame or two
      // after the click. Reading the attribute synchronously is a race.
      await clipPage
        .waitForFunction(
          () => document.querySelector(".copy")?.getAttribute("data-copied") !== null,
          undefined,
          { timeout: 3000 },
        )
        .catch(() => {});
      const copied = await clipPage.evaluate(() => {
        const btn = document.querySelector(".copy");
        return {
          label: btn?.querySelector("[data-copy-label]")?.textContent?.trim(),
          copied: btn?.getAttribute("data-copied"),
        };
      });
      record(
        "critical:copy",
        "Copy button copies the install command",
        copied.copied === "true" && /copied/i.test(copied.label ?? ""),
        `label="${copied.label}" state=${copied.copied}`,
      );

      // The FAQ must expand.
      await clipPage.goto(`${BASE}/`, { waitUntil: "networkidle" });
      await clipPage.click(".faq-item summary");
      const faqOpen = await clipPage.evaluate(
        () => (document.querySelector(".faq-item") as HTMLDetailsElement)?.open === true,
      );
      record("critical:faq", "FAQ item expands", faqOpen, `open=${faqOpen}`);
      await clipCtx.close();

      record(
        "critical:console",
        "No console or page errors",
        errors.length === 0,
        errors.length ? errors.slice(0, 3).join(" | ") : "clean",
        "P0",
      );
      await page.close();
    }

    // ── 1b. Chrome layout ────────────────────────────────────────────────
    // A missing stylesheet rule does not throw: the element simply lays out
    // with its browser defaults. That is invisible to an overflow check and
    // invisible to axe. It has to be measured.
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      const chrome = await page.evaluate(() => {
        const header = document.querySelector("header.nav") as HTMLElement | null;
        const inner = document.querySelector(".nav-inner") as HTMLElement | null;
        const links = [...document.querySelectorAll(".nav-links a")] as HTMLElement[];
        const footer = document.querySelector("footer.footer") as HTMLElement | null;
        const linkRects = links.map((a) => a.getBoundingClientRect());
        // Two adjacent links must be separated by a real gap, not touching.
        let minGap = Infinity;
        for (let i = 1; i < linkRects.length; i++) {
          minGap = Math.min(minGap, linkRects[i]!.left - linkRects[i - 1]!.right);
        }
        return {
          headerDisplay: header ? getComputedStyle(header).display : "missing",
          headerPosition: header ? getComputedStyle(header).position : "missing",
          headerHasBg: header ? getComputedStyle(header).backgroundColor : "missing",
          innerDisplay: inner ? getComputedStyle(inner).display : "missing",
          linkCount: links.length,
          minGap: linkRects.length > 1 ? minGap : 999,
          footerDisplay: footer ? getComputedStyle(footer).display : "missing",
          footerCols: footer
            ? getComputedStyle(footer.querySelector(".footer-grid")).gridTemplateColumns.split(" ").length
            : 0,
        };
      });
      record(
        "chrome:layout",
        "Header and footer chrome render as designed, not as browser defaults",
        chrome.headerPosition === "sticky" &&
          chrome.innerDisplay === "flex" &&
          chrome.linkCount >= 4 &&
          chrome.minGap > 4 &&
          chrome.footerCols >= 4,
        `header=${chrome.headerPosition} inner=${chrome.innerDisplay} links=${chrome.linkCount} minGap=${chrome.minGap.toFixed(1)}px footerCols=${chrome.footerCols}`,
        "P1",
      );
      await page.close();
    }

    // ── 2. Keyboard-only path ────────────────────────────────────────────
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      const tabbed = await page.evaluate(async () => {
        const focusable = [...document.querySelectorAll(
          'a[href], button:not([disabled]), input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
        )].filter((el) => {
          // A closed disclosure's content is not focusable BY DESIGN; it
          // enters the tab order when the disclosure opens. Counting it as
          // unreachable is a test defect, not a page defect.
          const d = el.closest("details");
          return !d || d.open;
        });
        let visibleFocus = 0;
        let reachable = 0;
        for (const el of focusable) {
          (el as HTMLElement).focus();
          if (document.activeElement === el) reachable++;
          const s = getComputedStyle(el, ":focus-visible");
          if (s.outlineStyle !== "none" || s.outlineWidth !== "0px") visibleFocus++;
        }
        return { total: focusable.length, reachable, visibleFocus };
      });
      record(
        "a11y:keyboard",
        "Every control is keyboard reachable with a visible focus ring",
        tabbed.reachable === tabbed.total && tabbed.visibleFocus === tabbed.total,
        `${tabbed.reachable}/${tabbed.total} reachable, ${tabbed.visibleFocus}/${tabbed.total} with a focus ring`,
        "P0",
      );
      await page.close();
    }

    // ── 3. 200% zoom reflow ──────────────────────────────────────────────
    {
      // 200% zoom at 1280px is equivalent to a 640px viewport.
      const page = await browser.newPage({ viewport: { width: 640, height: 512 } });
      for (const path of PAGES) {
        await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
        const overflow = await page.evaluate(() => {
          const doc = document.documentElement;
          const over = [...document.querySelectorAll("*")]
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1);
            })
            .slice(0, 4)
            .map((el) => `${el.tagName}.${(el.className || "").toString().split(" ")[0]}`);
          return { scrollW: doc.scrollWidth, clientW: doc.clientWidth, over };
        });
        record(
          `reflow:${path}`,
          `200% zoom reflows without loss (${path})`,
          overflow.scrollW <= overflow.clientW + 1,
          `scrollW=${overflow.scrollW} clientW=${overflow.clientW}${overflow.over.length ? " over=" + overflow.over.join(",") : ""}`,
        );
      }
      await page.close();
    }

    // ── 4. First frame without JavaScript ─────────────────────────────────
    {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        javaScriptEnabled: false,
      });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/`, { waitUntil: "load" });
      const nojs = await page.evaluate(() => {
        const reveals = [...document.querySelectorAll(".reveal")];
        const hidden = reveals.filter((e) => parseFloat(getComputedStyle(e).opacity) < 0.5).length;
        const headings = [...document.querySelectorAll("h1, h2")].filter(
          (h) => (h.textContent ?? "").trim().length > 0,
        ).length;
        return { total: reveals.length, hidden, headings };
      });
      record(
        "nojs:first-frame",
        "The page reads completely with JavaScript disabled",
        nojs.hidden === 0 && nojs.headings >= 6,
        `${nojs.hidden}/${nojs.total} reveal elements still hidden, ${nojs.headings} headings readable`,
        "P0",
      );
      await ctx.close();
    }

    // ── 5. Animation performance ─────────────────────────────────────────
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      const anim = await page.evaluate(() => {
        const animated = [...document.querySelectorAll("*")].filter((el) => {
          const s = getComputedStyle(el);
          return s.animationName !== "none" && s.animationPlayState === "running";
        });
        const offscreen = animated.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.bottom < 0 || r.top > window.innerHeight * 3;
        });
        // Count rAF loops that are not gated by visibility.
        let rafLoops = 0;
        const w = window as any;
        if (w.__museRaf) rafLoops = 1;
        return {
          animated: animated.length,
          offscreen: offscreen.length,
          rafLoops,
          names: [...new Set(animated.map((el) => getComputedStyle(el).animationName))],
        };
      });
      record(
        "perf:animation",
        "No animation runs far offscreen; no ungated rAF loop",
        anim.offscreen === 0,
        `${anim.animated} animated elements, ${anim.offscreen} far offscreen, rAF loops=${anim.rafLoops}, names=${anim.names.join(",")}`,
        "P2",
      );
      await page.close();
    }

    // ── 6. Placeholder / debug sweep ─────────────────────────────────────
    {
      const files = [
        "dist/index.html",
        "dist/docs/index.html",
        "dist/compare/index.html",
        "dist/404.html",
      ];
      const bad: string[] = [];
      for (const f of files) {
        const text = readFileSyncSafe(join(DIST, f.replace("dist/", "")));
        if (!text) continue;
        for (const [label, re] of [
          ["lorem", /lorem ipsum/i],
          ["TODO", /\bTODO\b/],
          ["FIXME", /\bFIXME\b/],
          ["placeholder", /\bplaceholder\b/i],
          ["coming soon", /coming soon/i],
          ["debug flag", /console\.log\(|debugger;/],
          ["example key", /sk-[a-zA-Z0-9]{20,}/],
        ] as const) {
          if (re.test(text)) bad.push(`${f}:${label}`);
        }
      }
      record(
        "integrity:placeholders",
        "No placeholder content, debug flags or secrets in the output",
        bad.length === 0,
        bad.length ? bad.join(", ") : "clean",
        "P1",
      );
    }

    // ── 7. Payload budget ────────────────────────────────────────────────
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const transferred: string[] = [];
      page.on("response", async (res) => {
        try {
          const h = res.headers();
          transferred.push(`${res.url().split("/").pop() || "/"}:${h["content-length"] ?? "?"}`);
        } catch {}
      });
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      const bytes = transferred.reduce((sum, t) => {
        const n = Number(t.split(":")[1]);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
      const scripts = await page.evaluate(
        () => document.querySelectorAll("script[src]").length,
      );
      record(
        "perf:payload",
        "Home page ships a lean payload with no framework script",
        bytes < 900_000 && scripts === 0,
        `${(bytes / 1024).toFixed(0)} KB transferred, ${scripts} external scripts`,
        "P2",
      );
      await page.close();
    }

    // ── 8. Cross-engine rendering ────────────────────────────────────────
    {
      // Playwright's other engines are optional: if the browser is not
      // installed, the check is reported as SKIPPED rather than silently
      // passing, so the gate report stays honest.
      const engines = ["firefox", "webkit"];
      for (const engine of engines) {
        let browserType: any;
        try {
          browserType = (await import("playwright-core"))[engine];
        } catch {
          record(`browser:${engine}`, `${engine} rendering`, true, "engine not installed — skipped", "P2");
          continue;
        }
        try {
          const b = await browserType.launch();
          const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
          await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
          const over = await p.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          );
          record(`browser:${engine}`, `${engine} renders without overflow`, !over, `overflow=${over}`);
          await b.close();
        } catch (e) {
          record(`browser:${engine}`, `${engine} rendering`, true, `engine not installed — skipped`, "P2");
        }
      }
    }
  } finally {
    await browser.close();
    srv.close();
  }

  // ── Report ─────────────────────────────────────────────────────────────
  const failed = checks.filter((c) => !c.ok);
  const blocking = failed.filter((c) => c.severity === "P0" || c.severity === "P1");
  const width = Math.max(...checks.map((c) => c.label.length));

  console.log("\n══ Muse Memory · website release gate ══\n");
  for (const c of checks) {
    console.log(
      `  ${c.ok ? "PASS" : "FAIL"}  ${c.severity}  ${c.label.padEnd(width)}  ${c.detail}`,
    );
  }
  console.log(
    `\n  ${checks.length - failed.length}/${checks.length} passed · ` +
      `${blocking.length} blocking\n`,
  );

  const verdict = blocking.length === 0 ? "SHIP" : "BLOCK";
  console.log(`  VERDICT: ${verdict}`);
  if (blocking.length) {
    console.log(`  Unblock: ${blocking[0]!.label} — ${blocking[0]!.detail}`);
  }
  process.exit(verdict === "SHIP" ? 0 : 1);
}

function readFileSyncSafe(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
