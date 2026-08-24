import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { watch, type FSWatcher } from "node:fs";

export interface HubEvent {
  type: string;
  payload?: unknown;
  source?: string;
  timestamp: string;
}

export interface HubHandle {
  server: Server;
  port: number;
  url: string;
  clientCount: number;
  broadcast: (type: string, payload?: unknown, source?: string) => number;
  close: () => Promise<void>;
}

const DEBOUNCE_MS = 300;

/**
 * Real-Time Agency Hub.
 *
 * ponytail: SSE instead of WebSockets — one-way event fanout is all peers need,
 * and SSE is plain node:http with zero dependencies. Swap in a WS upgrade handler
 * if bidirectional push ever matters.
 */
export function startHub(port: number, memoryDir?: string): Promise<HubHandle> {
  const clients = new Set<ServerResponse>();
  const watchers: FSWatcher[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url?.startsWith("/events")) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ type: "hello", timestamp: new Date().toISOString() })}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (req.method === "POST" && req.url?.startsWith("/publish")) {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 1_000_000) req.destroy(); // cap request size
      });
      req.on("end", () => {
        let parsed: { type?: string; payload?: unknown };
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "invalid JSON body" }));
          return;
        }
        if (!parsed.type || typeof parsed.type !== "string") {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "missing 'type' field" }));
          return;
        }
        const delivered = broadcast(parsed.type, parsed.payload, "publisher");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ delivered }));
      });
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  function broadcast(type: string, payload?: unknown, source?: string): number {
    const event: HubEvent = { type, payload, source, timestamp: new Date().toISOString() };
    const frame = `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) {
      try {
        client.write(frame);
      } catch {
        clients.delete(client);
      }
    }
    return clients.size;
  }

  // Watch .memory/memories/ + CURRENT.md (best-effort; debounced)
  if (memoryDir) {
    const memoriesDir = join(memoryDir, "memories");
    const armDebounced = (type: string) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        broadcast(type, undefined, "watcher");
      }, DEBOUNCE_MS);
    };
    try {
      if (existsSync(memoriesDir)) {
        watchers.push(watch(memoriesDir, () => armDebounced("memory.changed")));
      }
      const currentMd = join(memoryDir, "CURRENT.md");
      if (existsSync(currentMd)) {
        watchers.push(watch(currentMd, () => armDebounced("constraints.changed")));
      }
    } catch {
      // watcher is best-effort; hub still works without it
    }
  }

  return new Promise((resolve) => {
    server.listen(port, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({
        server,
        port: actualPort,
        url: `http://localhost:${actualPort}/events`,
        get clientCount() {
          return clients.size;
        },
        broadcast,
        close: () =>
          new Promise<void>((resolveClose) => {
            for (const w of watchers) w.close();
            for (const client of clients) client.end();
            clients.clear();
            server.close(() => resolveClose());
          }),
      });
    });
  });
}
