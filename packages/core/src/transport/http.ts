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
  return errorMsg;
}

export class HttpTransport {
  private pending = new Map<string, { cancel: () => void }>();
  private appVersion: string;

  constructor(opts: { appVersion?: string } = {}) {
    this.appVersion = opts.appVersion ?? "";
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
      const response = await fetch(url, {
        method,
        headers,
        body: METHODS_WITHOUT_BODY.has(method) ? undefined : (body as any),
        signal: controller.signal,
      });

      const text = await response.text();
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

      const finish = (result: SendResult) => {
        if (settled) return;
        settled = true;
        if (requestId) this.pending.delete(requestId);
        resolve(result);
      };

      const req = client.request(requestOptions, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
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
        finish({ error: err.message || String(err) });
      });

      if (timeoutMs > 0) {
        req.setTimeout(timeoutMs, () => {
          abortReason = "timeout";
          req.destroy(new Error("Request timeout"));
        });
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

      stream.on("response", (headersMap) => {
        responseStatus = Number(headersMap[":status"] || 0);
        Object.entries(headersMap).forEach(([key, value]) => {
          if (!key.startsWith(":")) {
            responseHeaders[key] = Array.isArray(value) ? value.join(", ") : String(value ?? "");
          }
        });
      });

      stream.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
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
        finish({ error: err.message || String(err) });
      });

      session.on("error", (err: any) => {
        const aborted = buildAbortResult(abortReason || "");
        if (aborted) {
          finish(aborted);
          return;
        }
        finish({ error: err.message || String(err) });
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
