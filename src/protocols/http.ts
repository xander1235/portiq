/**
 * HTTP Protocol Handler
 *
 * Standard REST/HTTP protocol - the default protocol for the app.
 * Supports all standard HTTP methods with headers, body, auth, and params.
 */

import { ProtocolHandler } from "./registry";

export const HttpProtocol: ProtocolHandler = {
  id: "http",
  name: "HTTP",
  description: "REST/HTTP requests",
  color: "#6366f1",
  icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>`,

  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],

  defaultConfig: {
    method: "GET",
    url: "",
    headers: {},
    body: "",
    bodyType: "json",
    params: [],
    auth: { type: "none" }
  },

  getDefaultUrl() {
    return "https://api.example.com";
  },

  detectProtocol(url: string) {
    if (!url) return false;
    const lower = url.toLowerCase().trim();
    return lower.startsWith("http://") || lower.startsWith("https://") || !lower.includes("://");
  },

  validateRequest(config: any) {
    const errors: string[] = [];
    if (!config.url || !config.url.trim()) {
      errors.push("URL is required");
    }
    if (config.method && !HttpProtocol.methods.includes(config.method.toUpperCase())) {
      errors.push(`Invalid HTTP method: ${config.method}`);
    }
    if (config.bodyType === "json" && config.body) {
      try {
        JSON.parse(config.body);
      } catch (e) {
        // May have comments, don't fail hard
      }
    }
    return { valid: errors.length === 0, errors };
  },

  buildRequest(config: any) {
    return {
      method: config.method || "GET",
      url: config.url,
      headers: config.headers || {},
      body: config.body || undefined
    };
  },

  parseResponse(raw: any) {
    return {
      status: raw.status,
      statusText: raw.statusText,
      duration: raw.duration,
      headers: raw.headers || {},
      body: raw.body || "",
      json: raw.json || null,
      error: raw.error || null,
      size: raw.body ? new Blob([raw.body]).size : 0
    };
  }
};

export default HttpProtocol;
