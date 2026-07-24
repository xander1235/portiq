import { describe, it, expect } from "vitest";
import { createMockManager, MockServerManager } from "./index";

describe("mock module", () => {
  it("createMockManager returns a MockServerManager instance", () => {
    const mgr = createMockManager();
    expect(mgr).toBeInstanceOf(MockServerManager);
  });
});
