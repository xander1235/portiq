export interface AutoHeader {
    key: string;
    value: string;
    /** Optional note shown alongside the value (e.g. why it is approximate). */
    note?: string;
}

export interface AutoHeaderInput {
    method: string;
    /** Fully-built request URL (with query params). */
    url: string;
    bodyType: string;
    /** Resolved body string for json/xml/raw/form bodies. */
    body?: string;
    /** Number of enabled multipart parts, when bodyType is "multipart". */
    multipartCount?: number;
    /** App version, used in the User-Agent value. */
    appVersion?: string;
    /** Lower-cased header names the user has set explicitly; these are skipped. */
    userHeaderKeys?: Set<string>;
}

/** UTF-8 byte length of a string (what Content-Length must report). */
export function byteLength(value: string): number {
    return new TextEncoder().encode(value).length;
}

const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);

/**
 * Computes the headers the client adds automatically ("hidden" headers) for the
 * given request, for display in the Headers tab. The set mirrors what the
 * Electron main process actually sends (see electron/main.cjs): Host,
 * User-Agent, Accept, Connection and — for requests with a body —
 * Content-Length. Accept-Encoding is intentionally omitted because responses
 * are not decompressed.
 *
 * Any header the user has set explicitly (case-insensitive) is omitted, since
 * the user's value takes precedence over the auto-generated one.
 */
export function computeAutoHeaders(input: AutoHeaderInput): AutoHeader[] {
    const { method, url, bodyType, body, multipartCount, appVersion, userHeaderKeys } = input;
    const headers: AutoHeader[] = [];

    try {
        const parsed = new URL(url);
        if (parsed.host) headers.push({ key: "Host", value: parsed.host });
    } catch {
        /* relative or invalid URL — Host cannot be determined yet */
    }

    headers.push({ key: "User-Agent", value: `Portiq/${appVersion || "dev"}` });
    headers.push({ key: "Accept", value: "*/*" });
    headers.push({ key: "Connection", value: "keep-alive" });

    const carriesBody = !METHODS_WITHOUT_BODY.has((method || "GET").toUpperCase()) && bodyType !== "none";
    if (carriesBody) {
        if (bodyType === "multipart") {
            if ((multipartCount || 0) > 0) {
                headers.push({ key: "Content-Length", value: "calculated on send", note: "depends on multipart boundary" });
            }
        } else if (typeof body === "string" && body.length > 0) {
            headers.push({ key: "Content-Length", value: String(byteLength(body)) });
        }
    }

    if (userHeaderKeys && userHeaderKeys.size > 0) {
        return headers.filter((header) => !userHeaderKeys.has(header.key.toLowerCase()));
    }
    return headers;
}
