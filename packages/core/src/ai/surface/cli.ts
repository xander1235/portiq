import { assist, generateTests, listModels, type AssistDeps } from "../assist";
import { AiConfigError } from "../config";

export interface CliCommandResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export interface CliCommandDescriptor {
  name: string;
  summary: string;
  run(argv: string[], flags: Record<string, any>): Promise<CliCommandResult>;
}

export interface AiCliDeps extends AssistDeps {
  getCollections: () => any[] | Promise<any[]>;
  /** Phase 2 CLI scaffold injects its ref-resolver + executor for `ai tests <ref>`. */
  runRequest?: (ref: string) => Promise<{ request: any; response: any }>;
}

function assistDepsOf(deps: AiCliDeps): AssistDeps {
  return { config: deps.config, configOptions: deps.configOptions, fetch: deps.fetch, semanticSearch: deps.semanticSearch, registry: deps.registry, log: deps.log };
}

export function createAiCliCommands(deps: AiCliDeps): CliCommandDescriptor[] {
  const shared = assistDepsOf(deps);

  return [
    {
      name: "ai",
      summary: "AI assist: `ai <prompt>` (analyze/suggest), `ai models` (list models), `ai tests <ref>` (generate tests).",
      async run(argv, flags): Promise<CliCommandResult> {
        try {
          const sub = argv[0];

          if (sub === "models") {
            const models = await listModels(shared);
            return flags.json
              ? { exitCode: 0, stdout: JSON.stringify({ models }, null, 2) }
              : { exitCode: 0, stdout: models.join("\n") };
          }

          if (sub === "tests") {
            const ref = argv[1];
            if (!ref) return { exitCode: 3, stderr: "usage: ai tests <ref>" };
            if (!deps.runRequest) return { exitCode: 3, stderr: "ai tests requires a request runner (not available in this context)" };
            const { request, response } = await deps.runRequest(ref);
            const tests = await generateTests(request, response, shared);
            return flags.json
              ? { exitCode: 0, stdout: JSON.stringify({ tests }, null, 2) }
              : { exitCode: 0, stdout: tests.join("\n") };
          }

          const prompt = argv.join(" ").trim();
          if (!prompt) return { exitCode: 3, stderr: "usage: ai <prompt>" };
          const collections = await deps.getCollections();
          const res = await assist({ prompt, collections }, shared);
          if (flags.json) {
            return { exitCode: 0, stdout: JSON.stringify({ message: res.message, operations: res.operations, model: res._model }, null, 2) };
          }
          const opsLine = res.operations.length ? `\n\nSuggested operations: ${res.operations.map((o: any) => o.type).join(", ")}` : "";
          return { exitCode: 0, stdout: `${res.message}${opsLine}` };
        } catch (e) {
          if (e instanceof AiConfigError) return { exitCode: 3, stderr: e.message };
          return { exitCode: 1, stderr: e instanceof Error ? e.message : String(e) };
        }
      },
    },
  ];
}
