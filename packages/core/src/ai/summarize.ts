export interface ResponseSummary {
  summary: string;
  hints: string[];
}

export function summarizeResponse(response: any): ResponseSummary {
  if (!response) {
    return { summary: "No response yet.", hints: [] };
  }
  if (response.error) {
    return { summary: "Request failed.", hints: [response.error] };
  }
  const summary = `Status ${response.status} ${response.statusText}.`;
  const hints: string[] = [];
  if (response.status >= 400) {
    hints.push("Check auth headers and required fields.");
  }
  if (response.json && Array.isArray(response.json.data)) {
    hints.push(`Returned ${response.json.data.length} rows.`);
  }
  return { summary, hints };
}
