/**
 * Reviews the showreel section placement on the production preview:
 * captures a screenshot of the section and extracts layout metrics
 * (section order, spacing rhythm, video render size, contrast of caption).
 */
import { chromium } from "playwright-core";
import { readdirSync } from "node:fs";
import { join } from "node:path";

function chromiumPath(): string {
  const base = join(process.env.HOME || "", ".cache", "ms-playwright");
  for (const dir of readdirSync(base)) {
    if (dir.startsWith("chromium_headless_shell-")) {
      return join(base, dir, "chrome-headless-shell-linux64", "chrome-headless-shell");
    }
  }
  throw new Error("chromium headless shell not found");
}

async function main() {
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto("http://127.0.0.1:4620/musememory/", { waitUntil: "networkidle" });

  const metrics = await page.evaluate(() => {
    const sections = [...document.querySelectorAll("main > section")];
    const order = sections.map((s) => s.id || s.className.split(" ")[0]);
    const reel = document.querySelector("#showreel");
    const rect = reel?.getBoundingClientRect();
    const video = document.querySelector("#showreel video") as HTMLVideoElement | null;
    const prev = reel?.previousElementSibling as HTMLElement | null;
    const next = reel?.nextElementSibling as HTMLElement | null;
    const cs = reel ? getComputedStyle(reel) : null;
    return {
      sectionOrder: order,
      showreelExists: !!reel,
      showreelTop: rect ? Math.round(rect.top + window.scrollY) : null,
      showreelHeight: rect ? Math.round(rect.height) : null,
      videoSize: video ? { w: video.videoWidth || 0, h: video.videoHeight || 0, clientW: video.clientWidth } : null,
      poster: video?.getAttribute("poster"),
      src: video?.getAttribute("src"),
      prevSection: prev?.id ?? null,
      nextSection: next?.id ?? null,
      sectionPaddingY: cs ? cs.paddingTop + " / " + cs.paddingBottom : null,
      hasRevealClass: reel?.querySelector(".reel")?.classList.contains("reveal") ?? false,
    };
  });

  console.log(JSON.stringify(metrics, null, 2));

  // Screenshot of the showreel section in view
  await page.evaluate(() => document.querySelector("#showreel")?.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(900); // let reveal animation settle
  await page.screenshot({ path: "/tmp/showreel-placement.png" });
  const heroShot = await page.screenshot({ path: "/tmp/showreel-full.png", fullPage: true });
  console.log(`screenshots: /tmp/showreel-placement.png (${heroShot.length}b fullpage)`);

  await browser.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
