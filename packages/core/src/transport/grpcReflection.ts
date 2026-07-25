import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { Client as ReflectionClient } from "grpc-reflection-js";
import { PROTO_LOADER_OPTIONS } from "./grpcProto";

/**
 * Resolve a gRPC package object for `service` from a server's reflection endpoint
 * (grpc.reflection.v1alpha.ServerReflection), avoiding the need for a local .proto.
 *
 * grpc-reflection-js's `fileContainingSymbol` resolves to a protobufjs `Root` (not a
 * pre-built package definition), so it is converted via `@grpc/proto-loader`'s
 * `fromJSON` before being handed to `grpc.loadPackageDefinition`. This keeps the
 * return shape identical to `loadProto`, so `findService` + the transport dial path
 * are unchanged.
 */
export async function loadProtoViaReflection(
  target: string,
  creds: grpc.ChannelCredentials,
  service: string
): Promise<grpc.GrpcObject> {
  const client = new ReflectionClient(target, creds);
  const root = await client.fileContainingSymbol(service);
  const packageDefinition = protoLoader.fromJSON(root.toJSON(), PROTO_LOADER_OPTIONS);
  return grpc.loadPackageDefinition(packageDefinition);
}
