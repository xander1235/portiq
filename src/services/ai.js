export async function generateRequestFromPrompt(prompt) {
  const lower = prompt.toLowerCase();
  const method = lower.includes("create") || lower.includes("post") ? "POST" : "GET";
  const urlMatch = prompt.match(/https?:\/\/[^\s]+/i);
  const url = urlMatch ? urlMatch[0] : "https://api.example.com/users";
  const headers = {
    "Content-Type": "application/json"
  };
  const body = method === "POST" ? JSON.stringify({ name: "Ada", email: "ada@example.com" }, null, 2) : "";

  return {
    method,
    url,
    headers,
    body,
    notes: [
      "Added Content-Type header",
      "Detected POST/GET intent from prompt"
    ]
  };
}

export async function generateTestsFromResponse(request, response) {
  const status = response?.status || 200;
  return [
    `pm.test("status is ${status}", () => pm.response.to.have.status(${status}));`,
    "pm.test(" + JSON.stringify("response has body") + ", () => pm.response.text().length > 0);"
  ];
}

export async function summarizeResponse(response) {
  if (!response) {
    return { summary: "No response yet.", hints: [] };
  }
  if (response.error) {
    return { summary: "Request failed.", hints: [response.error] };
  }
  const summary = `Status ${response.status} ${response.statusText}.`;
  const hints = [];
  if (response.status >= 400) {
    hints.push("Check auth headers and required fields.");
  }
  if (response.json && Array.isArray(response.json.data)) {
    hints.push(`Returned ${response.json.data.length} rows.`);
  }
  return { summary, hints };
}
