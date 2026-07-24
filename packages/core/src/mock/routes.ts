import type { Collection, FolderItem, RequestItem } from "../model";
import type { MockRoute } from "./mockServer";

/** Route input with a permissive body (objects allowed; coerced to JSON). */
export type MockRouteInput = Partial<Omit<MockRoute, "body">> & { body?: unknown };

/**
 * Normalizes partial route definitions to fully-defaulted MockRoutes.
 * Headless port of the `sanitizedRoutes` mapping in
 * src/services/mockServer.ts (:41-49): method→GET, path→"/", statusCode→200,
 * headers→JSON content-type, delay→0. Object bodies are JSON-stringified
 * (the manager also coerces at serve time; this keeps MockRoute.body: string).
 */
export function sanitizeRoutes(routes: MockRouteInput[] | null | undefined): MockRoute[] {
  return (routes ?? []).map((r) => ({
    method: r.method || "GET",
    path: r.path || "/",
    statusCode: r.statusCode || 200,
    headers: r.headers || { "Content-Type": "application/json" },
    body: typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}),
    delay: r.delay || 0,
  }));
}

/**
 * Derives mock routes from a collection's requests, walking folders recursively.
 * Headless port of src/services/mockServer.ts generateRoutesFromCollection
 * (:115-154). The UI-only `id`/`description` fields are dropped — core's
 * MockRoute serving contract is (method, path, statusCode, headers, body, delay).
 */
export function generateRoutesFromCollection(
  collection: Collection | null | undefined,
): MockRoute[] {
  if (!collection?.items) return [];
  const routes: MockRoute[] = [];
  const walk = (items: (FolderItem | RequestItem)[]): void => {
    for (const item of items) {
      if (item.type === "folder") {
        walk(item.items);
      } else if (item.type === "request") {
        try {
          let path = "/mock";
          if (item.url) {
            const url = new URL(item.url.startsWith("http") ? item.url : `http://localhost${item.url}`);
            path = url.pathname || "/mock";
          }
          routes.push({
            method: item.method || "GET",
            path,
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              { message: `Mock response for ${item.name}`, _mockSource: item.name, data: {} },
              null,
              2,
            ),
            delay: 0,
          });
        } catch {
          // Skip requests with invalid URLs (mirrors the renderer's try/catch).
        }
      }
    }
  };
  walk(collection.items);
  return routes;
}
