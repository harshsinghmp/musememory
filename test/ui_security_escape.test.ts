import { describe, test, expect } from "bun:test";
import { escapeHtml, startUiServer } from "../src/ui.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";
import { openStore } from "../src/store.ts";

describe("Wave 5 - Task 1: UI XSS Escaping & Unit Test Suite (T-380, T-002, T-003)", () => {
  describe("T-380: escapeHtml pure function unit tests without DOM dependency", () => {
    test("escapes basic HTML delimiters (<, >, &, \", ')", () => {
      expect(escapeHtml("<script>alert('xss')</script>")).toBe(
        "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;",
      );
      expect(escapeHtml('"><img src=x onerror=alert(1)>')).toBe(
        "&quot;&gt;&lt;img src=x onerror=alert(1)&gt;",
      );
      expect(escapeHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
      expect(escapeHtml('"quoted" & \'single-quoted\'')).toBe(
        "&quot;quoted&quot; &amp; &#39;single-quoted&#39;",
      );
    });

    test("handles empty, nullish or non-string inputs safely", () => {
      expect(escapeHtml("")).toBe("");
      expect(escapeHtml(undefined as unknown as string)).toBe("");
      expect(escapeHtml(null as unknown as string)).toBe("");
      expect(escapeHtml(123 as unknown as string)).toBe("123");
    });

    test("escapes attribute event injection payloads", () => {
      const payload = "1' onclick='alert(1)' onmouseover='stealCookies()";
      const escaped = escapeHtml(payload);
      expect(escaped).not.toContain("'");
      expect(escaped).toContain("&#39; onclick=&#39;alert(1)&#39;");
    });
  });

  describe("T-002 & T-003: UI client template escaping inspection", () => {
    test("serves client HTML where wiki pages, audit trails, and handoffs use escapeHtml", async () => {
      const { root, memoryDir } = setupFixtureRoot();
      const store = openStore(memoryDir);
      const srv = await startUiServer({ port: 0, memoryDir, store });

      const res = await fetch(`http://localhost:${srv.port}/`);
      expect(res.status).toBe(200);
      const html = await res.text();

      // T-002: Wiki title and slug must be wrapped with escapeHtml
      expect(html).toContain("escapeHtml(p.title)");
      expect(html).toContain("escapeHtml(p.slug)");
      expect(html).not.toContain("📖 ' + p.title + '</div>");

      // T-003: Audit log rows must escape entry_id and actor
      expect(html).toContain("escapeHtml(r.entry_id)");
      expect(html).toContain("escapeHtml(r.actor");

      // Handoff progress checkpoints must be escaped
      expect(html).toContain("escapeHtml(p)");

      // T-361: Health checklist remediation items must sanitize priority class and escape priority label
      expect(html).toContain("const safePriority = escapeHtml(rawPriority);");
      expect(html).toContain("replace(/[^a-z0-9_-]/g, '')");
      expect(html).toContain("[${safePriority}]");
      expect(html).not.toContain("[${item.priority}]");

      srv.close();
      cleanup(root);
    });
  });
});
