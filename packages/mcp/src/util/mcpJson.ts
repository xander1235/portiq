export function jsonToolResult(data: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function errorToolResult(message: string): { content: [{ type: "text"; text: string }]; isError: true } {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function jsonResource(
  uri: URL,
  data: unknown
): { contents: [{ uri: string; mimeType: string; text: string }] } {
  return {
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
  };
}
