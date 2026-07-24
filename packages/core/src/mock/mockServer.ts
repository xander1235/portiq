import { createServer, type Server } from "node:http";

export interface MockRoute {
  method: string;
  path: string;
  statusCode?: number;
  headers?: Record<string, string>;
  body?: string;
  delay?: number;
}

export interface MockStartPayload {
  id: string;
  port: number;
  routes: MockRoute[];
}

export interface MockStartResult {
  ok: true;
  port: number;
}

export interface MockErrorResult {
  error: string;
}

export interface MockStopResult {
  ok: true;
}

export interface MockListEntry {
  id: string;
  port: number;
  routeCount: number;
}

interface MockServerEntry {
  server: Server;
  port: number;
  routes: MockRoute[];
}

/**
 * Matches an Express-style path pattern (supports `:param` segments) against
 * a concrete pathname. Ported from electron/main.cjs matchPath (:859-865).
 */
export function matchPath(pattern: string, pathname: string): boolean {
  const patternParts = pattern.split("/");
  const pathParts = pathname.split("/");
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every((part, i) => part.startsWith(":") || part === pathParts[i]);
}

/**
 * Manages a set of in-process HTTP mock servers, keyed by id. Headless port
 * of the `mock:*` IPC handlers from electron/main.cjs:762-865.
 */
export class MockServerManager {
  private servers = new Map<string, MockServerEntry>();

  start(payload: MockStartPayload): Promise<MockStartResult | MockErrorResult> {
    const { id, port, routes } = payload || ({} as MockStartPayload);
    if (!id) return Promise.resolve({ error: "Missing server ID" });
    if (port === undefined || port === null || port < 0 || port > 65535) {
      return Promise.resolve({ error: "Invalid port number" });
    }
    if (!Array.isArray(routes)) return Promise.resolve({ error: "Routes must be an array" });

    // Stop existing server with same ID
    const existing = this.servers.get(id);
    if (existing) {
      try {
        existing.server.close();
      } catch {
        // ignore
      }
      this.servers.delete(id);
    }

    return new Promise((resolve) => {
      try {
        const server = createServer((req, res) => {
          const url = new URL(req.url ?? "/", `http://localhost:${port}`);
          const currentRoutes = this.servers.get(id)?.routes ?? routes;
          const matchedRoute = currentRoutes.find(
            (r) => r.method.toUpperCase() === (req.method ?? "").toUpperCase() && matchPath(r.path, url.pathname)
          );

          // CORS headers
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "*");

          if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
          }

          if (!matchedRoute) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "No matching mock route", path: url.pathname, method: req.method }));
            return;
          }

          const statusCode = matchedRoute.statusCode || 200;
          const responseHeaders = { "Content-Type": "application/json", ...(matchedRoute.headers || {}) };
          const responseBody =
            typeof matchedRoute.body === "string" ? matchedRoute.body : JSON.stringify(matchedRoute.body || {});

          // Simulate delay if configured
          const delay = matchedRoute.delay || 0;
          setTimeout(() => {
            res.writeHead(statusCode, responseHeaders);
            res.end(responseBody);
          }, delay);
        });

        server.listen(port, "127.0.0.1", () => {
          const address = server.address();
          const boundPort = typeof address === "object" && address ? address.port : port;
          this.servers.set(id, { server, port: boundPort, routes });
          resolve({ ok: true, port: boundPort });
        });

        server.on("error", (err) => {
          resolve({ error: err.message });
        });
      } catch (err) {
        resolve({ error: (err as Error).message });
      }
    });
  }

  stop(payload: { id: string }): Promise<MockStopResult | MockErrorResult> {
    const { id } = payload || ({} as { id: string });
    const entry = this.servers.get(id);
    if (!entry) return Promise.resolve({ ok: true });

    return new Promise((resolve) => {
      entry.server.close(() => {
        this.servers.delete(id);
        resolve({ ok: true });
      });
    });
  }

  list(): MockListEntry[] {
    const result: MockListEntry[] = [];
    this.servers.forEach((value, key) => {
      result.push({ id: key, port: value.port, routeCount: value.routes.length });
    });
    return result;
  }

  updateRoutes(payload: { id: string; routes: MockRoute[] }): MockStopResult | MockErrorResult {
    const { id, routes } = payload || ({} as { id: string; routes: MockRoute[] });
    const entry = this.servers.get(id);
    if (!entry) return { error: "Server not found" };
    if (!Array.isArray(routes)) return { error: "Routes must be an array" };
    entry.routes = routes;
    this.servers.set(id, entry);
    return { ok: true };
  }
}
