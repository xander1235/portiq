import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadProto, findService, metadataToObject } from "./grpcProto";
import * as grpc from "@grpc/grpc-js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "fixtures", "echo.proto");

describe("loadProto", () => {
  it("loads a service from a .proto file path", () => {
    const pkg = loadProto({ protoPath: FIXTURE }) as any;
    expect(typeof pkg.echo.EchoService).toBe("function");
    expect(typeof pkg.echo.EchoService.service).toBe("object");
  });

  it("loads a service from proto content string", () => {
    const content = readFileSync(FIXTURE, "utf8");
    const pkg = loadProto({ protoContent: content }) as any;
    expect(typeof pkg.echo.EchoService).toBe("function");
  });

  it("throws when neither protoPath nor protoContent is provided", () => {
    expect(() => loadProto({})).toThrow(/protoPath or protoContent/i);
  });

  it("removes the temp proto dir it creates when loading protoContent (no leaked temp files)", () => {
    const content = readFileSync(FIXTURE, "utf8");
    const before = new Set(readdirSync(tmpdir()).filter((f) => f.startsWith("portiq-proto-")));
    loadProto({ protoContent: content });
    const survivors = readdirSync(tmpdir()).filter(
      (f) => f.startsWith("portiq-proto-") && !before.has(f)
    );
    expect(survivors).toEqual([]);
  });
});

describe("findService", () => {
  it("resolves by fully-qualified name", () => {
    const pkg = loadProto({ protoPath: FIXTURE });
    const ctor = findService(pkg, "echo.EchoService");
    expect(typeof ctor.service).toBe("object");
  });

  it("resolves by bare service name via deep search", () => {
    const pkg = loadProto({ protoPath: FIXTURE });
    const ctor = findService(pkg, "EchoService");
    expect(typeof ctor.service).toBe("object");
  });

  it("throws for an unknown service", () => {
    const pkg = loadProto({ protoPath: FIXTURE });
    expect(() => findService(pkg, "NoSuchService")).toThrow(/NoSuchService/);
  });
});

describe("metadataToObject", () => {
  it("flattens metadata to a first-value string map", () => {
    const md = new grpc.Metadata();
    md.set("x-trace", "abc");
    expect(metadataToObject(md)).toEqual({ "x-trace": "abc" });
  });
});
