import { z } from "zod";
import type { DagGraph, DagNode, DagEdge } from "@portiq/core/flows";

/**
 * Wire schema for authoring a flow graph over MCP. Loose where the engine is
 * loose (engine treats unknown node data keys as inert), strict where a bad
 * graph would break the run: version, edge endpoints, duplicate ids/names,
 * and node-count limits. `lastRun` is stripped so a caller cannot forge run
 * history into the persisted graph.
 */

const MAX_NODES = 100;
const MAX_EDGES = 200;

const positionSchema = z.object({ x: z.number(), y: z.number() });

const requestNodeDataSchema = z.object({
  linkedRequestId: z.string().optional(),
  overrides: z.record(z.string(), z.union([z.string(), z.undefined()])).optional(),
  inlineConfig: z.object({
    method: z.string(),
    url: z.string(),
    headers: z.string(),
    body: z.string(),
    params: z.string(),
    pathVars: z.string(),
  }).optional(),
});

const payloadNodeDataSchema = z.object({
  content: z.string(),
  contentType: z.enum(["json", "text"]),
});

const conditionNodeDataSchema = z.object({ expression: z.string() });

const transformNodeDataSchema = z.object({ script: z.string() });

const nodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["request", "payload", "condition", "transform"]),
  name: z.string().min(1),
  label: z.string(),
  data: z.union([requestNodeDataSchema, payloadNodeDataSchema, conditionNodeDataSchema, transformNodeDataSchema]),
  status: z.enum(["idle", "pending", "running", "success", "error", "skipped"]).optional(),
});

const edgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  branch: z.enum(["true", "false"]).nullish(),
  runOnFailure: z.boolean().optional(),
  maxIterations: z.number().int().min(1).max(1000).optional(),
  terminateWhen: z.string().optional(),
});

/** Parse + validate a caller-supplied dagGraph. Returns a clean graph safe to
 *  persist, or a descriptive error message. */
export function parseDagGraph(input: unknown): { graph: DagGraph } | { error: string } {
  const schema = z
    .object({
      version: z.literal(2),
      nodes: z.array(nodeSchema).min(1).max(MAX_NODES),
      edges: z.array(edgeSchema).max(MAX_EDGES),
      positions: z.record(z.string(), positionSchema).optional(),
      // Accept (and strip) a client-supplied lastRun so a read-modify-write of
      // get_request output round-trips without forging run history.
      lastRun: z.unknown().optional(),
    })
    .strip();

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: `dagGraph invalid at ${issue.path.join(".")}: ${issue.message}` };
  }

  const { nodes, edges, positions } = parsed.data;
  const g: DagGraph = {
    version: 2,
    nodes: nodes as DagNode[],
    edges: edges as DagEdge[],
    positions: positions ?? {},
  };

  const ids = new Set<string>();
  const names = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) return { error: `dagGraph invalid: duplicate node id '${n.id}'` };
    ids.add(n.id);
    if (names.has(n.name)) return { error: `dagGraph invalid: duplicate node name '${n.name}'` };
    names.add(n.name);
    if (n.type === "request" && n.data && "linkedRequestId" in n.data && !n.data.linkedRequestId) {
      return { error: `dagGraph invalid: node '${n.name}' has an empty linkedRequestId` };
    }
  }

  const namesSet = new Set(nodes.map((n) => n.name));
  for (const e of edges) {
    if (!ids.has(e.from)) return { error: `dagGraph invalid: edge '${e.id}' references unknown node '${e.from}'` };
    if (!ids.has(e.to)) return { error: `dagGraph invalid: edge '${e.id}' references unknown node '${e.to}'` };
    if (e.from === e.to && !namesSet.has(e.from)) return { error: `dagGraph invalid: self-edge on unknown node '${e.from}'` };
    if (e.from !== e.to && !e.branch) {
      // fine: unconditional edge
    }
  }

  return { graph: g };
}

/** Prototype-key guard shared with applyPatch: reject __proto__/constructor/
 *  prototype anywhere they appear as own object keys in the raw payload. */
export function rejectPrototypeKeys(value: unknown, path = "dagGraph"): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = rejectPrototypeKeys(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value as object)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") return `${path}.${key}`;
      const hit = rejectPrototypeKeys((value as Record<string, unknown>)[key], `${path}.${key}`);
      if (hit) return hit;
    }
  }
  return null;
}
