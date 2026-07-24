import { describe, it, expect } from "vitest";
import { buildProgram, type CommandModule } from "./registry";
import { defaultContext } from "./context";

const noop: CommandModule = {
  register(program) {
    program.command("ping").action(() => { /* no-op */ });
  },
};

describe("buildProgram", () => {
  it("registers provided command modules additively", () => {
    const program = buildProgram(defaultContext(), [noop]);
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("ping");
  });

  it("declares the shared --data-dir global option", () => {
    const program = buildProgram(defaultContext(), []);
    const opt = program.options.find((o) => o.long === "--data-dir");
    expect(opt).toBeTruthy();
  });

  it("throws instead of exiting on an unknown command (exitOverride)", () => {
    const program = buildProgram(defaultContext(), [noop]);
    expect(() => program.parse(["nope"], { from: "user" })).toThrow();
  });
});
