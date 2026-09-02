import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import { buildProgram } from "../registry";
import { mcpCommand, type McpSpawner } from "./mcp";
import type { CliContext } from "../context";

describe("mcp command", () => {
  it("spawns portiq-mcp with forwarded args and inherited stdio", async () => {
    let captured: { command: string; args: string[] } | null = null;
    const spawner: McpSpawner = (command, args) => {
      captured = { command, args };
      return { on: (event, cb) => { if (event === "exit") setImmediate(() => cb(0)); } };
    };
    const sink = new Writable({ write(_c, _e, cb) { cb(); } });
    const ctx: CliContext = { argv: [], env: {}, cwd: "/", stdout: sink, stderr: sink, isTTY: false, now: () => 0 };
    await buildProgram(ctx, [mcpCommand(spawner)]).parseAsync(["mcp", "--allow-writes"], { from: "user" });
    expect(captured!.command).toBe("portiq-mcp");
    expect(captured!.args).toEqual(["--allow-writes"]);
  });

  it("prints an install hint when portiq-mcp is missing", async () => {
    let out = "";
    const spawner: McpSpawner = () => ({ on: (event, cb) => { if (event === "error") setImmediate(() => cb(Object.assign(new Error("nope"), { code: "ENOENT" }))); } });
    const sink = new Writable({ write(c, _e, cb) { out += c.toString(); cb(); } });
    const ctx: CliContext = { argv: [], env: {}, cwd: "/", stdout: sink, stderr: sink, isTTY: false, now: () => 0 };
    await buildProgram(ctx, [mcpCommand(spawner)]).parseAsync(["mcp"], { from: "user" });
    expect(out).toMatch(/portiq-mcp/);
    expect(out).toMatch(/@portiq\/mcp/);
  });
});
