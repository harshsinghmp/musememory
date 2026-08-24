import { describe, test, expect } from "bun:test";
import { get as httpGet, request as httpRequest } from "node:http";
import { startHub, type HubHandle } from "../src/daemon.ts";
import { makeTempRoot, cleanup } from "./helpers.ts";

function publish(port: number, body: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path: "/publish", method: "POST", headers: { "content-type": "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(data) }));
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

/** Open an SSE stream and collect frames until the predicate matches or timeout. */
function readEvents(port: number, predicate: (frame: string) => boolean, timeoutMs = 3000): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const frames: string[] = [];
    let buffer = "";
    const req = httpGet({ host: "127.0.0.1", port, path: "/events" }, (res) => {
      res.on("data", (chunk) => {
        buffer += chunk.toString();
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (frame.trim()) frames.push(frame);
          if (predicate(frame)) {
            req.destroy();
            resolve(frames);
            return;
          }
        }
      });
      res.on("error", () => {});
    });
    req.on("error", () => {});
    setTimeout(() => {
      req.destroy();
      resolve(frames);
    }, timeoutMs);
  });
}

describe("real-time agency hub (SSE)", () => {
  test("publish fans out JSON events to all connected SSE clients", async () => {
    const root = makeTempRoot();
    const hub: HubHandle = await startHub(0);

    // Two clients connect; wait for the hello frame on each
    const p1 = readEvents(hub.port, (f) => f.includes("agent.joined"));
    const p2 = readEvents(hub.port, (f) => f.includes("agent.joined"));
    await new Promise((r) => setTimeout(r, 100)); // let connections register

    const pub = await publish(hub.port, { type: "agent.joined", payload: { name: "claude" } });
    expect(pub.status).toBe(200);
    expect(pub.json.delivered).toBeGreaterThanOrEqual(2);

    const [frames1, frames2] = await Promise.all([p1, p2]);
    for (const frames of [frames1, frames2]) {
      const matched = frames.find((f) => f.includes("agent.joined"))!;
      expect(matched).toContain(`event: agent.joined`);
      expect(matched).toContain('"name":"claude"');
      expect(matched).toMatch(/data: \{.*\}/);
    }

    await hub.close();
    cleanup(root);
  });

  test("delivered count reflects live subscribers and hello greets new clients", async () => {
    const root = makeTempRoot();
    const hub = await startHub(0);

    // No clients yet
    const empty = await publish(hub.port, { type: "ping" });
    expect(empty.json.delivered).toBe(0);

    const gotPing = readEvents(hub.port, (f) => f.includes("event: ping"));
    await new Promise((r) => setTimeout(r, 100));
    const one = await publish(hub.port, { type: "ping" });
    expect(one.json.delivered).toBe(1);
    const frames = await gotPing;
    expect(frames.some((f) => f.startsWith("data:") && f.includes('"type":"hello"'))).toBe(true);

    await hub.close();
    cleanup(root);
  });

  test("rejects malformed publishes with 400", async () => {
    const root = makeTempRoot();
    const hub = await startHub(0);

    const badJson = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port: hub.port, path: "/publish", method: "POST" }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      });
      req.on("error", reject);
      req.end("not json{");
    });
    expect(badJson).toBe(400);

    const noType = await publish(hub.port, { payload: {} });
    expect(noType.status).toBe(400);

    await hub.close();
    cleanup(root);
  });

  test("unknown paths 404 and port 0 assigns an ephemeral port", async () => {
    const root = makeTempRoot();
    const hub = await startHub(0);
    expect(hub.port).toBeGreaterThan(0);
    expect(hub.url).toContain(`/events`);

    const status = await new Promise<number>((resolve, reject) => {
      httpGet({ host: "127.0.0.1", port: hub.port, path: "/nope" }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      }).on("error", reject);
    });
    expect(status).toBe(404);

    await hub.close();
    cleanup(root);
  });
});
