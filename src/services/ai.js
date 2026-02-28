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

export async function generateRequestFromPrompt(prompt, currentState, collections, aiSettings, chatHistory = []) {
  const { provider, model, keys } = aiSettings;
  const apiKey = keys[provider];

  const relevantRequests = searchRequestsContext(prompt, collections);

  let historyText = "No previous conversation";

  if (chatHistory.length > 6) {
    // Summarize older messages, but keep the immediate last 2 verbatim for pristine recent context
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

  const systemPrompt = `
You are an advanced API Client AI Assistant. Your goal is to help the user configure API requests.
The workspace has collections containing requests. The user might want to edit the active request or create/update requests in their workspace.

# Conversation History
${historyText}

# Current Active Request State
Method: ${currentState.method}
URL: ${currentState.url}
Headers: ${currentState.headersText}
Body: ${currentState.bodyText}

# Relevant Workspace Requests (Searched via keywords)
${JSON.stringify(relevantRequests, null, 2)}

# Objective
Analyze the user's prompt and decide what actions need to be taken. 
CRITICAL RULE: If the user asks to "find", "load", "open" or "get" an existing request, you MUST look through the "Relevant Workspace Requests" provided above and return an \`UPDATE_CURRENT_REQUEST\` operation that precisely copies its Method, URL, Headers, and Body into the current state. Do NOT hallucinate or guess a new endpoint. If nothing matches, apologize in the message.
IMPORTANT: If the user explicitly asks to find or load a request, completely IGNORE any "Template: " prefix in their prompt. Do NOT try to modify the found request to match the Template. Just load the found request exactly as it is.

You must output STRICT JSON that matches this schema:
{
  "message": "A friendly textual reply explaining what you did",
  "operations": [
    {
      "type": "UPDATE_CURRENT_REQUEST" | "UPDATE_REQUEST_BY_ID" | "CREATE_REQUEST",
      "payload": {
        // For UPDATE_CURRENT_REQUEST: "method", "url", "headersText", "bodyText"
        // For UPDATE_REQUEST_BY_ID: "id", "updates": { ... }
        // For CREATE_REQUEST: "collectionId" (optional), "newCollectionName" (optional), "name", "method", "url", "headersText", "bodyText"
      }
    }
  ]
}

Return ONLY valid JSON. Your response must be parseable.
  `.trim();

  // Make the LLM API Call
  const response = await callLLM(provider, model, apiKey, systemPrompt, prompt);
  // response is { result, usage, model }
  return { ...response.result, _usage: response.usage, _model: response.model };
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
