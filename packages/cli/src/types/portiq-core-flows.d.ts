// Ambient module shim for `@portiq/core/flows`, scoped to the CommonJS
// production build (tsconfig.build.json).
//
// Editor/vitest use `moduleResolution: "Bundler"` (tsconfig.json), which
// understands @portiq/core's package.json `exports["./flows"]` map and
// resolves straight to the real TypeScript source
// (packages/core/src/flows/index.ts) — real types, no shim needed there.
//
// The production build uses classic `moduleResolution: "Node"` (needed so
// the emitted CommonJS `require("@portiq/core/flows")` matches the
// `require`-condition/dist target at runtime). Classic resolution does not
// understand `exports` subpath maps at all, and @portiq/core emits no
// `.d.ts` files for its dist output, so the build cannot otherwise see any
// types for this subpath. This shim supplies the minimal shape the CLI
// actually consumes (packages/cli/src/exec/runFlow.ts) so the build
// type-checks; it mirrors (does not import) the real shapes in
// packages/core/src/flows/{types,engine,linkResolve}.ts.
declare module "@portiq/core/flows" {
  export type NodeStatus = "idle" | "pending" | "running" | "success" | "error" | "skipped";

  export interface RequestConfig {
    method: string;
    url: string;
    headers: string;
    body: string;
    params: string;
    pathVars: string;
  }

  export interface StepResult {
    request?: {
      method?: string;
      url?: string;
      headers?: Record<string, string>;
      body?: string;
      params?: Record<string, string>;
      pathVars?: Record<string, string>;
    };
    response?: {
      status: number;
      statusText?: string;
      headers?: Record<string, string>;
      data?: unknown;
      body?: unknown;
      error?: string;
      time?: number;
    };
    loopIteration?: number;
  }

  export type StepsContext = Record<string, StepResult>;

  export type DagNodeType = "request" | "payload" | "condition" | "transform";

  export interface DagNode {
    id: string;
    type: DagNodeType;
    name: string;
    label: string;
    data: unknown;
    status: NodeStatus;
  }

  export interface DagEdge {
    id: string;
    from: string;
    to: string;
    branch?: "true" | "false" | null;
    runOnFailure?: boolean;
    maxIterations?: number;
    terminateWhen?: string;
  }

  export interface DagPosition {
    x: number;
    y: number;
  }

  export interface DagGraph {
    version: 2;
    nodes: DagNode[];
    edges: DagEdge[];
    positions: Record<string, DagPosition>;
    lastRun?: unknown;
  }

  export interface SendResult {
    status: number;
    statusText?: string;
    headers?: Record<string, string>;
    data?: unknown;
    time?: number;
    error?: string;
  }

  export interface RunDeps {
    sendRequest: (payload: {
      method: string;
      url: string;
      headers: Record<string, string>;
      body?: string;
      timeoutMs?: number;
    }) => Promise<SendResult>;
    lookupConfig: (id: string) => RequestConfig | undefined;
    env: Record<string, string>;
    onStatus: (nodeId: string, status: NodeStatus, meta?: { reason?: string; result?: StepResult }) => void;
  }

  export interface RunOptions {
    mode?: "all" | "only" | "from" | "upTo";
    targetId?: string;
    priorSteps?: StepsContext;
  }

  export function runFlow(graph: DagGraph, deps: RunDeps, options?: RunOptions): Promise<StepsContext>;
  export function savedRequestToConfig(req: unknown): RequestConfig;
}
