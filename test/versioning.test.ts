import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, get } from "../src/store.ts";
import { parseFlags } from "../src/cli/shared.ts";
import {
  handleBranchCommand,
  handleCheckoutCommand,
  handleBlameCommand,
  handleLsBranchesCommand,
} from "../src/cli/versioning.ts";

describe("Versioning CLI (R23)", () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-ver-test-"));
    memoryDir = join(tmpDir, ".memory");
    openStore(memoryDir);
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("branch writes a branch ref for a semantic dotted path", async () => {
    const store = openStore(memoryDir);
    const entry = propose(store, {
      content: "Database connection timeout resolves at 30s",
      project: "api-service",
      title: "DB timeout fix",
      type: "fix",
      confirmed: true,
    });

    const exitCode = await handleBranchCommand(parseFlags([entry.id, "--path", "db.timeout", "--dir", tmpDir]));
    expect(exitCode).toBe(0);

    // The branch ref is persisted as JSON under .memory/branches/
    const branchFiles = readdirSync(join(memoryDir, "branches"));
    expect(branchFiles).toHaveLength(1);
    const ref = JSON.parse(readFileSync(join(memoryDir, "branches", branchFiles[0]), "utf8"));
    expect(ref.id).toBe(entry.id);
    expect(ref.mem_path).toBe("db.timeout");
  });

  it("branch supports an optional label", async () => {
    const store = openStore(memoryDir);
    const entry = propose(store, {
      content: "Cache invalidation is event driven",
      project: "cache-service",
      title: "Cache policy",
      type: "architecture",
    });

    const exitCode = await handleBranchCommand(
      parseFlags([entry.id, "--path", "cache.policy.invalidation", "--label", "prod", "--dir", tmpDir]),
    );
    expect(exitCode).toBe(0);

    const branchFiles = readdirSync(join(memoryDir, "branches"));
    const ref = JSON.parse(readFileSync(join(memoryDir, "branches", branchFiles[0]), "utf8"));
    expect(ref.label).toBe("prod");
  });

  it("checkout retrieves a memory by its mem_path branch", async () => {
    const store = openStore(memoryDir);
    const entry = propose(store, {
      content: "Cache invalidation policy is event driven",
      project: "cache-service",
      title: "Cache policy",
      type: "architecture",
    });

    await handleBranchCommand(parseFlags([entry.id, "--path", "cache.policy.invalidation", "--dir", tmpDir]));

    const exitCode = await handleCheckoutCommand(parseFlags(["cache.policy.invalidation", "--dir", tmpDir]));
    expect(exitCode).toBe(0);
  });

  it("checkout retrieves a memory by entry id", async () => {
    const store = openStore(memoryDir);
    const entry = propose(store, {
      content: "API rate limit is 1000 requests per minute",
      project: "api-service",
      title: "Rate limit config",
      type: "constraint",
    });

    const exitCode = await handleCheckoutCommand(parseFlags([entry.id, "--dir", tmpDir]));
    expect(exitCode).toBe(0);
  });

  it("checkout fails for an unknown path", async () => {
    const exitCode = await handleCheckoutCommand(parseFlags(["nonexistent.path", "--dir", tmpDir]));
    expect(exitCode).toBe(1);
  });

  it("blame reports access metadata for a memory", async () => {
    const store = openStore(memoryDir);
    const entry = propose(store, {
      content: "Auth token expiry set to 24h",
      project: "auth-service",
      title: "Token expiry",
      type: "constraint",
      confirmed: true,
    });

    // Each get() records an access, so access_count / last_accessed_at should advance.
    const first = get(store, entry.id);
    const firstCount = first?.access_count ?? 0;
    expect(first?.last_accessed_at).toBeTruthy();
    expect(firstCount).toBeGreaterThanOrEqual(1);

    get(store, entry.id);

    const exitCode = await handleBlameCommand(parseFlags([entry.id, "--dir", tmpDir]));
    expect(exitCode).toBe(0);
  });

  it("blame fails for an unknown id", async () => {
    const exitCode = await handleBlameCommand(parseFlags(["m_9999999999_nonexistent", "--dir", tmpDir]));
    expect(exitCode).toBe(1);
  });

  it("ls-branches lists every registered branch", async () => {
    const store = openStore(memoryDir);
    const e1 = propose(store, { content: "Fix alpha in service one", project: "p1", title: "Fix A" });
    const e2 = propose(store, { content: "Fix beta in service two", project: "p2", title: "Fix B" });

    await handleBranchCommand(parseFlags([e1.id, "--path", "service.a", "--dir", tmpDir]));
    await handleBranchCommand(parseFlags([e2.id, "--path", "service.b", "--label", "prod", "--dir", tmpDir]));

    const exitCode = await handleLsBranchesCommand(parseFlags(["--dir", tmpDir]));
    expect(exitCode).toBe(0);
    expect(readdirSync(join(memoryDir, "branches")).filter((f) => f.endsWith(".json"))).toHaveLength(2);
  });

  it("ls-branches reports empty when no branches exist", async () => {
    const exitCode = await handleLsBranchesCommand(parseFlags(["--dir", tmpDir]));
    expect(exitCode).toBe(0);
  });

  it("branch requires the --path flag", async () => {
    const store = openStore(memoryDir);
    const entry = propose(store, { content: "Test entry without a path", project: "p", title: "Test" });

    const exitCode = await handleBranchCommand(parseFlags([entry.id, "--dir", tmpDir]));
    expect(exitCode).toBe(2);
  });

  it("branch requires an id argument", async () => {
    const exitCode = await handleBranchCommand(parseFlags(["--path", "some.path", "--dir", tmpDir]));
    expect(exitCode).toBe(2);
  });

  it("checkout requires a target argument", async () => {
    const exitCode = await handleCheckoutCommand(parseFlags(["--dir", tmpDir]));
    expect(exitCode).toBe(2);
  });

  it("blame requires an id argument", async () => {
    const exitCode = await handleBlameCommand(parseFlags(["--dir", tmpDir]));
    expect(exitCode).toBe(2);
  });
});
