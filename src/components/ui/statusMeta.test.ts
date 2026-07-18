import { describe, it, expect } from "vitest";
import { statusMeta } from "./statusMeta";

describe("statusMeta", () => {
  it("2xx is success", () => expect(statusMeta(200)).toEqual({ label: "200 OK", tone: "success" }));
  it("201 keeps its reason", () => expect(statusMeta(201).label).toBe("201 Created"));
  it("3xx is info", () => expect(statusMeta(304).tone).toBe("info"));
  it("4xx is warn", () => expect(statusMeta(404)).toEqual({ label: "404 Not Found", tone: "warn" }));
  it("5xx is error", () => expect(statusMeta(500).tone).toBe("error"));
  it("literal error", () => expect(statusMeta("error")).toEqual({ label: "Error", tone: "error" }));
  it("pending", () => expect(statusMeta("pending")).toEqual({ label: "…", tone: "muted" }));
  it("null is muted", () => expect(statusMeta(null).tone).toBe("muted"));
  it("unknown code still labels the number", () => expect(statusMeta(799).label).toBe("799"));
});
