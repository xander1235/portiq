import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import { runCli } from "./run";
import type { CliContext } from "./context";

function ctxFor(argv: string[]): { ctx: CliContext; err: () => string; out: () => string } {
  let e = "", o = "";
  const errSink = new Writable({ write(c, _en, cb) { e += c.toString(); cb(); } });
  const outSink = new Writable({ write(c, _en, cb) { o += c.toString(); cb(); } });
  return { ctx: { argv, env: {}, cwd: "/", stdout: outSink, stderr: errSink, isTTY: false, now: () => 0 }, err: () => e, out: () => o };
}

describe("runCli", () => {
  it("returns 3 (usage) for an unknown command", async () => {
    const { ctx } = ctxFor(["totally-unknown"]);
    expect(await runCli(ctx)).toBe(3);
  });

  it("returns 3 (usage) when a required ref is missing for get", async () => {
    const { ctx } = ctxFor(["get"]);
    expect(await runCli(ctx)).toBe(3);
  });

  it("returns 0 for --version", async () => {
    const { ctx } = ctxFor(["--version"]);
    expect(await runCli(ctx)).toBe(0);
  });
});
