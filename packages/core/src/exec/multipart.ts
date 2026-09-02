export type MultipartPart =
  | { kind: "file"; name: string; filename?: string; contentType?: string; dataBase64?: string }
  | { kind: "text"; name: string; value?: string };

let boundaryCounter = 0;

export function buildMultipartBody(
  parts: MultipartPart[],
  opts: { boundarySeed?: string } = {}
): { boundary: string; body: Buffer } {
  const seed = opts.boundarySeed ?? (++boundaryCounter).toString(16);
  const boundary = `----PortiqBoundary${seed}`;
  const buffers: Buffer[] = [];
  for (const part of parts || []) {
    if (!part?.name) continue;
    if (part.kind === "file") {
      const fileBuffer = Buffer.from(part.dataBase64 || "", "base64");
      buffers.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.filename || "upload.bin"}"\r\n` +
        `Content-Type: ${part.contentType || "application/octet-stream"}\r\n\r\n`
      ));
      buffers.push(fileBuffer);
      buffers.push(Buffer.from("\r\n"));
      continue;
    }
    buffers.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value || ""}\r\n`
    ));
  }
  buffers.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(buffers) };
}
