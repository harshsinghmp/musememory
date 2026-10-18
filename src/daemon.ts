import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { Socket } from "node:net";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";

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
  const sockets = new Set<Socket>();
  const watchers: FSWatcher[] = [];
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
      res.on("close", () => clients.delete(res));
      res.on("error", () => clients.delete(res));
      return;
    }

    if (req.method === "POST" && req.url?.startsWith("/publish")) {
      // Origin validation: only allow local origins, reject untrusted cross-origin or null origins (T-345)
      const origin = req.headers.origin;
      const isLocalOrigin = !origin || (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) && origin !== "null");
      if (!isLocalOrigin) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "forbidden: cross-origin requests blocked" }));
        return;
      }

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

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
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

  // Watch .memory/memories/ + CURRENT.md (best-effort; debounced per event type)
  if (memoryDir) {
    const memoriesDir = join(memoryDir, "memories");
    const currentMd = join(memoryDir, "CURRENT.md");

    const armDebounced = (type: string) => {
      const prev = debounceTimers.get(type);
      if (prev) clearTimeout(prev);
      debounceTimers.set(
        type,
        setTimeout(() => {
          debounceTimers.delete(type);
          broadcast(type, undefined, "watcher");
        }, DEBOUNCE_MS),
      );
    };

    const setupWatcher = (targetPath: string, eventType: string, isDir: boolean) => {
      let activeWatcher: FSWatcher | null = null;
      const arm = () => {
        if (!existsSync(targetPath)) return;
        try {
          if (activeWatcher) {
            try {
              activeWatcher.close();
            } catch {}
          }
          activeWatcher = watch(targetPath, (eventTypeObserved) => {
            armDebounced(eventType);
            // If an atomic file write emits rename, re-arm watcher
            if (!isDir && eventTypeObserved === "rename") {
              setTimeout(arm, 50);
            }
          });
          activeWatcher.on("error", () => {
            if (activeWatcher) {
              try {
                activeWatcher.close();
              } catch {}
              activeWatcher = null;
            }
            setTimeout(arm, 1000);
          });
          watchers.push(activeWatcher);
        } catch {
          // best-effort
        }
      };
      arm();
    };

    setupWatcher(memoriesDir, "memory.changed", true);
    setupWatcher(currentMd, "constraints.changed", false);
  }

  return new Promise((resolve, reject) => {
    let isListening = false;
    server.on("error", (err) => {
      if (!isListening) {
        reject(err);
      }
    });

    server.listen(port, "127.0.0.1", () => {
      isListening = true;
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
            for (const timer of debounceTimers.values()) clearTimeout(timer);
            debounceTimers.clear();
            for (const w of watchers) {
              try {
                w.close();
              } catch {}
            }
            watchers.length = 0;
            for (const client of clients) {
              try {
                client.end();
              } catch {}
            }
            clients.clear();
            for (const socket of sockets) {
              try {
                socket.destroy();
              } catch {}
            }
            sockets.clear();
            server.close(() => resolveClose());
          }),
      });
    });
  });
}
