export interface HostPolicy {
  check(url: string): { allowed: boolean; reason?: string };
}

interface HostPattern {
  /** Bare host, or the suffix ".example.com" when `wildcard` is true. */
  host: string;
  port?: string;
  wildcard: boolean;
}

function parsePattern(raw: string): HostPattern | null {
  const p = raw.trim().toLowerCase();
  if (!p) return null;
  let host = p;
  let port: string | undefined;
  const colon = p.lastIndexOf(":");
  if (colon !== -1 && /^\d+$/.test(p.slice(colon + 1))) {
    host = p.slice(0, colon);
    port = p.slice(colon + 1);
  }
  const wildcard = host.startsWith("*.");
  return { host: wildcard ? host.slice(1) : host, port, wildcard }; // wildcard host stored as ".example.com"
}

function hostFromUrl(url: string): { host: string; port: string } | null {
  try {
    const u = new URL(url);
    return { host: u.hostname.toLowerCase(), port: u.port };
  } catch {
    return null;
  }
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
  const allowPatterns = allow.map(parsePattern).filter((p): p is HostPattern => p !== null);
  const denyPatterns = deny.map(parsePattern).filter((p): p is HostPattern => p !== null);

  return {
    check(url: string) {
      const parsed = hostFromUrl(url);
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
