import { describe, it, expect } from "vitest";
import { buildMultipartBody } from "./multipart";

describe("buildMultipartBody", () => {
  it("builds a text part with a stable boundary", () => {
    const { boundary, body } = buildMultipartBody([{ kind: "text", name: "a", value: "1" }], { boundarySeed: "SEED" });
    expect(boundary).toBe("----PortiqBoundarySEED");
    const text = body.toString("utf8");
    expect(text).toContain('name="a"');
    expect(text).toContain("\r\n1\r\n");
    expect(text.trimEnd().endsWith("----PortiqBoundarySEED--")).toBe(true);
  });

  it("embeds a base64 file part", () => {
    const { body } = buildMultipartBody(
      [{ kind: "file", name: "f", filename: "x.txt", contentType: "text/plain", dataBase64: Buffer.from("hi").toString("base64") }],
      { boundarySeed: "SEED" }
    );
    const text = body.toString("utf8");
    expect(text).toContain('filename="x.txt"');
    expect(text).toContain("Content-Type: text/plain");
    expect(text).toContain("hi");
  });
});
