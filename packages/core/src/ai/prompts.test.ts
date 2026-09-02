import { describe, it, expect } from "vitest";
import { buildAssistSystemPrompt, buildTestsSystemPrompt, buildTestsUserMessage } from "./prompts";

describe("buildAssistSystemPrompt", () => {
  it("embeds current state, response context, collections, relevant requests, and the operation schema", () => {
    const prompt = buildAssistSystemPrompt({
      currentState: { protocol: "http", method: "GET", url: "https://x", headersText: "H", bodyText: "B" },
      responseContext: "Status: 200 OK",
      collectionContext: [{ id: "c1", name: "API", folders: [], requestCount: 2 }],
      relevantRequests: [{ id: "r1", name: "List", method: "GET", url: "https://x", protocol: "http", description: "d" }],
    });
    expect(prompt).toContain("Method: GET");
    expect(prompt).toContain("Status: 200 OK");
    expect(prompt).toContain('"API"');
    expect(prompt).toContain('"r1"');
    expect(prompt).toContain("UPDATE_CURRENT_REQUEST");
    expect(prompt).toContain("SUGGEST_ENDPOINTS");
    expect(prompt).toContain("Return ONLY valid JSON");
  });

  it("includes the GraphQL block only when the protocol is graphql", () => {
    const g = buildAssistSystemPrompt({
      currentState: { protocol: "graphql", method: "POST", url: "https://x", graphqlConfig: { query: "{ me }", variables: "{}" } },
      responseContext: "",
      collectionContext: [],
      relevantRequests: [],
    });
    expect(g).toContain("GraphQL Query: { me }");
    const h = buildAssistSystemPrompt({ currentState: { protocol: "http", method: "GET", url: "https://x" }, responseContext: "", collectionContext: [], relevantRequests: [] });
    expect(h).not.toContain("GraphQL Query:");
  });
});

describe("buildTestsSystemPrompt / buildTestsUserMessage", () => {
  it("describes the pm.* API and STRICT JSON tests shape", () => {
    const sys = buildTestsSystemPrompt();
    expect(sys).toContain("pm.response.to.have.status");
    expect(sys).toContain('"tests"');
  });

  it("builds a user message from request + response, previewing the body", () => {
    const msg = buildTestsUserMessage({ method: "GET", url: "https://x" }, { status: 200, body: "y".repeat(2000) });
    expect(msg).toContain("Request: GET https://x");
    expect(msg).toContain("Response Status: 200");
    expect(msg.length).toBeLessThan(1200);
  });
});
