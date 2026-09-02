import { describe, it, expect } from "vitest";
import { CLI_NAME, CLI_VERSION } from "./version";

describe("@portiq/cli", () => {
  it("exposes its name and version", () => {
    expect(CLI_NAME).toBe("portiq");
    expect(CLI_VERSION).toBe("0.1.0");
  });
});
