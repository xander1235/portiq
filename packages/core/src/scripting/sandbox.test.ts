import { describe, expect, it } from "vitest";
import { runSandboxed, evalConditionSandboxed } from "./sandbox";

describe("runSandboxed", () => {
  it("evaluates an expression with injected params", () => {
    const res = runSandboxed("return steps.value + 1;", ["steps"], [{ value: 41 }]);
    expect(res.ok).toBe(true);
    expect(res.value).toBe(42);
  });

  it("reports a thrown error", () => {
    const res = runSandboxed("throw new Error('boom');", [], []);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("boom");
  });

  it("reports a syntax error", () => {
    const res = runSandboxed("this is not valid js (((", [], []);
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it("does not expose `process`", () => {
    const res = runSandboxed("return typeof process;", [], []);
    expect(res.ok).toBe(true);
    expect(res.value).toBe("undefined");
  });

  it("does not expose `require`", () => {
    const res = runSandboxed("return typeof require;", [], []);
    expect(res.ok).toBe(true);
    expect(res.value).toBe("undefined");
  });

  it("does not expose global `fetch`", () => {
    const res = runSandboxed("return typeof fetch;", [], []);
    expect(res.ok).toBe(true);
    expect(res.value).toBe("undefined");
  });

  it("blocks the Function-constructor escape to host globals", () => {
    // `[].filter.constructor` is the Function constructor; in a fresh vm context
    // it creates functions bound to the *sandbox* global, so `process` stays hidden.
    const res = runSandboxed("return [].filter.constructor('return typeof process')();", [], []);
    expect(res.ok).toBe(true);
    expect(res.value).toBe("undefined");
  });

  it("can call an injected callback (emit)", () => {
    const emitted: unknown[] = [];
    const res = runSandboxed("emit('a'); emit(42);", ["emit"], [emitted.push.bind(emitted)]);
    expect(res.ok).toBe(true);
    expect(emitted).toEqual(["a", 42]);
  });

  it("can read injected env", () => {
    const res = runSandboxed("return env.TOKEN;", ["env"], [{ TOKEN: "secret" }]);
    expect(res.ok).toBe(true);
    expect(res.value).toBe("secret");
  });

  it("times out runaway synchronous loops", () => {
    const res = runSandboxed("while (true) {}", [], [], { timeoutMs: 200 });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it("supports async bodies via the returned promise", async () => {
    const res = runSandboxed("return Promise.resolve(7);", [], []);
    expect(res.ok).toBe(true);
    await expect(res.value).resolves.toBe(7);
  });
});

describe("evalConditionSandboxed", () => {
  it("evaluates true/false conditions", () => {
    expect(evalConditionSandboxed("steps.a.response.status === 200", { a: { response: { status: 200 } } }, {}).value).toBe(true);
    expect(evalConditionSandboxed("steps.a.response.status === 404", { a: { response: { status: 200 } } }, {}).value).toBe(false);
  });

  it("reads env vars in conditions", () => {
    expect(evalConditionSandboxed("env.mode === 'prod'", {}, { mode: "prod" }).value).toBe(true);
  });

  it("treats errors as false", () => {
    const res = evalConditionSandboxed("undefinedVariableHere === 1", {}, {});
    expect(res.ok).toBe(false);
    expect(res.value).toBe(false);
  });
});
