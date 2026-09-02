import { describe, it, expect } from "vitest";
import { parseLLMJson } from "./parseLLMJson";

describe("parseLLMJson", () => {
  it("parses a bare JSON object", () => {
    expect(parseLLMJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("extracts JSON embedded in a fenced code block", () => {
    const raw = "Here you go:\n```json\n{\"message\":\"hi\",\"operations\":[]}\n```";
    const parsed = parseLLMJson(raw);
    expect(parsed.operations).toEqual([]);
    expect(parsed.message).toContain("hi");
  });

  it("merges leading and trailing prose into the message field", () => {
    const parsed = parseLLMJson('Intro.\n{"message":"core"}\nOutro.');
    expect(parsed.message).toContain("Intro.");
    expect(parsed.message).toContain("core");
    expect(parsed.message).toContain("Outro.");
  });

  it("parses a JSON array", () => {
    expect(parseLLMJson("[1,2,3]")).toEqual([1, 2, 3]);
  });
});
