import { buildHttpResult, type HttpResult } from "./httpResult";
import { readResponseText, scrubUrls } from "./http";

const MAX_REDIRECTS = 10;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_RESPONSE_BODY_LENGTH = 50 * 1024 * 1024;

export interface GraphQLSendPayload {
  url: string;
  headers?: Record<string, string>;
  query: string;
  variables?: string | object | null;
  operationName?: string;
  timeoutMs?: number;
  hostGuard?: (url: string) => void;
}

export async function sendGraphQL(
  payload: GraphQLSendPayload
): Promise<HttpResult | { error: string } | { timedOut: true; error: string }> {
  const { url, headers = {}, query, variables, operationName, timeoutMs } = payload;
  let parsedVariables: object | undefined;
  if (typeof variables === "string" && variables.trim()) {
    try { parsedVariables = JSON.parse(variables); }
    catch { return { error: "GraphQL variables must be valid JSON" }; }
  } else if (variables && typeof variables === "object") {
    parsedVariables = variables;
  }
  const finalHeaders: Record<string, string> = { ...headers, "Content-Type": "application/json" };
  const graphqlBody = JSON.stringify({
    query,
    variables: parsedVariables || undefined,
    operationName: operationName || undefined,
  });
  const startedAt = Date.now();
  const controller = new AbortController();
  const normalizedTimeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : 30000;
  const timeoutHandle = setTimeout(() => controller.abort(), normalizedTimeout);

  const guard = (u: string): { error: string } | null => {
    if (!payload.hostGuard) return null;
    try {
      payload.hostGuard(u);
      return null;
    } catch (err: any) {
      return { error: err?.message || String(err) };
    }
  };

  try {
    const initial = guard(url);
    if (initial) return initial;

    let currentUrl = url;
    for (let hops = 0; ; hops++) {
      let response: Response;
      try {
        response = await fetch(currentUrl, {
          method: "POST",
          headers: finalHeaders,
          body: graphqlBody,
          signal: controller.signal,
          redirect: "manual",
        });
      } catch (err: any) {
        if (err?.name === "AbortError") return { timedOut: true, error: "Request timeout" };
        return { error: scrubUrls(err?.message || String(err)) };
      }

      const location = response.headers.get("location");
      if (REDIRECT_STATUSES.has(response.status) && location !== null) {
        if (hops >= MAX_REDIRECTS) {
          await response.body?.cancel().catch(() => {});
          return { error: `Too many redirects (max ${MAX_REDIRECTS})` };
        }
        const nextUrl = new URL(location, currentUrl).toString();
        const blocked = guard(nextUrl);
        if (blocked) {
          await response.body?.cancel().catch(() => {});
          return blocked;
        }
        await response.body?.cancel().catch(() => {});
        currentUrl = nextUrl;
        continue;
      }

      let text: string;
      try {
        text = await readResponseText(response, MAX_RESPONSE_BODY_LENGTH);
      } catch (err: any) {
        return { error: err?.message || String(err) };
      }
      const headersObj: Record<string, string> = {};
      response.headers.forEach((value, key) => { headersObj[key] = value; });
      return buildHttpResult({
        status: response.status,
        statusText: response.statusText,
        headers: headersObj,
        body: text,
        duration: Date.now() - startedAt,
        httpVersion: "auto",
      });
    }
  } finally {
    clearTimeout(timeoutHandle);
  }
}
