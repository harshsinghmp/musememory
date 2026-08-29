import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, confirm } from "../store.ts";
import { buildTreeIndex, loadTreeIndex, searchTree, upsertMemory, rebuildTreeIndex, TreeSearchOptions } from "./tree-index.ts";

describe("Tree-Indexed Retrieval", () => {
  let testDir: string;
  let memoryDir: string;
  let store: ReturnType<typeof openStore>;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "musememory-tree-index-"));
    memoryDir = join(testDir, ".memory");
    store = openStore(memoryDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function createMemories(count: number, project = "test", type: "fix" | "architecture" | "decision" = "fix") {
    const memories = [];
    for (let i = 0; i < count; i++) {
      const entry = propose(store, {
        content: `Memory ${i}: This is a test memory about topic ${i % 3} with some content for ${project}.`,
        project,
        title: `${project} ${type} Test Memory ${i}`,
        type,
        confirmed: true,
      });
      memories.push(entry);
    }
    return memories;
  }

  it("builds tree index from confirmed memories", () => {
    createMemories(10);
    const index = buildTreeIndex(store, memoryDir);
    
    expect(index).not.toBeNull();
    expect(index!.version).toBe(1);
    expect(index!.totalNodes).toBeGreaterThan(0);
    expect(index!.totalMemories).toBe(10);
    expect(index!.builtAt).toBeDefined();
  });

  it("partitions by project and type", () => {
    createMemories(5, "proj1", "fix");
    createMemories(3, "proj2", "architecture");
    
    const index = buildTreeIndex(store, memoryDir);
    
    expect(Object.keys(index!.partitions).length).toBe(2);
    expect(index!.partitions["proj1|fix"]).toBeDefined();
    expect(index!.partitions["proj2|architecture"]).toBeDefined();
  });

  it("loads tree index from disk", () => {
    createMemories(5);
    buildTreeIndex(store, memoryDir);
    
    const loaded = loadTreeIndex(memoryDir);
    
    expect(loaded).not.toBeNull();
    expect(loaded!.totalMemories).toBe(5);
  });

  it("searches tree index with token budget", () => {
    createMemories(20);
    buildTreeIndex(store, memoryDir);
    const index = loadTreeIndex(memoryDir)!;
    
    const options: TreeSearchOptions = {
      query: "topic 1",
      tokenBudget: 500,
      maxNodes: 5,
    };
    
    const result = searchTree(index, options);
    
    expect(result.nodes.length).toBeLessThanOrEqual(5);
    expect(result.tokensUsed).toBeLessThanOrEqual(500);
    expect(result.total).toBeGreaterThan(0);
  });

  it("filters by project and type", () => {
    createMemories(5, "projA", "fix");
    createMemories(5, "projB", "fix");
    buildTreeIndex(store, memoryDir);
    const index = loadTreeIndex(memoryDir)!;
    
    const resultA = searchTree(index, { query: "test", project: "projA" });
    const resultB = searchTree(index, { query: "test", project: "projB" });
    
    expect(resultA.nodes.length).toBeGreaterThan(0);
    expect(resultB.nodes.length).toBeGreaterThan(0);
    expect(resultA.nodes.every(n => n.node.project === "projA")).toBe(true);
    expect(resultB.nodes.every(n => n.node.project === "projB")).toBe(true);
  });

  it("respects disclosure depth token estimation", () => {
    createMemories(5);
    buildTreeIndex(store, memoryDir);
    const index = loadTreeIndex(memoryDir)!;
    
    const resultL1 = searchTree(index, { query: "test", disclosureDepth: "L1", tokenBudget: 1000 });
    const resultL2 = searchTree(index, { query: "test", disclosureDepth: "L2", tokenBudget: 1000 });
    const resultL3 = searchTree(index, { query: "test", disclosureDepth: "L3", tokenBudget: 1000 });
    
    expect(resultL1.tokensUsed).toBeLessThanOrEqual(resultL2.tokensUsed);
    expect(resultL2.tokensUsed).toBeLessThanOrEqual(resultL3.tokensUsed);
  });

  it("paginates results", () => {
    createMemories(15);
    buildTreeIndex(store, memoryDir);
    const index = loadTreeIndex(memoryDir)!;
    
    const page1 = searchTree(index, { query: "test", page: 1, pageSize: 5 });
    const page2 = searchTree(index, { query: "test", page: 2, pageSize: 5 });
    
    expect(page1.nodes.length).toBeLessThanOrEqual(5);
    expect(page2.nodes.length).toBeLessThanOrEqual(5);
    const ids1 = page1.nodes.map(n => n.node.id);
    const ids2 = page2.nodes.map(n => n.node.id);
    expect(ids1.some(id => ids2.includes(id))).toBe(false);
  });

  it("upserts new memory into existing index", async () => {
    createMemories(5);
    buildTreeIndex(store, memoryDir);
    
    const newEntry = propose(store, {
      content: "New upserted memory about topic 99",
      project: "test",
      title: "Upserted Memory",
      type: "fix",
      confirmed: true,
    });
    
    await upsertMemory(newEntry, memoryDir);
    
    const index = loadTreeIndex(memoryDir)!;
    expect(index.totalMemories).toBe(6);
    
    const result = searchTree(index, { query: "topic 99" });
    expect(result.total).toBeGreaterThan(0);
  });

  it("rebuilds index from scratch", () => {
    createMemories(10);
    buildTreeIndex(store, memoryDir);
    
    const rebuilt = rebuildTreeIndex(store, memoryDir);
    
    expect(rebuilt.totalMemories).toBe(10);
    expect(rebuilt.totalNodes).toBeGreaterThan(0);
  });

  it("handles empty store", () => {
    const index = buildTreeIndex(store, memoryDir);
    expect(index.totalNodes).toBe(0);
    expect(index.totalMemories).toBe(0);
    expect(index.partitions).toEqual({});
  });

  it("partitions respect shard threshold", () => {
    createMemories(15000);
    const index = buildTreeIndex(store, memoryDir, { shardThreshold: 5000 });
    
    const partition = index.partitions["test|fix"];
    expect(partition).toBeDefined();
    if (partition) {
      expect(partition.shards.length).toBeGreaterThan(1);
      const totalNodes = partition.shards.reduce((sum, s) => sum + s.nodes.length, 0);
      expect(totalNodes).toBeLessThanOrEqual(5000 * partition.shards.length);
    }
  });
});