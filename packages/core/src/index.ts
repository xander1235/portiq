// @portiq/core public API. Populated task-by-task in Phase 0.
export const CORE_VERSION = "0.0.0";
export * from "./model";
export * from "./store/dataDir";
export * from "./store/kvStore";
export * from "./store/appStateStore";
export * from "./store/portable";
export * from "./exec/interpolate";
export * from "./exec/headers";
export * from "./exec/autoHeaders";
export * from "./exec/multipart";
export * from "./exec/assembleRequest";
export * from "./exec/grpcExec";
export * from "./import/curlParser";
export * from "./import/types";
export * from "./import/ids";
export * from "./import/postmanParser";
export * from "./import/openapiParser";
export * from "./import/collectionImport";
export * from "./transport/http";
export * from "./transport/httpResult";
export * from "./transport/graphql";
export * from "./transport/websocket";
export * from "./mock";
// transport/grpc is intentionally NOT re-exported here: it top-level-imports
// @grpc/grpc-js / @grpc/proto-loader (large Node-only CJS with real module-scope
// side effects — resolver/load-balancer registration — so Rollup can't tree-shake
// it away once reachable). Exporting it from this renderer-facing barrel pulled
// the whole native gRPC stack into the Chromium bundle even though GrpcTransport
// is only ever constructed from electron/main.cjs. Node-only consumers must import
// it from the "@portiq/core/grpc" subpath instead (mirrors the "@portiq/core/flows"
// subpath already used for the DAG engine).
export * from "./scripting/testRunner";
export * from "./scripting/scriptSteps";
export * from "./scripting/pm";
export * from "./protocols";
