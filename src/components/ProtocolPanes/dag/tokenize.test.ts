import { describe, it, expect } from "vitest";
import { splitTemplate } from "./tokenize";

describe("splitTemplate", () => {
  it("returns a single literal when there are no tokens", () => {
    expect(splitTemplate("hello")).toEqual([{ ref: false, text: "hello" }]);
  });
  it("splits a token in the middle", () => {
    expect(splitTemplate("Bearer {{login.body.token}}!")).toEqual([
      { ref: false, text: "Bearer " },
      { ref: true, text: "{{login.body.token}}" },
      { ref: false, text: "!" },
    ]);
  });
  it("handles adjacent and multiple tokens", () => {
    expect(splitTemplate("{{a}}{{b}}")).toEqual([
      { ref: true, text: "{{a}}" },
      { ref: true, text: "{{b}}" },
    ]);
  });
  it("returns empty array for empty string", () => {
    expect(splitTemplate("")).toEqual([]);
  });
  it("keeps an unclosed brace as a literal", () => {
    expect(splitTemplate("a {{b")).toEqual([{ ref: false, text: "a {{b" }]);
  });
});
