// Host allow/deny-list policy for headless request execution (MCP exec tools
// and the CLI). Deny always wins over allow. Shared by both consumers so the
// behavior is identical everywhere.

export interface HostPolicy {
  check(url: string): { allowed: boolean; reason?: string };
}

export interface HostPolicyOptions {
  allow?: string[];
  deny?: string[];
}

interface HostPattern {
  /** Bare host, or the suffix ".example.com" when `wildcard` is true. */
  host: string;
  port?: string;
  wildcard: boolean;
}

const DEFAULT_PORTS: Record<string, string> = {
  "http:": "80",
  "https:": "443",
  "ws:": "80",
  "wss:": "443",
  "grpc:": "80",
  "grpcs:": "443",
};

interface ParsedTarget {
  host: string;
  /** Effective port: the explicit port, or the scheme's default when omitted. */
  port: string;
}

/**
 * Parse a target URL (or a bare `host[:port]` / `[::1]:port` gRPC-style target)
 * into hostname + effective port. Returns null when the target cannot be parsed
 * at all (a scheme-less malformed string like "foo:bar").
 */
export function parseHostTarget(url: string): ParsedTarget | null {
  const trimmed = (url || "").trim();
  if (!trimmed) return null;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const scheme = u.protocol; // includes the trailing ':'
      const port = u.port || DEFAULT_PORTS[scheme] || "";
      const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, ""); // URL keeps IPv6 brackets
      return { host, port };
    } catch {
      return null;
    }
  }

  // Bare target (no scheme) — the gRPC convention ("localhost:50051").
  const rest = trimmed;
  if (rest.startsWith("[")) {
    const close = rest.indexOf("]");
    if (close === -1) return null;
    const host = rest.slice(1, close).toLowerCase();
    const after = rest.slice(close + 1);
    if (!after) return { host, port: "" };
    if (after.startsWith(":")) return { host, port: after.slice(1) };
    return null;
  }
  const colon = rest.lastIndexOf(":");
  let host = rest;
  let port = "";
  if (colon !== -1) {
    if (!/^\d+$/.test(rest.slice(colon + 1))) return null; // "host:notaport" is not a valid target
    host = rest.slice(0, colon);
    port = rest.slice(colon + 1);
  }
  return { host: host.toLowerCase(), port };
}

function parsePattern(raw: string): HostPattern | null {
  const p = (raw || "").trim().toLowerCase();
  if (!p) return null;
  let host = p;
  let port: string | undefined;
  if (p.startsWith("[")) {
    // IPv6 literal: "[::1]" or "[::1]:50051"
    const close = p.indexOf("]");
    if (close === -1) return null;
    host = p.slice(0, close + 1);
    const after = p.slice(close + 1);
    if (after.startsWith(":")) port = after.slice(1);
    const wildcard = false;
    return { host: host.slice(1, -1), port, wildcard }; // store without brackets to match parseHostTarget
  }
  const colon = p.lastIndexOf(":");
  if (colon !== -1 && /^\d+$/.test(p.slice(colon + 1))) {
    host = p.slice(0, colon);
    port = p.slice(colon + 1);
  }
  const wildcard = host === "*" || host.startsWith("*.");
  if (host === "*") return { host: "", port, wildcard }; // bare "*" matches any host
  return { host: wildcard ? host.slice(1) : host, port, wildcard }; // wildcard host stored as ".example.com"
}

function matches(pat: HostPattern, host: string, port: string): boolean {
  if (pat.port !== undefined && pat.port !== port) return false;
  if (pat.wildcard) {
    // pat.host is ".example.com" → matches the bare host and any subdomain.
    return host === pat.host.slice(1) || host.endsWith(pat.host);
  }
  return host === pat.host;
}

export function compileHostPolicy(allow: string[], deny: string[]): HostPolicy {
  const allowPatterns = (allow ?? []).map(parsePattern).filter((p): p is HostPattern => p !== null);
  const denyPatterns = (deny ?? []).map(parsePattern).filter((p): p is HostPattern => p !== null);

  return {
    check(url: string) {
      const parsed = parseHostTarget(url);
      if (!parsed) {
        if (allowPatterns.length > 0) {
          return { allowed: false, reason: `Cannot determine host of '${url}' (exec allow-list active)` };
        }
        return { allowed: true };
      }
      const { host, port } = parsed;
      for (const pat of denyPatterns) {
        if (matches(pat, host, port)) {
          return { allowed: false, reason: `Host '${host}' is blocked by the exec deny-list` };
        }
      }
      if (allowPatterns.length === 0) return { allowed: true };
      for (const pat of allowPatterns) {
        if (matches(pat, host, port)) return { allowed: true };
      }
      return { allowed: false, reason: `Host '${host}' is not in the exec allow-list` };
    },
  };
}

export function makeHostGuard(policy: HostPolicy): (url: string) => void {
  return (url: string) => {
    const result = policy.check(url);
    if (!result.allowed) throw new Error(result.reason ?? `Host for '${url}' is not permitted`);
  };
}

/** Split a comma-separated env var into a trimmed host list. */
export function splitHostList(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
