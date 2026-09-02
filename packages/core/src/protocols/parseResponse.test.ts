import { describe, it, expect } from "vitest";
import { HttpProtocol } from "./http";
import { GraphQLProtocol } from "./graphql";

/**
 * Regression test for Task 15's `parseResponse` byte-size regression.
 *
 * `size` must be computed via a cross-environment byte-length primitive
 * (e.g. `TextEncoder`), not a Node-only globals-based API, because these
 * `parseResponse` functions also run in the Electron renderer (Chromium,
 * where Node-only globals are unavailable).
 *
 * Note: this test runs under vitest's Node environment, so it can't by
 * itself prove browser-safety - it documents the intended byte-size
 * behavior. The real fix is using `TextEncoder`, which is available in
 * both Node and browsers.
 */
describe("parseResponse size", () => {
  it("HttpProtocol.parseResponse computes UTF-8 byte length for ASCII body", () => {
    const result = HttpProtocol.parseResponse({
      status: 200,
      statusText: "OK",
      duration: 1,
      headers: {},
      body: '{"a":1}',
      json: { a: 1 }
    });
    expect(result.size).toBe(7);
  });

  it("HttpProtocol.parseResponse computes UTF-8 byte length for multi-byte body", () => {
    const result = HttpProtocol.parseResponse({
      status: 200,
      statusText: "OK",
      duration: 1,
      headers: {},
      body: "café",
      json: null
    });
    // "café" is 4 characters but 5 UTF-8 bytes ("é" is 2 bytes).
    expect(result.size).toBe(5);
    expect(result.size).not.toBe("café".length);
  });

  it("GraphQLProtocol.parseResponse computes UTF-8 byte length for ASCII body", () => {
    const result = GraphQLProtocol.parseResponse({
      status: 200,
      statusText: "OK",
      duration: 1,
      headers: {},
      body: '{"a":1}',
      json: { a: 1 }
    });
    expect(result.size).toBe(7);
  });

  it("GraphQLProtocol.parseResponse computes UTF-8 byte length for multi-byte body", () => {
    const result = GraphQLProtocol.parseResponse({
      status: 200,
      statusText: "OK",
      duration: 1,
      headers: {},
      body: "café",
      json: null
    });
    expect(result.size).toBe(5);
    expect(result.size).not.toBe("café".length);
  });
});
