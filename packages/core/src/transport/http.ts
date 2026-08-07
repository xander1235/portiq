import * as http from "node:http";
import * as https from "node:https";
import * as http2 from "node:http2";
import { validateHeaders } from "../exec/headers";
import { applyAutoHeaders } from "../exec/autoHeaders";
import { buildHttpResult, buildAbortResult, type HttpResult } from "./httpResult";
import { buildMultipartBody, type MultipartPart } from "../exec/multipart";

const ALLOWED_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const MAX_URL_LENGTH = 8192;
const MAX_BODY_LENGTH = 50 * 1024 * 1024; // 50 MB
const MAX_RESPONSE_BODY_LENGTH = 50 * 1024 * 1024; // 50 MB
const MAX_REDIRECTS = 10;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);

export interface HttpSendPayload {
  requestId?: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  httpVersion?: "auto" | "1.1" | "2";
  multipartParts?: MultipartPart[];
}

type SendResult =
  | HttpResult
  | { error: string }
  | { cancelled: true; error: string }
  | { timedOut: true; error: string };

interface DispatchPayload {
  requestId?: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | Buffer;
  timeoutMs: number;
}

function validateString(val: unknown, maxLen: number, label: string): void {
  if (val !== undefined && val !== null && typeof val !== "string") {
    throw new Error(`${label} must be a string`);
  }
  if (typeof val === "string" && val.length > maxLen) {
    throw new Error(`${label} exceeds maximum length of ${maxLen}`);
  }
}

/** Strip credentials and secret query/hash fragments from any URL in an error
 *  message so failed requests never leak tokens into MCP/CLI output. */
export function scrubUrls(input: string): string {
  if (!input) return input;
  return input.replace(/https?:\/\/[^\s"'`<>)]+/gi, (url) => {
    try {
      const u = new URL(url);
      if (u.username || u.password || u.search || u.hash) {
        u.username = "";
        u.password = "";
        u.search = "";
        u.hash = "";
        return u.toString();
      }
      return url;
    } catch {
      return url;
    }
  });
}

function formatErrorMessage(err: any): string {
  let errorMsg = err?.message || String(err);
  if (err?.name === "AggregateError" && err.errors) {
    errorMsg += `: ${err.errors.map((e: any) => e.message || String(e)).join(", ")}`;
  } else if (err?.cause) {
    if (err.cause.name === "AggregateError" && err.cause.errors) {
      errorMsg += `: ${err.cause.errors.map((e: any) => e.message || String(e)).join(", ")}`;
    } else {
      errorMsg += `: ${err.cause.message || String(err.cause)}`;
    }
  }
  return scrubUrls(errorMsg);
}

/** Size-capped response body reader. Throws when the body exceeds `maxBytes`. */
export async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Response body exceeds maximum size of ${maxBytes} bytes`);
  }
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`Response body exceeds maximum size of ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

export class HttpTransport {
  private pending = new Map<string, { cancel: () => void }>();
  private appVersion: string;
  private hostGuard?: (url: string) => void;

  constructor(opts: { appVersion?: string; hostGuard?: (url: string) => void } = {}) {
    this.appVersion = opts.appVersion ?? "";
    this.hostGuard = opts.hostGuard;
  }

  private guardUrl(url: string): void {
    if (!this.hostGuard) return;
    try {
      this.hostGuard(url);
    } catch (err: any) {
      throw new Error(err?.message || String(err));
    }
  }

  async send(payload: HttpSendPayload): Promise<SendResult> {
    const { requestId, method, url, headers, body, timeoutMs, httpVersion, multipartParts } = payload || ({} as HttpSendPayload);

    // ── Validate inputs ──
    if (!url || typeof url !== "string") {
      return { error: "Missing or invalid URL" };
    }
    if (url.length > MAX_URL_LENGTH) {
      return { error: `URL exceeds maximum length of ${MAX_URL_LENGTH}` };
    }
    const upperMethod = (method || "GET").toUpperCase();
    if (!ALLOWED_METHODS.includes(upperMethod)) {
      return { error: `Invalid HTTP method: ${method}` };
    }
    let sanitizedHeaders: Record<string, string>;
    try {
      sanitizedHeaders = validateHeaders(headers);
    } catch (err: any) {
      return { error: err.message };
    }
    if (body !== undefined && body !== null) {
      try {
        validateString(body, MAX_BODY_LENGTH, "Request body");
      } catch (err: any) {
        return { error: err.message };
      }
    }
    if (multipartParts !== undefined && !Array.isArray(multipartParts)) {
      return { error: "Multipart parts must be an array" };
    }

    try {
      this.guardUrl(url);
      const normalizedTimeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : 30000;
      const normalizedVersion = httpVersion || "auto";
      let requestBody: string | Buffer | undefined = body;
      const hasMultipart = Array.isArray(multipartParts) && multipartParts.length > 0;
      if (hasMultipart) {
        const multipart = buildMultipartBody(multipartParts as MultipartPart[]);
        sanitizedHeaders["Content-Type"] = `multipart/form-data; boundary=${multipart.boundary}`;
        sanitizedHeaders["Content-Length"] = String(multipart.body.length);
        requestBody = multipart.body;
      }

      applyAutoHeaders(sanitizedHeaders, {
        method: upperMethod,
        body: typeof requestBody === "string" ? requestBody : undefined,
        hasMultipart,
        appVersion: this.appVersion,
      });

      if (normalizedVersion === "1.1") {
        return await this.sendHttp1({
          requestId,
          method: upperMethod,
          url,
          headers: sanitizedHeaders,
          body: requestBody,
          timeoutMs: normalizedTimeout,
        });
      }

      if (normalizedVersion === "2") {
        return await this.sendHttp2({
          requestId,
          method: upperMethod,
          url,
          headers: sanitizedHeaders,
          body: requestBody,
          timeoutMs: normalizedTimeout,
        });
      }

      return await this.sendAuto({
        requestId,
        method: upperMethod,
        url,
        headers: sanitizedHeaders,
        body: requestBody,
        timeoutMs: normalizedTimeout,
      });
    } catch (err: any) {
      return { error: formatErrorMessage(err) };
    }
  }

  cancel(requestId: string): { ok: true } | { error: string } {
    if (!requestId) return { error: "Missing request ID" };
    const p = this.pending.get(requestId);
    p?.cancel();
    return { ok: true };
  }

  private async sendAuto(p: DispatchPayload): Promise<SendResult> {
    const { requestId, method, url, headers, body, timeoutMs } = p;
    const startedAt = Date.now();
    const controller = new AbortController();
    let abortReason: string | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    if (requestId) {
      this.pending.set(requestId, {
        cancel: () => {
          abortReason = "cancelled";
          controller.abort();
        },
      });
    }

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        abortReason = "timeout";
        controller.abort();
      }, timeoutMs);
    }

    try {
      let currentUrl = url;
      let currentMethod = method;
      let currentBody = body;

      for (let hops = 0; ; hops++) {
        const response = await fetch(currentUrl, {
          method: currentMethod,
          headers,
          body: METHODS_WITHOUT_BODY.has(currentMethod) ? undefined : (currentBody as any),
          signal: controller.signal,
          redirect: "manual",
        });

        const location = response.headers.get("location");
        if (REDIRECT_STATUSES.has(response.status) && location !== null) {
          if (hops >= MAX_REDIRECTS) {
            await response.body?.cancel().catch(() => {});
            return { error: `Too many redirects (max ${MAX_REDIRECTS})` };
          }
          const nextUrl = new URL(location, currentUrl).toString();
          this.guardUrl(nextUrl); // re-check every hop against the host policy
          await response.body?.cancel().catch(() => {});
          // 301/302/303 switch to GET and drop the body (except GET/HEAD on 301/302);
          // 307/308 preserve method + body.
          if (response.status === 303 || (response.status !== 307 && response.status !== 308 && !METHODS_WITHOUT_BODY.has(currentMethod))) {
            currentMethod = "GET";
            currentBody = undefined;
          }
          currentUrl = nextUrl;
          continue;
        }

        const text = await readResponseText(response, MAX_RESPONSE_BODY_LENGTH);
        const duration = Date.now() - startedAt;
        const headersObj: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headersObj[key] = value;
        });

        return buildHttpResult({
          status: response.status,
          statusText: response.statusText,
          headers: headersObj,
          body: text,
          duration,
          httpVersion: "auto",
        });
      }
    } catch (err: any) {
      const aborted = buildAbortResult(abortReason || "");
      if (aborted) return aborted;
      return { error: formatErrorMessage(err) };
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (requestId) this.pending.delete(requestId);
    }
  }

  private sendHttp1(p: DispatchPayload): Promise<SendResult> {
    const { requestId, method, url, headers, body, timeoutMs } = p;
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === "https:" ? https : http;
      const requestOptions = {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || undefined,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method,
        headers,
      };

      let settled = false;
      let abortReason: string | null = null;
      let deadlineHandle: ReturnType<typeof setTimeout> | null = null;

      const finish = (result: SendResult) => {
        if (settled) return;
        settled = true;
        if (deadlineHandle) clearTimeout(deadlineHandle);
        if (requestId) this.pending.delete(requestId);
        resolve(result);
      };

      const req = client.request(requestOptions, (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk) => {
          if (settled) return;
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buf.length;
          if (total > MAX_RESPONSE_BODY_LENGTH) {
            req.destroy(new Error(`Response body exceeds maximum size of ${MAX_RESPONSE_BODY_LENGTH} bytes`));
            return;
          }
          chunks.push(buf);
        });
        res.on("end", () => {
          const bodyText = Buffer.concat(chunks).toString("utf8");
          const headersObj: Record<string, string> = Object.fromEntries(
            Object.entries(res.headers).map(([key, value]) => [
              key,
              Array.isArray(value) ? value.join(", ") : String(value ?? ""),
            ])
          );
          finish(
            buildHttpResult({
              status: res.statusCode || 0,
              statusText: res.statusMessage || http.STATUS_CODES[res.statusCode || 0] || "",
              headers: headersObj,
              body: bodyText,
              duration: Date.now() - startedAt,
              httpVersion: `HTTP/${res.httpVersion || "1.1"}`,
            })
          );
        });
      });

      req.on("error", (err: any) => {
        const aborted = buildAbortResult(abortReason || "");
        if (aborted) {
          finish(aborted);
          return;
        }
        finish({ error: scrubUrls(err.message || String(err)) });
      });

      if (timeoutMs > 0) {
        deadlineHandle = setTimeout(() => {
          abortReason = "timeout";
          req.destroy(new Error("Request timeout"));
        }, timeoutMs);
      }

      if (requestId) {
        this.pending.set(requestId, {
          cancel: () => {
            abortReason = "cancelled";
            req.destroy(new Error("Request cancelled"));
          },
        });
      }

      if (!METHODS_WITHOUT_BODY.has(method) && body !== undefined && body !== null) {
        req.write(body);
      }
      req.end();
    });
  }

  private sendHttp2(p: DispatchPayload): Promise<SendResult> {
    const { requestId, method, url, headers, body, timeoutMs } = p;
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const parsedUrl = new URL(url);
      const session = http2.connect(parsedUrl.origin);
      let settled = false;
      let abortReason: string | null = null;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

      const finish = (result: SendResult) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (requestId) this.pending.delete(requestId);
        try {
          session.close();
        } catch {
          /* ignore */
        }
        resolve(result);
      };

      const disallowedHeaders = new Set([
        "connection",
        "host",
        "keep-alive",
        "proxy-connection",
        "transfer-encoding",
        "upgrade",
      ]);
      const requestHeaders: Record<string, string> = {
        ":method": method,
        ":path": `${parsedUrl.pathname}${parsedUrl.search}`,
        ":scheme": parsedUrl.protocol.replace(":", ""),
        ":authority": parsedUrl.host,
      };

      Object.entries(headers || {}).forEach(([key, value]) => {
        const normalizedKey = String(key).toLowerCase();
        if (!disallowedHeaders.has(normalizedKey)) {
          requestHeaders[normalizedKey] = String(value);
        }
      });

      const stream = session.request(requestHeaders);

      const responseHeaders: Record<string, string> = {};
      let responseStatus = 0;
      const chunks: Buffer[] = [];
      let total = 0;

      stream.on("response", (headersMap) => {
        responseStatus = Number(headersMap[":status"] || 0);
        Object.entries(headersMap).forEach(([key, value]) => {
          if (!key.startsWith(":")) {
            responseHeaders[key] = Array.isArray(value) ? value.join(", ") : String(value ?? "");
          }
        });
      });

      stream.on("data", (chunk) => {
        if (settled) return;
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;
        if (total > MAX_RESPONSE_BODY_LENGTH) {
          try {
            stream.close();
          } catch {
            /* ignore */
          }
          finish({ error: `Response body exceeds maximum size of ${MAX_RESPONSE_BODY_LENGTH} bytes` });
          return;
        }
        chunks.push(buf);
      });

      stream.on("end", () => {
        finish(
          buildHttpResult({
            status: responseStatus,
            statusText: http.STATUS_CODES[responseStatus] || "",
            headers: responseHeaders,
            body: Buffer.concat(chunks).toString("utf8"),
            duration: Date.now() - startedAt,
            httpVersion: "HTTP/2",
          })
        );
      });

      stream.on("error", (err: any) => {
        const aborted = buildAbortResult(abortReason || "");
        if (aborted) {
          finish(aborted);
          return;
        }
        finish({ error: scrubUrls(err.message || String(err)) });
      });

      session.on("error", (err: any) => {
        const aborted = buildAbortResult(abortReason || "");
        if (aborted) {
          finish(aborted);
          return;
        }
        finish({ error: scrubUrls(err.message || String(err)) });
      });

      if (timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          abortReason = "timeout";
          try {
            stream.close();
          } catch {
            /* ignore */
          }
          finish(buildAbortResult("timeout") as SendResult);
        }, timeoutMs);
      }

      if (requestId) {
        this.pending.set(requestId, {
          cancel: () => {
            abortReason = "cancelled";
            try {
              stream.close();
            } catch {
              /* ignore */
            }
            finish(buildAbortResult("cancelled") as SendResult);
          },
        });
      }

      if (!METHODS_WITHOUT_BODY.has(method) && body !== undefined && body !== null) {
        stream.end(body);
      } else {
        stream.end();
      }
    });
  }
}
