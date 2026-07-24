import { describe, it, expect, afterEach } from "vitest";
import { MockServerManager, matchPath } from "./mockServer";

let mgr: MockServerManager | null = null;
afterEach(() => {
  mgr?.list().forEach((s) => mgr!.stop({ id: s.id }));
  mgr = null;
});

describe("matchPath", () => {
  it("matches param segments", () => {
    expect(matchPath("/users/:id", "/users/42")).toBe(true);
    expect(matchPath("/users/:id", "/users/42/x")).toBe(false);
  });
});

describe("MockServerManager", () => {
  it("serves a configured route", async () => {
    mgr = new MockServerManager();
    const start = await mgr.start({
      id: "m1",
      port: 0,
      routes: [{ method: "GET", path: "/ping", statusCode: 200, body: "pong" }],
    });
    expect("ok" in start && start.ok).toBe(true);
    const port = ("port" in start && start.port) as number;
    const res = await fetch(`http://127.0.0.1:${port}/ping`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("pong");
  });

  it("returns 404 for unmatched routes", async () => {
    mgr = new MockServerManager();
    const start = await mgr.start({
      id: "m2",
      port: 0,
      routes: [{ method: "GET", path: "/ping", statusCode: 200, body: "pong" }],
    });
    const port = ("port" in start && start.port) as number;
    const res = await fetch(`http://127.0.0.1:${port}/missing`);
    expect(res.status).toBe(404);
  });

  it("lists running servers and stops them", async () => {
    mgr = new MockServerManager();
    await mgr.start({ id: "m3", port: 0, routes: [] });
    expect(mgr.list().map((s) => s.id)).toContain("m3");
    const stopped = await mgr.stop({ id: "m3" });
    expect("ok" in stopped && stopped.ok).toBe(true);
    expect(mgr.list().map((s) => s.id)).not.toContain("m3");
  });

  it("updates routes on a running server", async () => {
    mgr = new MockServerManager();
    const start = await mgr.start({
      id: "m4",
      port: 0,
      routes: [{ method: "GET", path: "/ping", statusCode: 200, body: "pong" }],
    });
    const port = ("port" in start && start.port) as number;
    const updated = mgr.updateRoutes({
      id: "m4",
      routes: [{ method: "GET", path: "/ping", statusCode: 200, body: "updated" }],
    });
    expect("ok" in updated && updated.ok).toBe(true);
    const res = await fetch(`http://127.0.0.1:${port}/ping`);
    expect(await res.text()).toBe("updated");
  });

  it("rejects an invalid port", async () => {
    mgr = new MockServerManager();
    const start = await mgr.start({ id: "m5", port: -1, routes: [] });
    expect("error" in start).toBe(true);
  });
});
