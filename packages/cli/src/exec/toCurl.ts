import type { AuthConfig, RequestItem, RequestRow } from "@portiq/core";

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function authHeader(type: string | undefined, cfg: AuthConfig | undefined): [string, string] | null {
  if (!type || type === "none" || !cfg) return null;
  if (type === "bearer" && cfg.bearer?.token) return ["Authorization", `Bearer ${cfg.bearer.token}`];
  if (type === "basic" && (cfg.basic?.username || cfg.basic?.password)) {
    return ["Authorization", `Basic ${Buffer.from(`${cfg.basic.username}:${cfg.basic.password}`).toString("base64")}`];
  }
  if (type === "api_key" && cfg.api_key?.add_to === "header" && cfg.api_key?.key) return [cfg.api_key.key, cfg.api_key.value];
  return null;
}

function urlWithParams(item: RequestItem): string {
  const rows: RequestRow[] = [...(item.paramsRows ?? [])];
  if (item.authType === "api_key" && item.authConfig?.api_key?.add_to === "query" && item.authConfig.api_key.key) {
    rows.push({ key: item.authConfig.api_key.key, value: item.authConfig.api_key.value, comment: "", enabled: true });
  }
  const qs = rows
    .filter((r) => r.key && r.enabled !== false)
    .map((r) => `${encodeURIComponent(r.key)}=${encodeURIComponent(r.value || "")}`)
    .join("&");
  if (!qs) return item.url;
  return item.url.includes("?") ? `${item.url}&${qs}` : `${item.url}?${qs}`;
}

export function requestItemToCurl(item: RequestItem): string {
  const parts: string[] = [`curl -X ${(item.method || "GET").toUpperCase()}`, shellQuote(urlWithParams(item))];
  const headers: Array<[string, string]> = (item.headersRows ?? [])
    .filter((r) => r.key && r.enabled !== false)
    .map((r) => [r.key, r.value] as [string, string]);
  const auth = authHeader(item.authType, item.authConfig);
  if (auth) headers.unshift(auth);
  for (const [k, v] of headers) parts.push(`-H ${shellQuote(`${k}: ${v}`)}`);

  const bodyType = item.bodyType ?? "none";
  if (bodyType === "json" || bodyType === "xml" || bodyType === "raw") {
    if (item.bodyText) parts.push(`-d ${shellQuote(item.bodyText)}`);
  } else if (bodyType === "form") {
    const data = (item.bodyRows ?? [])
      .filter((r) => r.key && r.enabled !== false)
      .map((r) => `${r.key}=${r.value}`)
      .join("&");
    if (data) parts.push(`-d ${shellQuote(data)}`);
  } else if (bodyType === "multipart") {
    for (const r of (item.bodyRows ?? []).filter((r) => r.key && r.enabled !== false)) {
      parts.push(`-F ${shellQuote(r.kind === "file" ? `${r.key}=@${r.fileName || "upload.bin"}` : `${r.key}=${r.value}`)}`);
    }
  }
  return parts.join(" ");
}
