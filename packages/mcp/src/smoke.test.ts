import { describe, it, expect } from "vitest";
import { SERVER_NAME, SERVER_VERSION } from "./index";

describe("@portiq/mcp", () => {
  it("exposes server identity constants", () => {
    expect(SERVER_NAME).toBe("portiq-mcp");
    expect(SERVER_VERSION).toBe("0.1.0");
  });
});
