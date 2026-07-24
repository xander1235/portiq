import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { resolveDataDir } from "./dataDir";

describe("resolveDataDir", () => {
  it("honors an explicit dataDir first", () => {
    expect(resolveDataDir({ dataDir: "/tmp/x", env: { PORTIQ_DATA_DIR: "/env" }, platform: "linux", home: "/home/u" }))
      .toBe("/tmp/x");
  });

  it("honors PORTIQ_DATA_DIR next", () => {
    expect(resolveDataDir({ env: { PORTIQ_DATA_DIR: "/env" }, platform: "linux", home: "/home/u" }))
      .toBe("/env");
  });

  it("uses the macOS Application Support path", () => {
    expect(resolveDataDir({ env: {}, platform: "darwin", home: "/Users/u" }))
      .toBe("/Users/u/Library/Application Support/Portiq");
  });

  it("uses the Linux ~/.config path", () => {
    expect(resolveDataDir({ env: {}, platform: "linux", home: "/home/u" }))
      .toBe("/home/u/.config/Portiq");
  });

  it("uses APPDATA on Windows", () => {
    const appdata = "C:\\Users\\u\\AppData\\Roaming";
    const result = resolveDataDir({ env: { APPDATA: appdata }, platform: "win32", home: "C:\\Users\\u" });
    const expected = join(appdata, "Portiq");
    expect(result).toBe(expected);
  });
});
