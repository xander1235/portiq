import { readFileSync } from "node:fs";
import {
  ConflictError, importLibrary, inferRequestNameFromUrl, looksLikeCurl, mergeIntoAppState, parseCurl,
  type AppState, type ParsedCurl, type RequestItem,
} from "@portiq/core";
import type { Command } from "commander";
import type { CliContext } from "../context";
import { parseGlobalFlags, type CommandModule } from "../registry";
import { emit } from "./emit";
import { openStoreForWrite } from "./openStore";
import { RuntimeError, UsageError } from "../errors";

let counter = 0;
function newId(): string {
  counter += 1;
  return `imported-${Date.now()}-${counter}`;
}

export function parsedCurlToRequest(parsed: ParsedCurl, name: string): RequestItem {
  return {
    type: "request", id: newId(), name, description: "", tags: [], protocol: "http",
    method: parsed.method, url: parsed.url,
    headersRows: parsed.headersRows, paramsRows: parsed.paramsRows,
    authType: parsed.authType, authConfig: parsed.authConfig,
    bodyType: parsed.bodyType, bodyText: parsed.bodyText, bodyRows: parsed.bodyRows,
  };
}

function applyImport(state: AppState, contents: string, collectionName: string): { state: AppState; summary: string } {
  if (looksLikeCurl(contents)) {
    const parsed = parseCurl(contents.trim());
    const req = parsedCurlToRequest(parsed, inferRequestNameFromUrl(parsed.url));
    const collections = [...(state.collections ?? [])];
    let target = collections.find((c) => c.name === collectionName);
    if (!target) {
      target = { id: newId(), name: collectionName, items: [] };
      collections.push(target);
    }
    target.items = [...target.items, req];
    return { state: { ...state, collections }, summary: `imported curl request "${req.name}" into "${collectionName}"` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new UsageError("File is neither a curl command nor valid JSON");
  }
  let incoming: { collections: unknown[]; environments: unknown[] };
  try {
    incoming = importLibrary(parsed) as { collections: unknown[]; environments: unknown[] };
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : "Unrecognized import format");
  }
  return {
    state: mergeIntoAppState(state, incoming as any),
    summary: `merged ${incoming.collections.length} collection(s), ${incoming.environments.length} environment(s)`,
  };
}

export const importCommand: CommandModule = {
  register(program: Command, ctx: CliContext) {
    program
      .command("import <file>")
      .description("import a curl command, a portiq.json file, a Postman v2.1 collection, or an OpenAPI 3.x document")
      .option("--collection <name>", "target collection for curl imports", "Imported")
      .action((file: string, opts: { collection: string }, cmd: Command) => {
        const flags = parseGlobalFlags(cmd);
        const contents = readFileSync(file, "utf8");
        const store = openStoreForWrite(ctx, flags);
        try {
          for (let attempt = 0; attempt < 2; attempt++) {
            const { state, version } = store.load();
            if (!state) throw new RuntimeError("No Portiq data found to import into");
            const { state: next, summary } = applyImport(state, contents, opts.collection);
            try {
              store.save(next, version);
              emit(ctx, flags, { kind: "message", text: summary });
              return;
            } catch (err) {
              if (err instanceof ConflictError && attempt === 0) continue;
              throw err;
            }
          }
        } finally {
          store.close();
        }
      });
  },
};
