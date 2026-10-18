import { describe, test, expect } from "bun:test";
import { renderConceptPage } from "../src/wiki/render.ts";
import { openStore, propose, confirm } from "../src/store.ts";
import { compileWiki, getWikiPage } from "../src/wiki/compiler.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";
import type { ConceptPage } from "../src/wiki/types.ts";

describe("T-353: Wiki Frontmatter YAML Scalar Escaping", () => {
  test("renders concept page with quotes and special characters safely", () => {
    const rendered = renderConceptPage({
      slug: "special-title",
      title: 'Fix "auth" vulnerability & JWT: secret',
      type: "concept",
      project: "core",
      updatedAt: "2026-10-18T00:00:00Z",
      tags: ['tag"with"quotes', "col:on", "normal-tag"],
      relatedConcepts: ['other"concept'],
      relatedEntities: ["entity:special"],
      relatedPages: [],
      memoryRefs: ['mem"1'],
      summary: "Summary text",
      content: "Main content",
    });

    expect(rendered).toContain('title: "Fix \\"auth\\" vulnerability & JWT: secret"');
    expect(rendered).toContain('tags: ["tag\\"with\\"quotes","col:on","normal-tag"]');
    expect(rendered).toContain('relatedConcepts: ["other\\"concept"]');
    expect(rendered).toContain('relatedEntities: ["entity:special"]');
    expect(rendered).toContain('memoryRefs: ["mem\\"1"]');
  });

  test("compiles and retrieves wiki pages containing quotes without frontmatter corruption", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const m = propose(store, {
      title: 'Architecture Decision: "Zero-Daemon" Mode',
      content: 'We avoid running permanent resident daemons for "security" and stability.',
      type: "architecture",
      project: "test-app",
      tags: ['ad"r', "zero-daemon", "invariants:lock"],
    });
    confirm(store, m.id);

    const res = compileWiki(store, memoryDir, { minClusterSize: 1 });
    expect(res.pagesCreated.length).toBeGreaterThan(0);

    const page = getWikiPage(memoryDir, res.pagesCreated[0].slug) as ConceptPage | null;
    expect(page).not.toBeNull();
    expect(page?.tags).toContain('ad"r');
    expect(page?.content).toContain('Zero-Daemon');

    cleanup(root);
  });
});
