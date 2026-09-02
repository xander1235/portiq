export interface HttpResult {
  status: number;
  statusText: string;
  time: number;
  duration: number;
  headers: Record<string, string>;
  body: string;
  json: any;
  httpVersion: string;
}

export function buildHttpResult(input: {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  duration: number;
  httpVersion: string;
}): HttpResult {
  let json: any;
  try {
    json = JSON.parse(input.body);
  } catch {
    json = null;
  }

  return {
    status: input.status,
    statusText: input.statusText,
    time: input.duration,
    duration: input.duration,
    headers: input.headers,
    body: input.body,
    json,
    httpVersion: input.httpVersion,
  };
}

export function buildAbortResult(
  reason: string
): { cancelled: true; error: string } | { timedOut: true; error: string } | null {
  if (reason === "cancelled") {
    return { cancelled: true, error: "Request cancelled" };
  }
  if (reason === "timeout") {
    return { timedOut: true, error: "Request timeout" };
  }
  return null;
}
