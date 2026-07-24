import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

/** Standard proto-loader options: preserve field casing and stringify longs/enums. */
export const PROTO_LOADER_OPTIONS: protoLoader.Options = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

export interface LoadProtoInput {
  protoPath?: string;
  protoContent?: string;
}

/**
 * Load a proto definition into a gRPC package object.
 * Accepts a file path, or raw proto content (written to an OS temp file, then loaded).
 */
export function loadProto(input: LoadProtoInput): grpc.GrpcObject {
  let file = input.protoPath;
  if (!file) {
    if (!input.protoContent || !input.protoContent.trim()) {
      throw new Error("gRPC requires either protoPath or protoContent");
    }
    const dir = mkdtempSync(join(tmpdir(), "portiq-proto-"));
    file = join(dir, "service.proto");
    writeFileSync(file, input.protoContent, "utf8");
  }
  const def = protoLoader.loadSync(file, PROTO_LOADER_OPTIONS);
  return grpc.loadPackageDefinition(def);
}

function isServiceCtor(value: unknown): value is grpc.ServiceClientConstructor {
  return typeof value === "function" && typeof (value as any).service === "object";
}

/**
 * Resolve a service client constructor by dotted path ("pkg.Service")
 * or by bare name (deep search of the package tree).
 */
export function findService(pkg: grpc.GrpcObject, serviceName: string): grpc.ServiceClientConstructor {
  if (serviceName.includes(".")) {
    let node: any = pkg;
    for (const segment of serviceName.split(".")) {
      node = node?.[segment];
    }
    if (isServiceCtor(node)) return node;
  }

  const bare = serviceName.includes(".") ? serviceName.split(".").pop()! : serviceName;
  const stack: any[] = [pkg];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    for (const [key, value] of Object.entries(node)) {
      if (key === bare && isServiceCtor(value)) return value;
      if (value && typeof value === "object" && !isServiceCtor(value)) stack.push(value);
    }
  }
  throw new Error(`gRPC service not found: ${serviceName}`);
}

/** Flatten gRPC Metadata to a first-value string map (best-effort, for display). */
export function metadataToObject(md: grpc.Metadata | undefined | null): Record<string, string> {
  if (!md) return {};
  const json = md.toJSON();
  const out: Record<string, string> = {};
  for (const [key, values] of Object.entries(json)) {
    const first = Array.isArray(values) ? values[0] : values;
    out[key] = typeof first === "string" ? first : String(first ?? "");
  }
  return out;
}
