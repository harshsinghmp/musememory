import { describe, test, expect } from "bun:test";
import { join } from "node:path";

/**
 * Issue #453: the MCP HTTP transport failed open. `--host 0.0.0.0` published
 * every tool with no authentication because the transport only required a
 * token when one happened to be configured.
 *
 * These tests drive the real CLI as a child process — the gate lives on the
 * startup path, so a handler unit test would not prove that no server starts.
 * Each server binds port 0 (OS-assigned) and is stopped as soon as the
 * listening line appears.
 */

const ROOT = join(import.meta.dir, "..");
const BIN = join(ROOT, "bin", "memory.ts");

interface ServeRun {
  stdout: string;
  stderr: string;
  code: number | null;
}

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  // The gate must be decided by the invocation, not by the developer's shell.
  delete env.MUSE_BEARER_TOKEN;
  delete env.MUSE_AUTH_TOKENS;
  return env;
}

function spawnServe(args: string[]) {
  return Bun.spawn(["bun", BIN, "mcp", "--http", "--port", "0", ...args], {
    cwd: ROOT,
    env: childEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
}

/** Runs the CLI to completion; used for the refusal path, which must not hang. */
async function runToExit(args: string[], timeoutMs = 15000): Promise<ServeRun> {
  const proc = spawnServe(args);
  const killer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
      new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    ]);
    await proc.exited;
    return { stdout, stderr, code: proc.exitCode };
  } finally {
    clearTimeout(killer);
  }
}

/**
 * Starts the server, waits for `listening at`, optionally runs `during` (while
 * the server is still up), then stops it with SIGTERM.
 */
async function runServe(
  args: string[],
  during?: (info: { stdout: string; port: number }) => Promise<void>,
  timeoutMs = 15000,
): Promise<ServeRun> {
  const proc = spawnServe(args);
  let stdout = "";
  let stderr = "";
  let duringError: unknown;
  let handled = false;

  const killer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);

  const pump = async (stream: ReadableStream<Uint8Array>, append: (s: string) => void) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      append(decoder.decode(chunk, { stream: true }));
      if (!handled && stdout.includes("listening at")) {
        handled = true;
        try {
          const port = Number(stdout.match(/listening at http:\/\/[^\s/]+:(\d+)/)?.[1]);
          await during?.({ stdout, port });
        } catch (err) {
          duringError = err;
        } finally {
          proc.kill("SIGTERM");
        }
      }
    }
  };

  try {
    await Promise.all([
      pump(proc.stdout as ReadableStream<Uint8Array>, (s) => (stdout += s)),
      pump(proc.stderr as ReadableStream<Uint8Array>, (s) => (stderr += s)),
      proc.exited,
    ]);
  } finally {
    clearTimeout(killer);
  }

  if (duringError) throw duringError;
  return { stdout, stderr, code: proc.exitCode };
}

function initializeBody(): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } },
  });
}

const MCP_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

describe("CLI startup gate: non-loopback MCP HTTP binds (issue #453)", () => {
  test("refuses to bind 0.0.0.0 with no token, exits 2 and starts no server", async () => {
    const res = await runToExit(["--host", "0.0.0.0"]);

    // Assert "no server" first: with the gate removed the process starts one
    // and only dies on the harness timeout, which makes `code` opaque.
    expect(res.stdout).not.toContain("listening at");
    expect(res.stderr).toContain('refusing to bind the MCP HTTP server to "0.0.0.0" without authentication');
    expect(res.stderr).toContain("--insecure");
    expect(res.code).toBe(2);
  }, 30000);

  test("--insecure starts the server, warns loudly, and the Host allowlist is on by default", async () => {
    let rebindingStatus = 0;
    let rebindingMessage = "";
    let anonymousStatus = 0;

    const res = await runServe(["--host", "0.0.0.0", "--insecure"], async ({ port }) => {
      const url = `http://127.0.0.1:${port}/mcp`;

      // A DNS-rebinding page reaches the loopback address under a Host it owns.
      const rebinding = await fetch(url, {
        method: "POST",
        headers: { ...MCP_HEADERS, host: "rebinding.attacker.example" },
        body: initializeBody(),
      });
      rebindingStatus = rebinding.status;
      rebindingMessage = ((await rebinding.json()) as any).error?.message ?? "";

      // With --insecure and no token, an ordinary request really is anonymous —
      // which is exactly what the warning says.
      const anonymous = await fetch(url, { method: "POST", headers: MCP_HEADERS, body: initializeBody() });
      anonymousStatus = anonymous.status;
    });

    expect(res.code).toBe(0);
    expect(res.stdout).toContain("listening at");
    // The derived Host allowlist is bind host + loopback, deduped.
    expect(res.stdout).toContain("[Auth] Allowed hosts: 0.0.0.0, localhost, 127.0.0.1, [::1]");
    expect(res.stderr).toContain("EVERY tool is reachable WITHOUT authentication");
    expect(rebindingStatus).toBe(403);
    expect(rebindingMessage).toContain("is not allowed");
    expect(anonymousStatus).toBe(200);
  }, 30000);

  test("starts when a bearer token is supplied, and rejects anonymous requests", async () => {
    let anonymousStatus = 0;
    let anonymousMessage = "";

    const res = await runServe(["--host", "0.0.0.0", "--token", "team-token-abc"], async ({ port }) => {
      const resp = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: MCP_HEADERS,
        body: initializeBody(),
      });
      anonymousStatus = resp.status;
      anonymousMessage = ((await resp.json()) as any).error?.message ?? "";
    });

    expect(res.code).toBe(0);
    expect(res.stdout).toContain("listening at");
    expect(res.stdout).toContain("Bearer authentication active");
    expect(res.stderr).not.toContain("WITHOUT authentication");
    expect(anonymousStatus).toBe(401);
    expect(anonymousMessage).toContain("Missing Bearer token");
  }, 30000);

  test("a loopback bind still starts with no token and no warning", async () => {
    let anonymousStatus = 0;

    const res = await runServe(["--host", "127.0.0.1"], async ({ port }) => {
      const resp = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: MCP_HEADERS,
        body: initializeBody(),
      });
      anonymousStatus = resp.status;
    });

    expect(res.code).toBe(0);
    expect(res.stdout).toContain("listening at");
    expect(res.stderr).not.toContain("WITHOUT authentication");
    expect(anonymousStatus).toBe(200);
  }, 30000);
});
