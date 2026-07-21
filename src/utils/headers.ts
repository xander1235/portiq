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
