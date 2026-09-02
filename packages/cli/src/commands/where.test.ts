import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { buildProgram } from "../registry";
import { whereCommand } from "./where";
import type { CliContext } from "../context";

function capture(): { ctx: CliContext; out: () => string } {
  let buf = "";
  const sink = new Writable({ write(c, _e, cb) { buf += c.toString(); cb(); } });
  const ctx: CliContext = { argv: [], env: {}, cwd: "/", stdout: sink, stderr: sink, isTTY: false, now: () => 0 };
  return { ctx, out: () => buf };
}

describe("where command", () => {
  it("prints the resolved data dir and db path as json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "portiq-where-"));
    try {
      const { ctx, out } = capture();
      const program = buildProgram(ctx, [whereCommand]);
      await program.parseAsync(["where", "--data-dir", dir, "--reporter", "json"], { from: "user" });
      const parsed = JSON.parse(out());
      expect(parsed.entity.dataDir).toBe(dir);
      expect(parsed.entity.dbPath).toBe(join(dir, "appdata.sqlite"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
