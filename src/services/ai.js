import { searchRequestsContext } from "../utils/fuzzySearch";

// Helper to fetch available models for the selected provider
export async function fetchModels(provider, apiKey) {
  if (!apiKey) return [];

  try {
    if (provider === "openai") {
      const res = await fetch("/proxy-openai/v1/models", {
        headers: { "Authorization": `Bearer ${apiKey}` }
      });
      if (!res.ok) throw new Error("Failed to fetch OpenAI models");
      const data = await res.json();
      return data.data
        .filter(m => m.id.includes("gpt"))
        .map(m => m.id)
        .sort((a, b) => b.localeCompare(a));
    }

    if (provider === "anthropic") {
      const res = await fetch("/proxy-anthropic/v1/models", {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        }
      });
      if (!res.ok) throw new Error("Failed to fetch Anthropic models");
      const data = await res.json();
      return data.data
        .map(m => m.id)
        .sort((a, b) => b.localeCompare(a));
    }

    if (provider === "gemini") {
      const res = await fetch(`/proxy-gemini/v1beta/models?key=${apiKey}`);
      if (!res.ok) throw new Error("Failed to fetch Gemini models");
      const data = await res.json();
      return data.models
        .filter(m => m.supportedGenerationMethods.includes("generateContent"))
        .map(m => m.name.replace("models/", ""))
        .sort((a, b) => b.localeCompare(a));
    }
  } catch (error) {
    console.warn(`Could not fetch models for ${provider}:`, error);
  }

  return [];
}
// Trims markdown formatting like ```json ... ``` blocks from LLM strings
function parseLLMJson(text) {
  let cleanText = text.trim();
  if (cleanText.startsWith("```json")) {
    cleanText = cleanText.substring(7);
  } else if (cleanText.startsWith("```")) {
    cleanText = cleanText.substring(3);
  }
  if (cleanText.endsWith("```")) {
    cleanText = cleanText.substring(0, cleanText.length - 3);
  }
  return JSON.parse(cleanText.trim());
}

// Helper to call different LLM providers
async function callLLM(provider, model, apiKey, systemPrompt, userMessage, format = "json") {
  if (!apiKey) {
    throw new Error(`API Key for ${provider} is missing. Please configure it in Settings.`);
  }

  if (provider === "openai") {
    const body = {
      model: model || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ]
    };
    if (format === "json") {
      body.response_format = { type: "json_object" };
    }

    // Using Vite proxy to avoid CORS
    const res = await fetch("/proxy-openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`OpenAI Error: ${await res.text()}`);
    const data = await res.json();
    const textResult = data.choices[0].message.content;
    const usage = data.usage ? { input: data.usage.prompt_tokens, output: data.usage.completion_tokens } : null;
    return { result: format === "json" ? parseLLMJson(textResult) : textResult, usage, model: body.model };
  }

  if (provider === "anthropic") {
    // Normalize model name for Anthropic if user enters the shorthand
    let anthropicModel = model || "claude-3-5-sonnet-latest";
    if (anthropicModel === "claude-3-5-sonnet" || anthropicModel === "claude-3-5-sonnet-20240620") {
      anthropicModel = "claude-3-5-sonnet-latest";
    }

    // Using Vite proxy to avoid CORS
    const res = await fetch("/proxy-anthropic/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: anthropicModel,
        system: systemPrompt,
        messages: [
          { role: "user", content: userMessage }
        ],
        max_tokens: 2000
      })
    });
    if (!res.ok) throw new Error(`Anthropic Error: ${await res.text()}`);
    const data = await res.json();
    const textResult = data.content[0].text;
    const usage = data.usage ? { input: data.usage.input_tokens, output: data.usage.output_tokens } : null;
    return { result: format === "json" ? parseLLMJson(textResult) : textResult, usage, model: anthropicModel };
  }

  if (provider === "gemini") {
    const geminiModel = model || "gemini-1.5-flash";
    // Using Vite proxy to avoid CORS
    const res = await fetch(`/proxy-gemini/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          { role: "user", parts: [{ text: userMessage }] }
        ],
        generationConfig: {
          responseMimeType: format === "json" ? "application/json" : "text/plain"
        }
      })
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const textResult = data.candidates[0].content.parts[0].text;
    const usage = data.usageMetadata ? { input: data.usageMetadata.promptTokenCount, output: data.usageMetadata.candidatesTokenCount } : null;
    return { result: format === "json" ? parseLLMJson(textResult) : textResult, usage, model: geminiModel };
  }

  throw new Error("Unknown AI Provider");
}

export async function generateRequestFromPrompt(prompt, currentState, collections, aiSettings, chatHistory = [], responseData = null) {
  const { provider, model, keys, semanticSearchEnabled } = aiSettings;
  const apiKey = keys[provider];

  let relevantRequests = searchRequestsContext(prompt, collections);

  if (semanticSearchEnabled) {
    try {
      const { SemanticSearch } = await import('../utils/semanticSearch');
      const semanticResults = await SemanticSearch.search(prompt);
      if (semanticResults && semanticResults.length > 0) {
        const { flattenCollections } = await import('../utils/fuzzySearch');
        const flatReqs = flattenCollections(collections);
        const semanticReqObjects = [];
        semanticResults.forEach(sr => {
          const found = flatReqs.find(r => r.id === sr.id);
          if (found) semanticReqObjects.push(found);
        });
        const combined = [...semanticReqObjects, ...relevantRequests];
        relevantRequests = combined.filter((v, i, a) => a.findIndex(v2 => (v2.id === v.id)) === i).slice(0, 10);
      }
    } catch (err) {
      console.error("Semantic search error via AI service", err);
    }
  }

  let historyText = "No previous conversation";
  if (chatHistory.length > 6) {
    const olderMessages = chatHistory.slice(0, chatHistory.length - 2);
    const recentMessages = chatHistory.slice(-2);
    const summarySystem = "You are a highly concise assistant. Summarize the following log into a brief 2-sentence paragraph exploring the core objectives and findings. Output only the summary.";
    const summaryUser = olderMessages.map(msg => `${msg.role === 'assistant' ? 'Assistant' : 'User'}: ${msg.text}`).join('\n');
    try {
      const summaryResponse = await callLLM(provider, model, apiKey, summarySystem, summaryUser, "text");
      const summaryText = typeof summaryResponse === 'object' ? summaryResponse.result : summaryResponse;
      historyText = `[Conversation Summary: ${String(summaryText).trim()}]\n\n` + recentMessages.map(msg => `${msg.role === 'assistant' ? 'Assistant' : 'User'}: ${msg.text}`).join('\n');
    } catch (e) {
      console.warn("Summarization failed, falling back to simple truncation", e);
      historyText = chatHistory.slice(-4).map(msg => `${msg.role === 'assistant' ? 'Assistant' : 'User'}: ${msg.text}`).join('\n');
    }
  } else if (chatHistory.length > 0) {
    historyText = chatHistory.map(msg => `${msg.role === 'assistant' ? 'Assistant' : 'User'}: ${msg.text}`).join('\n');
  }

  // Build response context if available
  let responseContext = "No response data available yet.";
  if (responseData) {
    const bodyPreview = responseData.body ? String(responseData.body).substring(0, 800) + (String(responseData.body).length > 800 ? "...[TRUNCATED]" : "") : "";
    responseContext = `Status: ${responseData.status || "N/A"} ${responseData.statusText || ""}\nHeaders: ${responseData.headers ? JSON.stringify(responseData.headers).substring(0, 300) : ""}\nBody: ${bodyPreview}`;
  }

  // Build collection structure context
  const collectionContext = collections.map(c => ({
    id: c.id,
    name: c.name,
    folders: (c.items || []).filter(i => i.type === "folder").map(f => ({ id: f.id, name: f.name })),
    requestCount: (c.items || []).filter(i => i.type === "request").length
  }));

  const systemPrompt = `
You are an advanced API Client AI Assistant. Your goal is to help the user configure, manage, and test API requests.
The workspace has collections containing folders and requests. The app supports multiple protocols: HTTP, GraphQL, gRPC, WebSocket, SSE, MCP, and DAG flows.

# Conversation History
${historyText}

# Current Active Request State
Protocol: ${currentState.protocol || "http"}
Method: ${currentState.method}
URL: ${currentState.url}
Headers: ${currentState.headersText ? currentState.headersText.substring(0, 500) : ""}
Body: ${currentState.bodyText ? currentState.bodyText.substring(0, 500) + (currentState.bodyText.length > 500 ? "...[TRUNCATED]" : "") : ""}

# Last Response
${responseContext}

# Workspace Collections
${JSON.stringify(collectionContext, null, 2)}

# Relevant Workspace Requests (Searched via keywords)
${JSON.stringify(relevantRequests.map(r => ({ id: r.id, name: r.name, method: r.method, url: r.url, protocol: r.protocol, description: r.description })), null, 2)}

# Objective
Analyze the user's prompt and decide what actions need to be taken.

## Rules
1. If the user asks to "find", "load", "open", "get" or "search for" an existing request, return a \`SUGGEST_ENDPOINTS\` operation with matching IDs. Do NOT use \`UPDATE_CURRENT_REQUEST\` for this.
2. If the user asks to MODIFY the CURRENT request, use \`UPDATE_CURRENT_REQUEST\`.
3. If the user asks to "send", "run", "execute" the request, include a \`SEND_REQUEST\` operation.
4. If the user asks to "generate tests", "write tests", or "create assertions" for the current request/response, include a \`GENERATE_TESTS\` operation with the test scripts in the payload.
5. If the user asks to "delete" or "remove" a request, use \`DELETE_REQUEST\` with the request ID.
6. If the user asks to "move" a request to a folder or collection, use \`MOVE_REQUEST\` with the request ID and target.
7. If the user asks about the response, analyzes errors, or wants to understand what happened, answer based on the "Last Response" context above.
8. Do NOT hallucinate endpoints. If nothing matches, apologize.
9. If the user asks to find/load a request, IGNORE any "Template: " prefix.

You must output STRICT JSON matching this schema:
{
  "message": "A friendly textual reply explaining what you did or observed",
  "operations": [
    {
      "type": "UPDATE_CURRENT_REQUEST" | "UPDATE_REQUEST_BY_ID" | "CREATE_REQUEST" | "SUGGEST_ENDPOINTS" | "SEND_REQUEST" | "GENERATE_TESTS" | "DELETE_REQUEST" | "MOVE_REQUEST",
      "payload": {
        // UPDATE_CURRENT_REQUEST: { "method", "url", "headersText", "bodyText" }
        // UPDATE_REQUEST_BY_ID: { "id", "updates": { ... } }
        // CREATE_REQUEST: { "collectionId"?, "newCollectionName"?, "name", "method", "url", "headersText", "bodyText" }
        // SUGGEST_ENDPOINTS: { "endpointIds": ["id1", "id2"] }
        // SEND_REQUEST: {} (empty)
        // GENERATE_TESTS: { "tests": ["pm.test('description', () => { ... });", ...] }
        // DELETE_REQUEST: { "requestId": "id" }
        // MOVE_REQUEST: { "requestId": "id", "targetCollectionId": "colId", "targetFolderId"?: "folderId" }
      }
    }
  ]
}

Return ONLY valid JSON. Your response must be parseable.
  `.trim();

  const response = await callLLM(provider, model, apiKey, systemPrompt, prompt);
  // Rehydrate SUGGEST_ENDPOINTS with full request objects
  if (response.result.operations) {
    response.result.operations.forEach(op => {
      if (op.type === "SUGGEST_ENDPOINTS" && op.payload && op.payload.endpointIds) {
        op.payload.endpoints = [];
        op.payload.endpointIds.forEach(id => {
          const found = relevantRequests.find(r => r.id === id);
          if (found) op.payload.endpoints.push(found);
        });
      }
    });
  }

  return { ...response.result, _usage: response.usage, _model: response.model };
}

export async function generateTestsFromResponse(request, response, aiSettings) {
  // If AI settings are provided, use LLM to generate intelligent tests
  if (aiSettings && aiSettings.keys && aiSettings.keys[aiSettings.provider]) {
    const { provider, model, keys } = aiSettings;
    const apiKey = keys[provider];

    const bodyPreview = response?.body ? String(response.body).substring(0, 1000) : "";
    const systemPrompt = `You are a test-writing assistant for an API client tool. Given the request and response details, generate a set of post-response test scripts using the pm.test() API.

Available API:
- pm.response.to.have.status(code) - assert status code
- pm.response.text() - get response body as text
- pm.response.json() - get response body as parsed JSON
- pm.response.headers - get response headers object

Generate 3-6 meaningful test assertions that cover:
1. Status code validation
2. Response body structure (check for expected keys/fields)
3. Data type validation (e.g., arrays, strings, numbers)
4. Any edge cases visible in the response

Return STRICT JSON: { "tests": ["pm.test('...', () => { ... });", ...] }`;

    const userMessage = `Request: ${request.method} ${request.url}\nResponse Status: ${response?.status || "N/A"}\nResponse Body: ${bodyPreview}`;

    try {
      const result = await callLLM(provider, model, apiKey, systemPrompt, userMessage);
      if (result.result && result.result.tests && Array.isArray(result.result.tests)) {
        return result.result.tests;
      }
    } catch (err) {
      console.warn("LLM test generation failed, falling back to defaults", err);
    }
  }

  // Fallback: generate basic tests without LLM
  const status = response?.status || 200;
  return [
    `pm.test("status is ${status}", () => pm.response.to.have.status(${status}));`,
    `pm.test("response has body", () => pm.response.text().length > 0);`
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
