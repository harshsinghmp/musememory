import { describe, test, expect } from "bun:test";
import { openStore, propose } from "../src/store.ts";
import { isSameOriginRequest, startUiServer, STUDIO_CSP } from "../src/ui.ts";
import { STUDIO_JS_ASSET, STUDIO_HTML_ASSET } from "../src/ui_assets.ts";
import { cleanup, setupFixtureRoot } from "./helpers.ts";

/**
 * Studio hardening gate (issue #520).
 *
 * The dashboard renders untrusted memory content — titles, bodies, tags, wiki
 * pages — into a browser, and until now it served that content with no
 * content-security policy, no `no-store`, and an origin check that only covered
 * POSTs and accepted any `http://localhost:<port>`. These tests pin the three
 * defences the fix added so reverting any one of them alone turns this file red:
 *
 *   - headers on *every* response, not just the HTML shell;
 *   - a same-origin gate for `/api/*` that compares `Origin` against the
 *     request's own `Host`;
 *   - `escapeHtml` neutralising a stored `<img onerror>` payload, plus a CSP
 *     that names no external origin.
 */

const XSS_PAYLOAD = "<img src=x onerror=alert(1)>";

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

/** Same extraction the studio-assets test uses, so both read the shipped asset. */
function loadClientFunction<T>(source: string, name: string): T {
  return new Function(`${extractFunction(source, name)}; return ${name};`)() as T;
}

async function withStudio(fn: (port: number) => Promise<void>): Promise<void> {
  const { root, memoryDir } = setupFixtureRoot();
  const store = openStore(memoryDir);
  const srv = await startUiServer({ port: 0, memoryDir, store });
  try {
    await fn(srv.port);
  } finally {
    srv.close();
    cleanup(root);
  }
}

describe("Studio hardening (issue #520)", () => {
  describe("response headers", () => {
    test("the CSP, nosniff, DENY framing and no-referrer land on every response", async () => {
      await withStudio(async (port) => {
        // Pages, both assets, the API, the 404 fallthrough and the 403 refusal.
        const probes: Array<[string, RequestInit | undefined]> = [
          ["/", undefined],
          ["/assets/studio.js", undefined],
          ["/assets/studio.css", undefined],
          ["/api/memories", undefined],
          ["/api/snapshot", undefined],
          ["/no-such-route", undefined],
          ["/api/memories", { headers: { Origin: "http://evil.example" } }],
        ];
        for (const [path, init] of probes) {
          const res = await fetch(`http://localhost:${port}${path}`, init);
          const csp = res.headers.get("content-security-policy");
          expect(csp).toBe(STUDIO_CSP);
          expect(res.headers.get("x-content-type-options")).toBe("nosniff");
          expect(res.headers.get("x-frame-options")).toBe("DENY");
          expect(res.headers.get("referrer-policy")).toBe("no-referrer");
        }
      });
    });

    test("/api/* is Cache-Control: no-store while the shell stays revalidatable", async () => {
      await withStudio(async (port) => {
        const api = await fetch(`http://localhost:${port}/api/memories`);
        expect(await api.json()).toBeArray();
        expect(api.headers.get("cache-control")).toBe("no-store");

        const page = await fetch(`http://localhost:${port}/`);
        expect(page.headers.get("cache-control")).not.toBe("no-store");
      });
    });

    test("the CSP names no external origin and no inline script policy", async () => {
      await withStudio(async (port) => {
        const csp = (await fetch(`http://localhost:${port}/`)).headers.get("content-security-policy")!;
        // No scheme-ful origin, no scheme-relative `//host`, no wildcard.
        expect(csp).not.toMatch(/https?:\/\//);
        expect(csp).not.toMatch(/\/\//);
        expect(csp).not.toContain("*");
        // Directive-by-directive: 'self' for everything but inline styles.
        expect(csp).toContain("default-src 'self'");
        expect(csp).toContain("script-src 'self'");
        expect(csp).toContain("font-src 'self'");
        expect(csp).toContain("connect-src 'self'");
        expect(csp).toContain("img-src 'self' data:");
        expect(csp).toContain("object-src 'none'");
        expect(csp).toContain("base-uri 'self'");
        expect(csp).toContain("form-action 'self'");
        // Scripts get no inline exemption — that is why the shell carries no on*.
        expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
      });
    });

    test("the shell loads nothing external and carries no inline handler", async () => {
      const shell = STUDIO_HTML_ASSET.body;
      expect(shell).not.toMatch(/https?:\/\/fonts\./);
      expect(shell).not.toMatch(/\son[a-z]+="/);
      // The only subresources are same-origin.
      expect(shell).toContain('href="/assets/studio.css"');
      expect(shell).toContain('src="/assets/studio.js"');
      expect(STUDIO_JS_ASSET.body).not.toMatch(/https?:\/\/(?!localhost)/);
    });
  });

  describe("origin gate for /api/*", () => {
    test("a foreign Origin is refused with 403 and no CORS headers", async () => {
      await withStudio(async (port) => {
        const res = await fetch(`http://localhost:${port}/api/memories`, {
          headers: { Origin: "http://evil.example" },
        });
        expect(res.status).toBe(403);
        expect(res.headers.get("access-control-allow-origin")).toBeNull();
        expect(res.headers.get("access-control-allow-methods")).toBeNull();
        expect((await res.json()).error).toContain("Forbidden: Cross-Origin Request Blocked");
      });
    });

    test("the request's own origin is allowed", async () => {
      await withStudio(async (port) => {
        const res = await fetch(`http://localhost:${port}/api/memories`, {
          headers: { Origin: `http://localhost:${port}` },
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("access-control-allow-origin")).toBe(`http://localhost:${port}`);
        expect(await res.json()).toBeArray();
      });
    });

    test("no Origin at all (curl, a native client) stays allowed", async () => {
      await withStudio(async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/api/memories`);
        expect(res.status).toBe(200);
        // Nothing to confirm, so nothing is granted either.
        expect(res.headers.get("access-control-allow-origin")).toBeNull();
      });
    });

    test("a preflight from a foreign origin is refused before it reaches a route", async () => {
      await withStudio(async (port) => {
        const res = await fetch(`http://localhost:${port}/api/memories`, {
          method: "OPTIONS",
          headers: { Origin: "http://evil.example" },
        });
        expect(res.status).toBe(403);
        expect(res.headers.get("access-control-allow-origin")).toBeNull();
      });
    });

    test("a foreign origin cannot drive a mutation either", async () => {
      await withStudio(async (port) => {
        const res = await fetch(`http://localhost:${port}/api/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "http://evil.example" },
          body: JSON.stringify({ id: "m_1_x" }),
        });
        expect(res.status).toBe(403);
      });
    });

    test("isSameOriginRequest is scheme-insensitive and origin-to-host exact", () => {
      expect(isSameOriginRequest("http://localhost:2222", "localhost:2222")).toBe(true);
      expect(isSameOriginRequest("https://localhost:2222", "localhost:2222")).toBe(true);
      expect(isSameOriginRequest("http://127.0.0.1:2222", "127.0.0.1:2222")).toBe(true);
      // A different loopback port is a different origin.
      expect(isSameOriginRequest("http://localhost:3000", "localhost:2222")).toBe(false);
      // The alias is not the host the request was addressed to.
      expect(isSameOriginRequest("http://localhost:2222", "127.0.0.1:2222")).toBe(false);
      expect(isSameOriginRequest("http://evil.example", "localhost:2222")).toBe(false);
      expect(isSameOriginRequest("null", "localhost:2222")).toBe(false);
      expect(isSameOriginRequest("file://", "localhost:2222")).toBe(false);
      expect(isSameOriginRequest(undefined, "localhost:2222")).toBe(false);
      expect(isSameOriginRequest("http://localhost:2222", undefined)).toBe(false);
    });
  });

  describe("stored XSS: memory content is data, not markup", () => {
    test("a memory carrying <img onerror> is served as JSON and escaped by the client", async () => {
      const { root, memoryDir } = setupFixtureRoot();
      const store = openStore(memoryDir);
      propose(store, {
        title: `payload ${XSS_PAYLOAD} title`,
        content: `body ${XSS_PAYLOAD} end`,
        project: "aria",
        tags: [XSS_PAYLOAD],
        confirmed: true,
      });
      const srv = await startUiServer({ port: 0, memoryDir, store });
      try {
        const res = await fetch(`http://localhost:${srv.port}/api/memories`);
        expect(res.status).toBe(200);
        // Served as data: JSON, never text/html, so the browser will not parse it.
        expect(res.headers.get("content-type")).toContain("application/json");
        const memories = (await res.json()) as Array<{ title: string; content: string; tags: string[] }>;
        const hit = memories.find((m) => m.content.includes("<img src=x onerror=alert(1)>"));
        expect(hit).toBeDefined();
        // The payload survives verbatim as a string — escaping is the renderer's job.
        expect(hit!.content).toContain(XSS_PAYLOAD);
        expect(hit!.title).toContain(XSS_PAYLOAD);

        // The client's own escapeHtml, evaluated from the shipped asset.
        const clientEscapeHtml = loadClientFunction<(str: unknown) => string>(
          STUDIO_JS_ASSET.body,
          "escapeHtml",
        );
        const rendered = `<div class="card-title">${clientEscapeHtml(hit!.title)}</div>`;
        expect(rendered).not.toContain("<img");
        expect(rendered).toContain("&lt;img src=x onerror=alert(1)&gt;");
        // Every memory-derived field the card template touches is neutralised.
        for (const field of [hit!.title, hit!.content, hit!.tags.join(" ")]) {
          expect(clientEscapeHtml(field)).not.toContain("<");
        }
      } finally {
        srv.close();
        cleanup(root);
      }
    });

    test("no memory-derived field reaches innerHTML without escapeHtml or safeClass", async () => {
      // Cheap regression net for the audit in #520: the templates that render
      // memory records must never interpolate a raw field into markup.
      const source = STUDIO_JS_ASSET.body;
      const offenders = [
        "<div class=\"card-type type-${m.type",                   // renderList
        "<span class=\"meta-tag mono\">ID: ${m.id}",              // selectMemory
        "<span class=\"meta-tag\">Status: ${m.status}",           // selectMemory
        "<span class=\"adr-badge adr-proposed\">${res.memory.type}", // mesh recall
      ];
      for (const pattern of offenders) {
        expect(source).not.toContain(pattern);
      }
      expect(source).toContain("escapeHtml(m.type || 'discovery')");
      expect(source).toContain("escapeHtml(m.status || '')");
      expect(source).toContain("function safeClass(value)");
    });
  });
});
