export type DagNodeType = "request" | "payload" | "condition" | "transform";
export type NodeStatus = "idle" | "pending" | "running" | "success" | "error" | "skipped";

/** Raw, untemplated request config fields (all strings; headers/params/pathVars are text blocks). */
export interface RequestConfig {
  method: string;
  url: string;
  headers: string;   // JSON string
  body: string;
  params: string;    // "k=v" newline-separated
  pathVars: string;  // "k=v" newline-separated
}

export interface RequestNodeData {
  linkedRequestId?: string;               // live link to a saved request
  overrides: Partial<RequestConfig>;      // per-step field overrides (templated)
  inlineConfig?: RequestConfig;           // used when not linked (or after detach)
}

export interface PayloadNodeData {
  content: string;                        // templated JSON/text
  contentType: "json" | "text";
}

export interface ConditionNodeData { expression: string; }
export interface TransformNodeData { script: string; }

export type DagNodeData =
  | RequestNodeData | PayloadNodeData | ConditionNodeData | TransformNodeData;

export interface DagNode {
  id: string;
  type: DagNodeType;
  name: string;    // stable, unique, editable reference key (slug)
  label: string;   // display label
  data: DagNodeData;
  status: NodeStatus;
}

export interface DagEdge {
  id: string;
  from: string;
  to: string;
  branch?: "true" | "false" | null;   // condition branch this edge belongs to
  runOnFailure?: boolean;             // follow even if source errored
  maxIterations?: number;             // self-edge loop cap
  terminateWhen?: string;             // self-edge loop stop expression
}

export interface DagPosition { x: number; y: number; }

export interface DagGraph {
  version: 2;
  nodes: DagNode[];
  edges: DagEdge[];
  positions: Record<string, DagPosition>;
}

/** Per-node runtime result, keyed in the steps context by node.name. */
export interface StepResult {
  request?: {
    method?: string; url?: string; headers?: Record<string, string>;
    body?: string; params?: Record<string, string>; pathVars?: Record<string, string>;
  };
  response?: {
    status: number; statusText?: string; headers?: Record<string, string>;
    data?: unknown; error?: string; time?: number;
  };
  loopIteration?: number;
}

export type StepsContext = Record<string, StepResult>;

export interface SkipInfo { nodeId: string; reason: "upstream-error" | "losing-branch" | "upstream-skipped"; }

export const EMPTY_REQUEST_CONFIG: RequestConfig = {
  method: "GET", url: "", headers: "", body: "", params: "", pathVars: "",
};
