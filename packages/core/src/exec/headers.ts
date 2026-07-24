export interface HeaderRow {
    key: string;
    value: string;
    comment?: string;
    enabled?: boolean;
}

/** Maps a body type to the Content-Type value the client manages for it. */
export const BODY_CONTENT_TYPES: Record<string, string> = {
    json: "application/json",
    xml: "application/xml",
    form: "application/x-www-form-urlencoded",
    multipart: "multipart/form-data",
    raw: "text/plain",
};

const isContentTypeRow = (row: HeaderRow): boolean =>
    (row.key || "").trim().toLowerCase() === "content-type";

/**
 * Returns the header rows with the Content-Type header reconciled for the
 * selected body type:
 *   - bodyType "none"  → the auto-managed Content-Type row is removed.
 *   - known body type  → an existing Content-Type row is updated (and enabled),
 *                        or a new one is appended if none exists.
 *   - unknown type     → rows are returned unchanged.
 */
export function applyBodyContentType<T extends HeaderRow>(rows: T[], bodyType: string): T[] {
    const source = rows || [];

    if (bodyType === "none") {
        return source.filter((row) => !isContentTypeRow(row));
    }

    const contentType = BODY_CONTENT_TYPES[bodyType];
    if (!contentType) return source;

    let found = false;
    const next = source.map((row) => {
        if (isContentTypeRow(row)) {
            found = true;
            return { ...row, value: contentType, enabled: true, comment: row.comment || "" };
        }
        return row;
    });

    if (!found) {
        next.push({ key: "Content-Type", value: contentType, enabled: true, comment: "" } as T);
    }

    return next;
}

export const MAX_HEADER_COUNT = 100;
export const MAX_KEY_LENGTH = 1024;
export const MAX_VALUE_LENGTH = 10 * 1024 * 1024;

export function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

export function validateHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== "object") return {};
  const src = headers as Record<string, unknown>;
  const keys = Object.keys(src);
  if (keys.length > MAX_HEADER_COUNT) throw new Error(`Too many headers (max ${MAX_HEADER_COUNT})`);
  const sanitized: Record<string, string> = {};
  for (const key of keys) {
    if (key.length > MAX_KEY_LENGTH) throw new Error(`Header key exceeds maximum length of ${MAX_KEY_LENGTH}`);
    const val = src[key];
    if (typeof val === "string" && val.length > MAX_VALUE_LENGTH) {
      throw new Error(`Header value for "${key}" exceeds maximum length of ${MAX_VALUE_LENGTH}`);
    }
    sanitized[key] = String(val);
  }
  return sanitized;
}
