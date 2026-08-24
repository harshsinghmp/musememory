import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { openStore, list } from "../src/store.ts";
import { installGitHook, harvestAuto, globToRegex } from "../src/hook.ts";
import { getAuditTrail } from "../src/audit.ts";
import { makeTempRoot, cleanup } from "./helpers.ts";

function setup(withGit = false) {
  const root = makeTempRoot();
  const memoryDir = join(root, ".memory");
  mkdirSync(memoryDir, { recursive: true });
  const store = openStore(memoryDir);
  if (withGit) {
    execFileSync("git", ["init", "-b", "main"], { cwd: root });
  }
  return { root, memoryDir, store };
}

const TRANSCRIPT = [
  JSON.stringify({ role: "user", content: "how do we rate limit?" }),
  JSON.stringify({ content: "Fix: add a token bucket limiter at the gateway" }),
  JSON.stringify({ content: "Decision: reject requests over 100 rpm per tenant" }),
].join("\n");

describe("git hook install", () => {
  test("writes executable pre-commit invoking harvest-auto", () => {
    const { root, memoryDir, store } = setup(true);
    const result = installGitHook(root);
    expect(result.installed).toBe(true);

    const hookPath = join(root, ".git", "hooks", "pre-commit");
    expect(existsSync(hookPath)).toBe(true);
    const content = readFileSync(hookPath, "utf8");
    expect(content).toContain("memory harvest-auto");
    expect(content.startsWith("#!")).toBe(true);
    // executable bit
    const mode = statSync(hookPath).mode;
    expect(mode & 0o111).not.toBe(0);
    // no inbox dir created by install (zero-folder-creation)
    expect(existsSync(join(memoryDir, "inbox"))).toBe(false);

    cleanup(root);
  });

  test("never clobbers an existing pre-commit hook", () => {
    const { root, memoryDir, store } = setup(true);
    const hooksDir = join(root, ".git", "hooks");
    mkdirSync(hooksDir, { recursive: true });
    const hookPath = join(hooksDir, "pre-commit");
    writeFileSync(hookPath, "#!/bin/sh\necho sentinel\n", "utf8");

    const result = installGitHook(root);
    expect(result.installed).toBe(false);
    expect(readFileSync(hookPath, "utf8")).toBe("#!/bin/sh\necho sentinel\n");

    cleanup(root);
  });

  test("fails gracefully outside a git repository", () => {
    const { root, memoryDir, store } = setup(false);
    const result = installGitHook(root);
    expect(result.installed).toBe(false);
    expect(result.message).toContain("no .git directory");
    cleanup(root);
  });
});

describe("harvest-auto", () => {
  test("end-to-end: inbox jsonl -> candidate units -> moved to processed + audit", () => {
    const { root, memoryDir, store } = setup();
    const inbox = join(memoryDir, "inbox");
    mkdirSync(inbox, { recursive: true });
    writeFileSync(join(inbox, "session.jsonl"), TRANSCRIPT, "utf8");
    const before = list(store).length;

    const res = harvestAuto(store, root, memoryDir);
    expect(res.processed.length).toBe(1);
    expect(res.processed[0].imported).toBeGreaterThan(0);
    expect(res.message).toContain("1 transcript(s)");

    // All proposed units are candidates (never auto-confirmed)
    const newEntries = list(store).slice(before);
    expect(newEntries.length).toBeGreaterThan(0);
    for (const e of newEntries) expect(e.status).toBe("candidate");

    // File moved out of inbox into processed/
    expect(existsSync(join(inbox, "session.jsonl"))).toBe(false);
    expect(existsSync(join(inbox, "processed", "session.jsonl"))).toBe(true);

    // Audit logged
    const audit = getAuditTrail(memoryDir, { operation: "transcript_import" });
    expect(audit.some((a) => a.details?.source === "harvest-auto")).toBe(true);

    cleanup(root);
  });

  test("absence tolerance: missing inbox creates nothing and reports cleanly", () => {
    const { root, memoryDir, store } = setup();
    const res = harvestAuto(store, root, memoryDir);
    expect(res.processed.length).toBe(0);
    expect(res.message).toContain("no transcripts waiting");
    expect(existsSync(join(memoryDir, "inbox"))).toBe(false);
    cleanup(root);
  });

  test("explicit --from glob wins over inbox discovery", () => {
    const { root, memoryDir, store } = setup();
    const logsDir = join(root, "logs");
    mkdirSync(logsDir, { recursive: true });
    writeFileSync(join(logsDir, "chat.jsonl"), TRANSCRIPT, "utf8");

    const res = harvestAuto(store, root, memoryDir, { from: "logs/*.jsonl" });
    expect(res.processed.length).toBe(1);
    expect(existsSync(join(logsDir, "chat.jsonl"))).toBe(false);
    expect(existsSync(join(memoryDir, "inbox", "processed", "chat.jsonl"))).toBe(true);
    cleanup(root);
  });

  test("globToRegex translates *, ** and literal dots", () => {
    const re = globToRegex("logs/**/*.jsonl");
    expect(re.test("logs/a/b/c.jsonl")).toBe(true);
    expect(re.test("logs/b.jsonl")).toBe(false);
    expect(globToRegex("a.b.jsonl").test("axb.jsonl")).toBe(false);
  });
});
