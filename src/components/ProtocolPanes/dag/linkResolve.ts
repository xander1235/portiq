import { EMPTY_REQUEST_CONFIG, type RequestConfig, type RequestNodeData } from "./types";

/** Adapt a collection/app request object (loosely typed) to a RequestConfig. */
export function savedRequestToConfig(req: unknown): RequestConfig {
  const r = (req || {}) as Record<string, unknown>;
  const headers = typeof r.headersText === "string" ? r.headersText : "";
  return {
    method: typeof r.method === "string" ? r.method : "GET",
    url: typeof r.url === "string" ? r.url : "",
    headers,
    body: typeof r.bodyText === "string" ? r.bodyText : (typeof r.body === "string" ? r.body : ""),
    params: typeof r.paramsText === "string" ? r.paramsText : "",
    pathVars: typeof r.pathVarsText === "string" ? r.pathVarsText : "",
  };
}

export function resolveStepConfig(
  data: RequestNodeData,
  lookup: (id: string) => RequestConfig | undefined,
): { config: RequestConfig; brokenLink: boolean } {
  let base: RequestConfig;
  let brokenLink = false;
  if (data.linkedRequestId) {
    const linked = lookup(data.linkedRequestId);
    if (linked) base = linked;
    else { base = { ...EMPTY_REQUEST_CONFIG }; brokenLink = true; }
  } else {
    base = data.inlineConfig || { ...EMPTY_REQUEST_CONFIG };
  }
  const config: RequestConfig = { ...base };
  (Object.keys(data.overrides) as (keyof RequestConfig)[]).forEach(k => {
    const v = data.overrides[k];
    if (v !== undefined) config[k] = v;
  });
  return { config, brokenLink };
}
