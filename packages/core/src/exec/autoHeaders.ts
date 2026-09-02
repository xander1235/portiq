import { hasHeader } from "./headers";

const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);

export function applyAutoHeaders(
  headers: Record<string, string>,
  ctx: { method: string; body?: string; hasMultipart?: boolean; appVersion?: string }
): Record<string, string> {
  if (!hasHeader(headers, "user-agent")) {
    headers["User-Agent"] = `Portiq/${ctx.appVersion || "dev"}`;
  }
  if (!hasHeader(headers, "accept")) headers["Accept"] = "*/*";
  const carriesBody =
    !METHODS_WITHOUT_BODY.has(ctx.method) &&
    !ctx.hasMultipart &&
    typeof ctx.body === "string" &&
    ctx.body.length > 0;
  if (carriesBody && !hasHeader(headers, "content-length")) {
    headers["Content-Length"] = String(Buffer.byteLength(ctx.body as string));
  }
  return headers;
}
