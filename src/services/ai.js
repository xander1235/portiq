import { searchRequestsContext, flattenCollections } from "../utils/fuzzySearch";
import { SemanticSearch } from "../utils/semanticSearch";

/**
 * Robust fetch wrapper that routes through Electron IPC for production (DMG) builds,
 * bypassing the need for Vite dev-server proxies and avoiding CORS.
 */
async function aiSafeFetch(path, options = {}) {
  const urlMap = {
    '/proxy-openai': 'https://api.openai.com',
    '/proxy-anthropic': 'https://api.anthropic.com',
    '/proxy-gemini': 'https://generativelanguage.googleapis.com'
  };

  let finalUrl = path;
  for (const [proxyRoot, realRoot] of Object.entries(urlMap)) {
    if (path.startsWith(proxyRoot)) {
      finalUrl = path.replace(proxyRoot, realRoot);
      break;
    }
  }

  // If window.api.sendRequest exists (Electron context), use it to bypass CORS and network limitations
  if (window.api && window.api.sendRequest) {
    const payload = {
      url: finalUrl,
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body
    };
    const response = await window.api.sendRequest(payload);
    if (response.error) throw new Error(response.error);
    
    // Polyfill the response interface the app expects
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.json,
      text: async () => response.body
    };
  }

  // Fallback to standard fetch (Development)
  return fetch(path, options);
}

// Helper to fetch available models for the selected provider
export async function fetchModels(provider, apiKey, addLog) {
  if (!apiKey) {
    if (addLog) addLog({ source: "AI", type: "info", message: `Skipped fetching models: No API key for ${provider}` });
    return [];
  }

  if (addLog) addLog({ source: "AI", type: "info", message: `Fetching available models for ${provider}...` });

  try {
    if (provider === "openai") {
      const res = await aiSafeFetch("/proxy-openai/v1/models", {
        headers: { "Authorization": `Bearer ${apiKey}` }
      });
      if (!res.ok) {
        const text = await res.text();
        if (addLog) addLog({ source: "AI", type: "error", message: `OpenAI fetch failed (${res.status})`, data: text });
        throw new Error("Failed to fetch OpenAI models");
      }
      const data = await res.json();
      return (data.data || []).map(m => m.id);
    }

    if (provider === "anthropic") {
      const res = await aiSafeFetch("/proxy-anthropic/v1/models", {
        headers: { 
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true" 
        }
      });
      if (!res.ok) {
        const text = await res.text();
        if (addLog) addLog({ source: "AI", type: "error", message: `Anthropic fetch failed (${res.status})`, data: text });
        throw new Error("Failed to fetch Anthropic models");
      }
      const data = await res.json();
      return (data.data || []).filter(m => m.type === "model").map(m => m.id);
    }

    if (provider === "gemini") {
      const res = await aiSafeFetch(`/proxy-gemini/v1beta/models?key=${apiKey}`);
      if (!res.ok) {
        const text = await res.text();
        if (addLog) addLog({ source: "AI", type: "error", message: `Gemini fetch failed (${res.status})`, data: text });
        throw new Error("Failed to fetch Gemini models");
      }
      const data = await res.json();
      const models = (data.models || []).map(m => m.name.replace('models/', ''));
      if (addLog) addLog({ source: "AI", type: "success", message: `Fetched ${models.length} Gemini models` });
      return models;
    }
  } catch (error) {
    console.warn(`Could not fetch models for ${provider}:`, error);
    if (addLog && !error.message.includes("fetch")) {
      addLog({ source: "AI", type: "error", message: `Exception thrown fetching ${provider} models`, data: error.toString() });
    }
  }

  return [];
}
function parseLLMJson(text) {
  let cleanText = text.trim();
  let beforeStr = "";
  let afterStr = "";

  // Find the first { or [
  const firstBrace = cleanText.indexOf('{');
  const firstBracket = cleanText.indexOf('[');
  
  let startIdx = -1;
  if (firstBrace !== -1 && firstBracket !== -1) {
    startIdx = Math.min(firstBrace, firstBracket);
  } else {
    startIdx = Math.max(firstBrace, firstBracket);
  }

  // Find the last } or ]
  const lastBrace = cleanText.lastIndexOf('}');
  const lastBracket = cleanText.lastIndexOf(']');
  
  let endIdx = Math.max(lastBrace, lastBracket);

  let jsonStr = cleanText;

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    beforeStr = cleanText.substring(0, startIdx).trim();
    afterStr = cleanText.substring(endIdx + 1).trim();
    jsonStr = cleanText.substring(startIdx, endIdx + 1);
  }

  // Clean trailing/leading markdown codeblock syntax from the non-JSON parts
  if (beforeStr.endsWith("```json")) beforeStr = beforeStr.substring(0, beforeStr.length - 7).trim();
  else if (beforeStr.endsWith("```")) beforeStr = beforeStr.substring(0, beforeStr.length - 3).trim();

  if (afterStr.startsWith("```")) afterStr = afterStr.substring(3).trim();

  let parsed = JSON.parse(jsonStr);

  // If it's an object and has extra text, merge it into the message field
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    let combinedMessage = [];
    if (beforeStr) combinedMessage.push(beforeStr);
    if (parsed.message) combinedMessage.push(parsed.message);
    if (afterStr) combinedMessage.push(afterStr);
    
    if (combinedMessage.length > 0) {
      parsed.message = combinedMessage.join('\\n\\n');
    }
  }

  return parsed;
}

// Helper to call different LLM providers
async function callLLM(provider, model, apiKey, systemPrompt, userMessage, format = "json", sessionContext = null) {
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
    if (sessionContext?.conversation_id) {
      body.conversation_id = sessionContext.conversation_id;
    }

    // Using Vite proxy to avoid CORS
    const res = await aiSafeFetch("/proxy-openai/v1/chat/completions", {
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
    const res = await aiSafeFetch("/proxy-anthropic/v1/messages", {
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
      const body = {
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          { role: "user", parts: [{ text: userMessage }] }
        ],
        generationConfig: {
          responseMimeType: format === "json" ? "application/json" : "text/plain"
        }
      };
      
      if (sessionContext?.past_conversation_ids?.length > 0) {
        body.past_conversation_ids = sessionContext.past_conversation_ids;
      }

      const res = await aiSafeFetch(`/proxy-gemini/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const textResult = data.candidates[0].content.parts[0].text;
    const usage = data.usageMetadata ? { input: data.usageMetadata.promptTokenCount, output: data.usageMetadata.candidatesTokenCount } : null;
    return { result: format === "json" ? parseLLMJson(textResult) : textResult, usage, model: geminiModel };
  }

  throw new Error("Unknown AI Provider");
}

export async function generateRequestFromPrompt(prompt, currentState, collections, aiSettings, activeAiSessionId, aiChatSessions, responseData = null) {
  const { provider, model, keys, semanticSearchEnabled } = aiSettings;
  const apiKey = keys[provider];

  let relevantRequests = searchRequestsContext(prompt, collections);

  if (semanticSearchEnabled) {
    try {
      const semanticResults = await SemanticSearch.search(prompt);
      if (semanticResults && semanticResults.length > 0) {
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

  const sessionContext = {};
  if (provider === "openai" && activeAiSessionId) {
    sessionContext.conversation_id = activeAiSessionId;
  } else if (provider === "gemini" && aiChatSessions?.length > 0) {
    // Send the last 5 session IDs for context
    const sorted = [...aiChatSessions].sort((a,b) => b.timestamp - a.timestamp);
    sessionContext.past_conversation_ids = sorted.slice(0, 5).map(s => s.id);
  }

  // Build response context if available
  let responseContext = "No response data available yet.";
  if (responseData) {
    let bodyStr = String(responseData.body || "");
    try {
      // Try lossless compression to fit more data into the context window
      const parsed = JSON.parse(bodyStr);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0] !== null) {
        // Evaluate three compression strategies and pick the shortest representation

        // 1. Minified JSON
        const rawJsonStr = JSON.stringify(parsed);

        // 2. Schema-Tuple
        const schema = Array.from(new Set(parsed.flatMap(obj => Object.keys(obj))));
        const tupleData = parsed.map(obj => schema.map(k => obj[k] !== undefined ? obj[k] : null));
        const tupleJsonStr = JSON.stringify({
          __schema: schema,
          __data: tupleData
        });

        // 3. Schema-Tuple + Dictionary (LZ77 Enum Mapping)
        let dictItems = new Map();
        let dictArray = [];
        const tupleDictData = parsed.map(obj => schema.map(k => {
          let val = obj[k] !== undefined ? obj[k] : null;
          if (typeof val === 'string' && val.length > 2) { // Dictionary only for strings > 2 chars
            if (!dictItems.has(val)) {
              dictItems.set(val, dictArray.length);
              dictArray.push(val);
            }
            return dictItems.get(val); // Replace string with numeric pointer
          }
          return val;
        }));
        
        // Only use dict if it actually has items
        const dictJsonStr = dictArray.length > 0 
          ? JSON.stringify({ __dict: dictArray, __schema: schema, __data: tupleDictData }) 
          : tupleJsonStr;

        // Select the winning approach based on string length (proxy for token count)
        const candidates = [
          { method: "Minified JSON", str: rawJsonStr, len: rawJsonStr.length },
          { method: "Schema-Tuple", str: `[Compressed using Schema-Tuple format]\n${tupleJsonStr}`, len: tupleJsonStr.length },
          { method: "Schema-Tuple+Dictionary", str: `[Compressed using Schema-Tuple + Dictionary Encoder]\n${dictJsonStr}`, len: dictJsonStr.length }
        ];

        candidates.sort((a, b) => a.len - b.len);
        bodyStr = candidates[0].str;

      } else {
        // Regular JSON minification (removes all excess whitespace/newlines)
        bodyStr = JSON.stringify(parsed);
      }
    } catch (e) {
      // Not JSON or parsing failed, leave as is
    }

    const bodyLimit = 25000; // Increased limit because data is now much denser
    const bodyPreview = bodyStr.substring(0, bodyLimit) + (bodyStr.length > bodyLimit ? `\n...[TRUNCATED: showing ${bodyLimit} of ${bodyStr.length} chars]` : "");
    responseContext = `Status: ${responseData.status || "N/A"} ${responseData.statusText || ""}\nHeaders: ${responseData.headers ? JSON.stringify(responseData.headers).substring(0, 600) : ""}\nBody (${bodyStr.length} chars total):\n${bodyPreview}`;
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

# Current Active Request State
Protocol: ${currentState.protocol || "http"}
Method: ${currentState.method}
URL: ${currentState.url}
Headers: ${currentState.headersText ? currentState.headersText.substring(0, 1000) : ""}
Body: ${currentState.bodyText ? currentState.bodyText.substring(0, 2000) : ""}
${currentState.protocol === "graphql" ? `GraphQL Query: ${currentState.graphqlConfig?.query || ""}\nGraphQL Variables: ${currentState.graphqlConfig?.variables || "{}"}` : ""}

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
7. If the user asks about the response, analyzes errors, or wants to extract data, answer based on the "Last Response" context above.
8. Do NOT hallucinate endpoints. If nothing matches, apologize.
9. If the user asks to find/load a request, IGNORE any "Template: " prefix.
10. **GRAPHQL NOTE:** If protocol is "graphql", use \`UPDATE_CURRENT_REQUEST\` with \`query\` and \`variables\` in the payload.
11. **COMPRESSED DATA INSTRUCTION:** The "Last Response" may be compressed to save space. 
    - If you see \`__schema\` and \`__data\`, each row in \`__data\` is an object where the values correspond positionally to the keys in \`__schema\`.
    - If you see \`__dict\`, any integer values in \`__data\` that correspond to string-like fields are index pointers to the \`__dict\` array. You MUST map these integers back to their actual string values from \`__dict\` before answering or extracting data.
    - Reconstruct the data mentally before providing your answer. Recreate the complete final objects if the user asks for extraction.

You must output STRICT JSON matching this schema:
{
  "message": "A friendly textual reply explaining what you did or observed",
  "operations": [
    {
      "type": "UPDATE_CURRENT_REQUEST" | "UPDATE_REQUEST_BY_ID" | "CREATE_REQUEST" | "SUGGEST_ENDPOINTS" | "SEND_REQUEST" | "GENERATE_TESTS" | "DELETE_REQUEST" | "MOVE_REQUEST",
      "payload": {
        // UPDATE_CURRENT_REQUEST: { "method", "url", "headersText", "bodyText" }
        // UPDATE_CURRENT_REQUEST: { "method"?: string, "url"?: string, "headersText"?: string, "bodyText"?: string, "query"?: string, "variables"?: string, "protocol"?: string }
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

  const response = await callLLM(provider, model, apiKey, systemPrompt, prompt, "json", sessionContext);
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
