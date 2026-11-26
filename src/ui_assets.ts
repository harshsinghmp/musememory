/**
 * Studio static assets (Wave 23 / T-453).
 *
 * The inspector used to be one 2,700-line template literal. CSS, markup and the
 * client script now live as real files under `src/ui/assets/`, so an editor, a
 * linter or a syntax check can read the script as JavaScript instead of as
 * opaque characters inside a string. They are imported as text, which Bun
 * inlines into the bundle at build time; nothing here reads `src/` at runtime,
 * so the published package (which ships `dist/` only) is unaffected. Each asset
 * is served from a stable route with a strong ETag and a pre-compressed gzip
 * buffer, so repeat loads cost a 304 (or one cached body) instead of
 * re-rendering the whole page.
 */
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { Store } from "./store.ts";
import { list } from "./store.ts";
import STUDIO_CSS from "./ui/assets/studio.css" with { type: "text" };
import STUDIO_JS from "./ui/assets/studio.js" with { type: "text" };
import STUDIO_BODY from "./ui/assets/studio.html" with { type: "text" };

const FONT_LINKS =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">';

function renderStudioHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Muse Memory -- Visual Inspector & Cognitive Studio</title>
  ${FONT_LINKS}
  <link rel="stylesheet" href="/assets/studio.css">
</head>
<body>
` + STUDIO_BODY + `
  <script defer src="/assets/studio.js"></script>
</body>
</html>`;
}

export interface StudioAsset {
  body: string;
  gzip: Buffer;
  etag: string;
  gzipEtag: string;
  contentType: string;
}

function makeAsset(body: string, contentType: string): StudioAsset {
  const gzip = gzipSync(Buffer.from(body, "utf8"));
  const digest = (data: string | Buffer) => '"' + createHash("sha256").update(data).digest("hex").slice(0, 32) + '"';
  return { body, gzip, etag: digest(body), gzipEtag: digest(gzip), contentType };
}

export const STUDIO_HTML_ASSET = makeAsset(renderStudioHtml(), "text/html; charset=utf-8");
export const STUDIO_CSS_ASSET = makeAsset(STUDIO_CSS, "text/css; charset=utf-8");
export const STUDIO_JS_ASSET = makeAsset(STUDIO_JS, "text/javascript; charset=utf-8");

export function renderStandaloneHtml(store: Store): string {
  const memories = list(store);
  // Escape every `<` as its JSON unicode form so memory content cannot close the
  // inline script block; replace() takes a function so `$&` in content stays literal.
  const data = JSON.stringify(memories).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Muse Memory -- Visual Inspector & Cognitive Studio</title>
  ${FONT_LINKS}
  <style>
${STUDIO_CSS}
  </style>
</head>
<body>
${STUDIO_BODY}
  <script>window.STANDALONE_DATA = ${data};</script>
  <script>
${STUDIO_JS}
  </script>
</body>
</html>`;
}
