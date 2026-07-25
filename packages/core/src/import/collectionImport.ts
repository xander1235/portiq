import { importPortable } from "../store/portable";
import type { ImportedLibrary } from "./types";
import type { IdFactory } from "./ids";
import { looksLikePostman, parsePostmanCollection } from "./postmanParser";
import { looksLikeOpenApi, parseOpenApi } from "./openapiParser";

export type ImportFormat = "portiq" | "postman" | "openapi" | "unknown";

export function detectImportFormat(data: unknown): ImportFormat {
  if (data && typeof data === "object") {
    if ((data as { portiq?: unknown }).portiq === 1) return "portiq";
    if (looksLikePostman(data)) return "postman";
    if (looksLikeOpenApi(data)) return "openapi";
  }
  return "unknown";
}

/** Detect and parse any supported JSON collection file into the normalized
 *  `{ collections, environments }` shape consumed by `mergeIntoAppState`. */
export function importLibrary(data: unknown, opts: { newId?: IdFactory } = {}): ImportedLibrary {
  switch (detectImportFormat(data)) {
    case "portiq":
      return importPortable(data);
    case "postman":
      return parsePostmanCollection(data, opts);
    case "openapi":
      return parseOpenApi(data, opts);
    default:
      throw new Error("Unrecognized import format (expected Portiq portable, Postman v2.1, or OpenAPI 3.x)");
  }
}
