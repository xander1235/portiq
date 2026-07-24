import { describe, it, expect, afterEach } from "vitest";
import { WebSocketServer } from "ws";
import { WsManager } from "./websocket";

let wss: WebSocketServer | null = null;
function listen(): Promise<number> {
  return new Promise((resolve) => {
    wss = new WebSocketServer({ port: 0, host: "127.0.0.1" }, () => resolve((wss!.address() as any).port));
    wss.on("connection", (socket) => {
      socket.on("message", (m) => socket.send(`echo:${m}`));
    });
  });
}
afterEach(() => { wss?.close(); wss = null; });

describe("WsManager", () => {
  it("connects, echoes a message, and emits it", async () => {
    const port = await listen();
    const mgr = new WsManager();
    const received: any[] = [];
    mgr.on("message", (evt) => { if (evt.message.direction === "incoming") received.push(evt.message.data); });

    const res = await mgr.connect({ id: "w1", url: `ws://127.0.0.1:${port}` });
    expect("status" in res && res.status).toBe("connected");

    mgr.sendMessage({ id: "w1", data: "hi" });
    await new Promise((r) => setTimeout(r, 100));
    expect(received).toContain("echo:hi");

    expect(mgr.disconnect({ id: "w1" })).toEqual({ ok: true });
  });
});
