/**
 * Generates the agent-readable documentation layer:
 *
 *   public/llms.txt        — a curated map: what this site is, and where each
 *                             piece of documentation lives.
 *   public/llms-full.txt   — the entire site as plain text, derived from the
 *                             built HTML so it can never drift from the pages.
 *
 * Why build-generated instead of hand-written
 * --------------------------------------------
 * A hand-maintained `llms-full.txt` is a second copy of the site, and a second
 * copy is a second thing to forget. This script reads `dist/` after `astro
 * build` and emits plain text from the same HTML a browser would render.
 * The curated `llms.txt` still points at the canonical sources (repo docs,
 * agent reference) rather than duplicating them.
 *
 * Usage:
 *   bun run --cwd apps/website build      # astro build
 *   bun run --cwd apps/website scripts/build-llms-txt.ts
 */
import { readdirSync, statSync } from "node:fs";
// The curated map quotes the same numbers the site does, from the same
// generated manifest, so the two cannot disagree.
import claims from "../../../claims.json";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, "../dist");
const BASE = "/musememory";

/* ── Minimal HTML → text ──────────────────────────────────────────────────
   A full HTML parser is not worth the dependency here: the site is our own
   markup with a known shape (h1-h3, p, li, pre, a, dl). We strip the rest. */
function htmlToText(html: string): string {
  let s = html;

  // Drop non-content elements entirely (contents included).
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<svg\b[\s\S]*?<\/svg>/gi, "");
  s = s.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "");

  // Preserve code blocks before any other inline handling.
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner: string) => {
    const text = inner
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return `\n\n\`\`\`\n${text}\n\`\`\`\n\n`;
  });

  // Headings.
  s = s.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_m, i) => `\n\n# ${strip(i)}\n\n`);
  s = s.replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_m, i) => `\n\n## ${strip(i)}\n\n`);
  s = s.replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_m, i) => `\n\n### ${strip(i)}\n\n`);
  s = s.replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, (_m, i) => `\n\n#### ${strip(i)}\n\n`);

  // Definition lists: term / definition.
  s = s.replace(/<dt\b[^>]*>([\s\S]*?)<\/dt>/gi, (_m, i) => `\n**${strip(i)}**\n`);
  s = s.replace(/<dd\b[^>]*>([\s\S]*?)<\/dd>/gi, (_m, i) => `${strip(i)}\n`);

  // Lists.
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, i) => `- ${strip(i)}\n`);

  // Links: keep the text and the absolute target. The built HTML already has
  // BASE_URL baked into every internal href, so an internal link must NOT be
  // prefixed with the base a second time.
  s = s.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
    const text = strip(inner);
    if (!text) return "";
    if (href.startsWith("#")) return text;
    const abs = href.startsWith("http") ? href : `https://harshsinghmp.github.io${href.startsWith("/") ? href : `/${href}`}`;
    return `${text} (${abs})`;
  });

  // Inline code.
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, i) => `\`${strip(i)}\``);

  // Paragraphs and block boundaries.
  s = s.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_m, i) => `\n${strip(i)}\n\n`);
  s = s.replace(/<(?:div|section|header|footer|nav|main|article|aside|ul|ol|table|tr|figure|figcaption)\b[^>]*>/gi, "\n");
  s = s.replace(/<\/(?:div|section|header|footer|nav|main|article|aside|ul|ol|table|tr|figure|figcaption)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");

  // Entities.
  s = s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&hellip;/g, "…")
    .replace(/&rarr;/g, "→")
    .replace(/&amp;/g, "&");

  // Collapse whitespace.
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return s;
}

function strip(inner: string): string {
  return inner
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".html")) out.push(full);
  }
  return out;
}

const PAGES: Array<{ path: string; title: string }> = [
  {
    path: "index.html",
    title: "Home — the problem, how it works, architecture, the command surface, proof, FAQ",
  },
  { path: "docs/index.html", title: "Docs — quickstart, CLI, MCP tools, hooks, trust gates" },
  { path: "compare/index.html", title: "Compare — 14-capability comparison against other memory approaches" },
];

const CURATED = `# Muse Memory

> Persistent, local-first memory for AI coding agents. Runs in-process on the user's
> machine: sub-${claims.latency.recallMillis}ms recall, write-time citation verification, the majority
> of coding agents wired by one command, ${claims.backgroundDaemons} background daemons, MIT licensed.
>
> Version ${claims.version} · https://harshsinghmp.github.io/musememory/

Muse Memory gives an AI coding agent a memory that survives between sessions. Every
memory is checked against the real code before it is stored and re-checked before it
is served, so an agent is never handed a fact that has since become false.

## Install

\`\`\`bash
npx musememory connect
\`\`\`

No account, no API key, no configuration file, no background daemon. The store is
two plain directories: \`.memory/\` inside each project and \`~/.memory/\` globally.

## Pages

${PAGES.map((p) => `- [${p.title}](https://harshsinghmp.github.io${BASE}/${p.path === "index.html" ? "" : p.path.replace(/index\.html$/, "")})`).join("\n")}

## Canonical documentation (authoritative)

- Repository README: https://github.com/harshsinghmp/musememory#readme
- Agent reference (exact CLI, MCP and file-layout contracts): https://github.com/harshsinghmp/musememory/blob/main/docs/agent-reference.md
- User guide: https://github.com/harshsinghmp/musememory/blob/main/docs/user-guide.md
- Core concepts: https://github.com/harshsinghmp/musememory/blob/main/docs/concepts.md
- Team setup: https://github.com/harshsinghmp/musememory/blob/main/docs/team-getting-started.md
- Full text of this site: https://harshsinghmp.github.io${BASE}/llms-full.txt

## MCP tools an agent should know

| Tool | Purpose |
| --- | --- |
| \`get_context\` | Mandatory on the first turn of a session. Fused recall: constraints, ranked memories, negative lessons, code anchors, under one token budget. |
| \`memory_capture\` | Persist a decision, fix or constraint. Every write is secret-scanned and citation-verified. |
| \`search\` | Full-text search across the store. |
| \`memory_current\` | Read or write the active working constraints in CURRENT.md. |
| \`muse_context\` | Task-shaped fused context for a specific job. |
| \`muse_why\` | Explain why the code is the way it is, from ADRs and past fixes. |
| \`memory_supersede\` | Replace an outdated memory with a newer one. |

${claims.mcpTools} tools are registered in total, exposed through ${claims.mcpProfiles} task-focused
profiles (\`core\`, \`coding\`, \`debugging\`, \`review\`, \`architecture\`, \`maintenance\`, \`full\`).

## Behaviour an agent must know

1. Call \`get_context\` on the first turn of any session.
2. Capture decisions, fixes and constraints as they happen — \`memory_capture\`.
3. Supersede rather than delete when knowledge changes — \`memory_supersede\`.
4. Every write is scanned for credentials and refused if one is present.
5. Every code citation is verified against the live filesystem at write time and
   re-checked at recall; drifted memories are withheld and reported, not served.

## Optional

- [npm](https://www.npmjs.com/package/musememory) · [GitHub](https://github.com/harshsinghmp/musememory)
`;

async function main(): Promise<void> {
  const files = walk(DIST);
  const parts: string[] = [];

  for (const file of files.sort()) {
    const rel = relative(DIST, file);
    if (rel === "404.html") continue;
    const html = await Bun.file(file).text();
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : rel;
    const text = htmlToText(html);
    if (!text) continue;
    const url = `https://harshsinghmp.github.io${BASE}/${rel === "index.html" ? "" : rel.replace(/index\.html$/, "")}`;
    parts.push(`# ${title}\n\n> Source: ${url}\n\n${text}`);
  }

  const full = `# Muse Memory — full site text\n\n> Plain-text rendering of https://harshsinghmp.github.io${BASE}/\n> Generated from the built site. The repository README is the authoritative source.\n\n---\n\n${parts.join("\n\n---\n\n")}\n`;

  await Bun.write(join(DIST, "llms.txt"), CURATED);
  await Bun.write(join(DIST, "llms-full.txt"), full);

  console.log(
    `llms.txt        ${(CURATED.length / 1024).toFixed(1)} KB\nllms-full.txt   ${(full.length / 1024).toFixed(1)} KB  (${files.length} pages scanned)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
