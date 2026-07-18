import type { Tone } from "./tone";

const REASON: Record<number, string> = {
  200: "OK", 201: "Created", 202: "Accepted", 204: "No Content",
  301: "Moved Permanently", 302: "Found", 304: "Not Modified",
  400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
  409: "Conflict", 422: "Unprocessable", 429: "Too Many Requests",
  500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable",
};

export function statusMeta(status: number | "error" | "pending" | null): { label: string; tone: Tone } {
  if (status === null) return { label: "—", tone: "muted" };
  if (status === "pending") return { label: "…", tone: "muted" };
  if (status === "error") return { label: "Error", tone: "error" };
  const reason = REASON[status];
  const label = reason ? `${status} ${reason}` : String(status);
  let tone: Tone = "muted";
  if (status >= 200 && status < 300) tone = "success";
  else if (status >= 300 && status < 400) tone = "info";
  else if (status >= 400 && status < 500) tone = "warn";
  else if (status >= 500) tone = "error";
  return { label, tone };
}
