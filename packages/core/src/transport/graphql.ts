import { buildHttpResult, type HttpResult } from "./httpResult";

export interface GraphQLSendPayload {
  url: string;
  headers?: Record<string, string>;
  query: string;
  variables?: string | object | null;
  operationName?: string;
}

export async function sendGraphQL(payload: GraphQLSendPayload): Promise<HttpResult | { error: string }> {
  const { url, headers = {}, query, variables, operationName } = payload;
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
  try {
    const response = await fetch(url, { method: "POST", headers: finalHeaders, body: graphqlBody });
    const text = await response.text();
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
  } catch (err: any) {
    return { error: err?.message || String(err) };
  }
}
