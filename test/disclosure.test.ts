import { describe, test, expect } from "bun:test";
import { openStore, propose } from "../src/store.ts";
import { formatPromptContext } from "../src/retrieval.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";

function setup() {
  const { root, memoryDir } = setupFixtureRoot();
  const store = openStore(memoryDir);
  propose(store, {
    title: "Redis Cache Config",
    content: "Use maxmemory-policy allkeys-lru in Redis cluster.",
    project: "core",
    type: "operation",
    confirmed: true,
    tags: ["redis", "cache"],
  });
  return { root, memoryDir, store };
}

describe("3-layer progressive disclosure", () => {
  test("L1 renders one line per memory (id + title only)", () => {
    const { root, memoryDir, store } = setup();
    const md = formatPromptContext(store, memoryDir, "redis cache", { depth: "L1" }).markdown;
    const section = md.split("### Relevant Memories & Learned Patterns")[1] ?? "";
    expect(section).toMatch(/^- m_[0-9]+_[a-z0-9_-]+ Redis Cache Config$/m);
    expect(section).not.toContain("allkeys-lru");
    expect(section).not.toContain("*Tags:");
    cleanup(root);
  });

  test("L2 (default) renders title + content + tags", () => {
    const { root, memoryDir, store } = setup();
    const explicit = formatPromptContext(store, memoryDir, "redis cache", { depth: "L2" }).markdown;
    const def = formatPromptContext(store, memoryDir, "redis cache", {}).markdown;
    expect(explicit).toBe(def);
    expect(explicit).toContain("#### Redis Cache Config");
    expect(explicit).toContain("allkeys-lru");
    expect(explicit).toContain("*Tags: redis, cache*");
    expect(explicit).not.toContain("<raw>");
    cleanup(root);
  });

  test("L3 renders full raw entry metadata block", () => {
    const { root, memoryDir, store } = setup();
    const md = formatPromptContext(store, memoryDir, "redis cache", { depth: "L3" }).markdown;
    expect(md).toContain("<raw>");
    expect(md).toContain("</raw>");
    expect(md).toContain("id: m_");
    expect(md).toContain("status: confirmed");
    expect(md).toContain("project: core");
    expect(md).toContain("type: operation");
    expect(md).toContain("verification: user-confirmed");
    expect(md).toContain("allkeys-lru");
    cleanup(root);
  });
});
