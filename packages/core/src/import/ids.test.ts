import { describe, it, expect } from "vitest";
import { createIdFactory } from "./ids";

describe("createIdFactory", () => {
  it("prefixes generated ids", () => {
    const newId = createIdFactory();
    expect(newId("col")).toMatch(/^col-/);
    expect(newId("req")).toMatch(/^req-/);
  });

  it("returns unique ids across calls", () => {
    const newId = createIdFactory();
    const ids = new Set([newId("x"), newId("x"), newId("x"), newId("x")]);
    expect(ids.size).toBe(4);
  });
});
