import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import {
  STUDIO_CSS_ASSET,
  STUDIO_HTML_ASSET,
  STUDIO_JS_ASSET,
} from "../src/ui_assets.ts";
import { escapeHtml as serverEscapeHtml } from "../src/ui.ts";

/**
 * Studio asset gates (issue #445).
 *
 * The inspector's CSS, markup and ~1,750 lines of browser JavaScript used to be
 * template literals inside `src/ui_assets.ts`, so no compiler, linter or test
 * ever parsed the script: a syntax error shipped as a broken page instead of a
 * red build. The assets now live in `src/ui/assets/` and are imported as text;
 * these tests are the missing gate.
 */

const ASSET_DIR = new URL("../src/ui/assets/", import.meta.url);

function readAsset(name: string): string {
  return readFileSync(new URL(name, ASSET_DIR), "utf8");
}

/** Extract a top-level `function name(...) { ... }` declaration by brace matching. */
function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`client script has no function ${name}()`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}" && (depth -= 1) === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in function ${name}()`);
}

/** Compile an extracted browser function in an isolated scope and hand it back. */
function loadClientFunction<T>(source: string, name: string): T {
  return new Function(`${extractFunction(source, name)}; return ${name};`)() as T;
}

/** Count braces outside comments and quoted strings (a cheap stylesheet well-formedness check). */
function braceBalance(css: string): { open: number; close: number } {
  const stripped = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
  return {
    open: (stripped.match(/{/g) ?? []).length,
    close: (stripped.match(/}/g) ?? []).length,
  };
}

describe("Studio assets (issue #445)", () => {
  describe("client script syntax gate", () => {
    test("STUDIO_JS parses as JavaScript", () => {
      const js = STUDIO_JS_ASSET.body;
      expect(js.length).toBeGreaterThan(50_000);
      // The gate that did not exist while this was a template literal.
      expect(() => new Function(js)).not.toThrow();
    });

    test("the inlined text is the file's bytes, with no template-literal escape artefacts", () => {
      // A stray `\${` means an interpolation escape survived the move to a real file.
      // The 61 `${...}` in the script are its own template literals, resolved by the
      // browser at render time, so they are expected — `\${` is not.
      expect(STUDIO_JS_ASSET.body).not.toContain("\\${");
      expect(STUDIO_JS_ASSET.body).toBe(readAsset("studio.js"));
      expect(STUDIO_CSS_ASSET.body).toBe(readAsset("studio.css"));
    });
  });

  describe("inline-embedding safety", () => {
    test("no inline-embedded asset can close or reopen a <script> block", () => {
      // STUDIO_JS and STUDIO_BODY are both inlined inside <script>/<body> by
      // renderStandaloneHtml, where a script tag in the payload would end the block.
      expect(STUDIO_JS_ASSET.body.toLowerCase()).not.toContain("<script");
      expect(readAsset("studio.html").toLowerCase()).not.toContain("<script");
    });

    test("standalone HTML still wires the stylesheet and script", () => {
      expect(STUDIO_HTML_ASSET.body).toContain('href="/assets/studio.css"');
      expect(STUDIO_HTML_ASSET.body).toContain('src="/assets/studio.js"');
    });
  });

  describe("client escapeHtml (mirrors the server test at src/ui.ts)", () => {
    const clientEscapeHtml = loadClientFunction<(str: unknown) => string>(
      STUDIO_JS_ASSET.body,
      "escapeHtml",
    );

    test("escapes all five HTML metacharacters", () => {
      expect(clientEscapeHtml("<script>alert('xss')</script>")).toBe(
        "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;",
      );
      expect(clientEscapeHtml('"><img src=x onerror=alert(1)>')).toBe(
        "&quot;&gt;&lt;img src=x onerror=alert(1)&gt;",
      );
      expect(clientEscapeHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
      expect(clientEscapeHtml('"quoted" & \'single-quoted\'')).toBe(
        "&quot;quoted&quot; &amp; &#39;single-quoted&#39;",
      );
      expect(clientEscapeHtml("plain text")).toBe("plain text");
      expect(clientEscapeHtml("")).toBe("");
    });

    test("treats null and undefined as empty", () => {
      expect(clientEscapeHtml(null)).toBe("");
      expect(clientEscapeHtml(undefined)).toBe("");
    });

    test("agrees with the server escapeHtml, so the two copies cannot drift", () => {
      const corpus = [
        "<script>alert('xss')</script>",
        '"><img src=x onerror=alert(1)>',
        "Tom & Jerry",
        `"quoted" & 'single-quoted'`,
        "a && b || c",
        "&amp; already escaped",
        "unicode — em dash ✕",
        "multi\nline",
        "",
      ];
      for (const input of corpus) {
        expect(clientEscapeHtml(input)).toBe(serverEscapeHtml(input));
      }
    });
  });

  describe("stylesheets", () => {
    test("STUDIO_CSS has balanced braces", () => {
      const { open, close } = braceBalance(STUDIO_CSS_ASSET.body);
      expect(open).toBeGreaterThan(0);
      expect(open).toBe(close);
      expect(STUDIO_CSS_ASSET.body).toContain(":root");
    });
  });

  describe("module shape", () => {
    test("ui_assets.ts no longer holds the assets as template literals", () => {
      const moduleSource = readFileSync(new URL("../src/ui_assets.ts", import.meta.url), "utf8");
      expect(moduleSource.length).toBeLessThan(10_000);
      expect(moduleSource.match(/with \{ type: "text" \}/g)?.length).toBe(3);
      expect(moduleSource).not.toContain("const STUDIO_JS = `");
    });
  });
});
