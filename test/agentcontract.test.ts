import { describe, test, expect, afterEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openStore, propose } from "../src/store.ts";
import { queryContext } from "../src/retrieval.ts";
import { parseAgentMemoryContract, resolveAgentFile } from "../src/agentcontract.ts";
import { makeTempRoot, cleanup } from "./helpers.ts";

let roots: string[] = [];
afterEach(() => {
  for (const r of roots) cleanup(r);
  roots = [];
});

describe("SOW-106 muse-agents integration contract", () => {
  test("parses a full memory: frontmatter contract", () => {
    const md = `---\nname: backend-arch\ndivision: dev\nmemory:\n  scope: project\n  types: [fix, architecture]\n  tags: [backend]\n---\n# Backend Arch\n`;
    expect(parseAgentMemoryContract(md)).toEqual({
      scope: "project",
      types: ["fix", "architecture"],
      tags: ["backend"],
    });
  });

  test("missing memory field = null (backward-compatible default)", () => {
    const md = `---\nname: plain-agent\n---\nbody\n`;
    expect(parseAgentMemoryContract(md)).toBeNull();
  });

  test("malformed frontmatter or non-frontmatter content = null", () => {
    expect(parseAgentMemoryContract("no frontmatter here")).toBeNull();
    expect(parseAgentMemoryContract("---\nunterminated: [oops\n")).toBeNull();
    expect(parseAgentMemoryContract("---\nname: x\nmemory: not-a-map\n---\n")).toBeNull();
  });

  test("empty memory block = null", () => {
    expect(parseAgentMemoryContract("---\nmemory:\n  unknown_key: 1\n---\n")).toBeNull();
  });

  test("resolveAgentFile probes .agents/<name>.md in the workspace root", () => {
    const root = makeTempRoot();
    roots.push(root);
    mkdirSync(join(root, ".agents"), { recursive: true });
    const file = join(root, ".agents", "reviewer.md");
    writeFileSync(file, "---\nmemory:\n  types: [fix]\n---\n");
    expect(resolveAgentFile("reviewer", root)).toBe(file);
    expect(resolveAgentFile("nonexistent-agent", root)).toBeNull();
    expect(resolveAgentFile(file, root)).toBe(file); // explicit path
  });

  test("queryContext filters by contract types and tags", () => {
    const root = makeTempRoot();
    roots.push(root);
    const store = openStore(`${root}/.memory`);
    propose(store, { content: "auth workaround", project: "p", type: "fix", tags: ["backend"], confirmed: true });
    propose(store, { content: "css spacing rule", project: "p", type: "preference", tags: ["frontend"], confirmed: true });
    propose(store, { content: "db schema note", project: "p", type: "architecture", confirmed: true });

    const backendOnly = queryContext(store, "", { types: ["fix"], tags: ["backend"] });
    expect(backendOnly.results.map((r) => r.entry.content)).toEqual(["auth workaround"]);

    // no contract (undefined filters) = backward-compatible full results
    const all = queryContext(store, "");
    expect(all.results.length).toBe(3);
  });

  test("end-to-end: agent file drives context filtering", () => {
    const root = makeTempRoot();
    roots.push(root);
    const agentsDir = join(root, ".agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(agentsDir, "gate.md"),
      "---\nname: gate\nmemory:\n  types: [decision, constraint]\n---\n",
    );
    const store = openStore(`${root}/.memory`);
    propose(store, { content: "use pnpm not npm", project: "p", type: "decision", confirmed: true });
    propose(store, { content: "tailwind class order", project: "p", type: "preference", confirmed: true });

    const contract = parseAgentMemoryContract(
      // resolveAgentFile already verified existence; read via the resolved path
      require("node:fs").readFileSync(resolveAgentFile("gate", root)!, "utf8"),
    )!;
    const res = queryContext(store, "", { types: contract.types, tags: contract.tags });
    expect(res.results.map((r) => r.entry.content)).toEqual(["use pnpm not npm"]);
  });
});
