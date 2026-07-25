import { HttpTransport, type FolderItem, type RequestItem, type TestSummary } from "@portiq/core";
import type { Command } from "commander";
import type { CliContext } from "../context";
import { parseGlobalFlags, type CommandModule } from "../registry";
import { resolveRef, resolveVars, listRequestsWithPaths } from "../resolve/refs";
import { resolveHttpPayload } from "../resolve/httpPayload";
import { runRequest, defaultRunDeps } from "../exec/runRequest";
import { runSavedFlow } from "../exec/runFlow";
import { withStateAsync } from "./store";
import { emit } from "./emit";
import { TestFailureError } from "../errors";
import type { CommandOutput } from "../reporters";

function flatten(items: (FolderItem | RequestItem)[], out: RequestItem[]): void {
  for (const it of items) {
    if (it.type === "request") out.push(it);
    else if (it.type === "folder") flatten(it.items, out);
  }
}

function hasFailures(tests: TestSummary | null): boolean {
  return !!tests && tests.failed + tests.errored > 0;
}

export const runCommand: CommandModule = {
  register(program: Command, ctx: CliContext) {
    program
      .command("run <ref>")
      .description("execute a saved request, collection, or flow and run its tests")
      .option("--id <uuid>", "resolve by id instead of path")
      .action(async (ref: string, opts: { id?: string }, cmd: Command) => {
        const flags = parseGlobalFlags(cmd);
        const { output, failed } = await withStateAsync(ctx, flags, async (state) => {
          const resolved = resolveRef(state, { ref, id: opts.id });
          const vars = resolveVars(state, flags);
          const deps = defaultRunDeps();

          if (resolved.kind === "collection" && resolved.collection) {
            const reqs: RequestItem[] = [];
            flatten(resolved.collection.items ?? [], reqs);
            const items: Array<{ name: string; response: import("@portiq/core").HttpResult | null; error: string | null }> = [];
            const entries: import("@portiq/core").TestEntry[] = [];
            for (const r of reqs.filter((x) => x.protocol !== "dag" && x.protocol !== "websocket" && x.protocol !== "grpc")) {
              const outcome = await runRequest(r, vars, deps, { timeoutMs: flags.timeout });
              items.push({ name: r.name, response: outcome.response, error: outcome.error });
              if (outcome.tests) for (const g of outcome.tests.groups) entries.push(...g.entries);
            }
            const { summarizeTests } = await import("@portiq/core");
            const tests = summarizeTests(entries);
            const output: CommandOutput = { kind: "suite", label: resolved.collection.name, items, tests };
            return { output, failed: hasFailures(tests) };
          }

          if (resolved.kind === "flow" && resolved.request) {
            if (flags.dryRun) {
              const output: CommandOutput = { kind: "entity", entity: { kind: "flow", name: resolved.request.name, nodes: resolved.request.dagGraph?.nodes.map((n) => n.name) ?? [] } };
              return { output, failed: false };
            }
            const all = listRequestsWithPaths(state).map((r) => r.item);
            const transport = new HttpTransport();
            const { steps, tests } = await runSavedFlow(resolved.request, all, vars, transport, flags.timeout);
            const output: CommandOutput = { kind: "execution", request: { protocol: "dag", method: "FLOW", url: resolved.request.name, headers: {} }, response: null, error: null, tests, steps };
            return { output, failed: hasFailures(tests) };
          }

          // single request
          const req = resolved.request!;
          if (flags.dryRun) {
            if (req.protocol === "grpc") {
              const { buildGrpcPayload } = await import("@portiq/core");
              const payload = buildGrpcPayload(req, vars);
              const output: CommandOutput = { kind: "entity", entity: { protocol: "grpc", service: payload.service, method: payload.method, url: payload.url, callType: payload.callType ?? "UNARY", body: JSON.stringify(payload.body) } };
              return { output, failed: false };
            }
            const { view } = resolveHttpPayload(req, vars, { timeoutMs: flags.timeout });
            const output: CommandOutput = { kind: "execution", request: view, response: null, error: null, tests: null };
            return { output, failed: false };
          }
          const outcome = await runRequest(req, vars, deps, { timeoutMs: flags.timeout });
          const output: CommandOutput = { kind: "execution", request: outcome.request, response: outcome.response, error: outcome.error, tests: outcome.tests, grpc: outcome.grpc };
          if (outcome.error) process.exitCode = 1;
          return { output, failed: hasFailures(outcome.tests) };
        });

        emit(ctx, flags, output);
        if (failed && flags.failOnTest) {
          throw new TestFailureError("one or more tests failed");
        }
      });
  },
};
