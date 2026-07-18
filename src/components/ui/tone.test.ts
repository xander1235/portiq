import { describe, it, expect } from "vitest";
import { toneColor } from "./tone";

describe("toneColor", () => {
  it("maps success to accent-2", () => expect(toneColor("success")).toBe("var(--accent-2)"));
  it("maps error to danger", () => expect(toneColor("error")).toBe("var(--danger)"));
  it("maps muted", () => expect(toneColor("muted")).toBe("var(--muted)"));
});
