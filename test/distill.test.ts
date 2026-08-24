import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openStore, propose, save } from "../src/store.ts";
import { distillSkills } from "../src/distill.ts";
import { makeTempRoot, cleanup } from "./helpers.ts";

function setup() {
  const root = makeTempRoot();
  const memoryDir = join(root, ".memory");
  const store = openStore(memoryDir);
  return { root, memoryDir, store };
}

/** Three confirmed fix entries sharing the redis tag + title tokens. */
function seedRedisFixes(store: ReturnType<typeof openStore>) {
  const seeds = [
    { title: "Redis cache eviction fix", content: "Set eviction policy to allkeys-lru\nRestart cache pod after config change" },
    { title: "Redis cache TTL fix", content: "Raise TTL to 300s\nRestart cache pod after config change" },
    { title: "Redis cache persistence fix", content: "Enable AOF everysec persistence" },
  ];
  return seeds.map((s, i) => {
    const e = propose(store, { ...s, project: "aria", type: "fix", tags: ["redis"], confirmed: true });
    // Control ages: seeds are created in quick succession; make ordering explicit.
    e.created_at = new Date(Date.now() - (100 - i) * 60_000).toISOString();
    save(store, e);
    return e;
  });
}

describe("self-evolving skill distillation", () => {
  test("threshold gating: clusters below --min-count produce nothing", () => {
    const { root, memoryDir, store } = setup();
    seedRedisFixes(store);

    expect(distillSkills(store, root, { minCount: 4 }).created.length).toBe(0);
    const report = distillSkills(store, root, { minCount: 3 });
    expect(report.created.length).toBe(1);
    expect(report.clustersBelowThreshold).toBe(0);

    cleanup(root);
  });

  test("generates SKILL.md with frontmatter and deduped age-ordered steps", () => {
    const { root, memoryDir, store } = setup();
    seedRedisFixes(store);

    const report = distillSkills(store, root);
    expect(report.created.length).toBe(1);
    const skill = report.created[0];
    expect(skill.slug).toContain("redis");

    const md = readFileSync(skill.path, "utf8");
    expect(md).toMatch(/^---\nname: /);
    expect(md).toContain("description: Distilled recurring fix pattern from 3 confirmed memories");
    // Deduped common line appears exactly once
    expect(md.split("Restart cache pod after config change").length - 1).toBe(1);
    // Age order: first seed's unique line before second seed's unique line
    expect(md.indexOf("allkeys-lru")).toBeLessThan(md.indexOf("Raise TTL to 300s"));
    expect(md.indexOf("Raise TTL to 300s")).toBeLessThan(md.indexOf("AOF everysec"));

    cleanup(root);
  });

  test("never overwrites an existing skill folder", () => {
    const { root, memoryDir, store } = setup();
    seedRedisFixes(store);

    const first = distillSkills(store, root);
    const skillPath = first.created[0].path;
    writeFileSync(join(skillPath, "..", "SKILL.md"), "SENTINEL", "utf8");

    const second = distillSkills(store, root);
    expect(second.created.length).toBe(0);
    expect(second.skippedExisting.length).toBe(1);
    expect(readFileSync(skillPath, "utf8")).toBe("SENTINEL");

    cleanup(root);
  });

  test("dry-run reports skills but writes nothing", () => {
    const { root, memoryDir, store } = setup();
    seedRedisFixes(store);

    const report = distillSkills(store, root, { dryRun: true });
    expect(report.created.length).toBe(1);
    expect(existsSync(join(root, ".agents"))).toBe(false);

    cleanup(root);
  });

  test("secret-scans generated SKILL.md content before writing", () => {
    const { root, memoryDir, store } = setup();
    const e = propose(store, { title: "Redis cache eviction fix", content: "clean line", project: "aria", type: "fix", tags: ["redis"], confirmed: true });
    // Inject a secret directly into storage (bypassing propose's scanner)
    e.content = "key is sk-proj-12345678901234567890123456";
    save(store, e, { skipSecretCheck: true });
    const e2 = propose(store, { title: "Redis cache TTL fix", content: "raise ttl", project: "aria", type: "fix", tags: ["redis"], confirmed: true });
    save(store, e2, { skipSecretCheck: true });
    const e3 = propose(store, { title: "Redis cache persistence fix", content: "enable aof", project: "aria", type: "fix", tags: ["redis"], confirmed: true });
    save(store, e3, { skipSecretCheck: true });

    expect(() => distillSkills(store, root)).toThrow(/Secret detected in generated SKILL\.md/);
    expect(existsSync(join(root, ".agents", "skills"))).toBe(false);

    cleanup(root);
  });
});
