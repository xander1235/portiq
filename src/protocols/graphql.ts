/**
 * GraphQL Protocol Handler
 *
 * Handles GraphQL queries, mutations, and subscriptions over HTTP.
 * Provides schema introspection, query validation hints, and variable support.
 */

export const INTROSPECTION_QUERY = `
  query IntrospectionQuery {
    __schema {
      queryType { name }
      mutationType { name }
      subscriptionType { name }
      types {
        ...FullType
      }
    }
  }

  fragment FullType on __Type {
    kind
    name
    description
    fields(includeDeprecated: true) {
      name
      description
      args {
        name
        description
        type { ...TypeRef }
        defaultValue
      }
      type { ...TypeRef }
      isDeprecated
      deprecationReason
    }
    inputFields {
      name
      description
      type { ...TypeRef }
      defaultValue
    }
    enumValues(includeDeprecated: true) {
      name
      description
      isDeprecated
      deprecationReason
    }
  }

  fragment TypeRef on __Type {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
        }
      }
    }
  }
`;

import { ProtocolHandler } from "./registry";

export const GraphQLProtocol: ProtocolHandler & {
  fetchSchema: (url: string, headers?: Record<string, string>) => Promise<any>;
  detectOperationType: (query: string) => string;
} = {
  id: "graphql",
  name: "GraphQL",
  description: "GraphQL queries and mutations",
  color: "#e535ab",
  icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 22 8 22 16 12 22 2 16 2 8 12 2"></polygon><line x1="12" y1="22" x2="12" y2="16"></line><line x1="22" y1="8" x2="12" y2="16"></line><line x1="2" y1="8" x2="12" y2="16"></line></svg>`,

  methods: ["QUERY", "MUTATION", "SUBSCRIPTION"],

  defaultConfig: {
    url: "",
    query: `query {\n  \n}`,
    variables: "{}",
    operationName: "",
    headers: {},
    auth: { type: "none" }
  },

  getDefaultUrl() {
    return "https://api.example.com/graphql";
  },

  detectProtocol(url: string) {
    if (!url) return false;
    const lower = url.toLowerCase().trim();
    return lower.includes("/graphql") || lower.endsWith("/gql");
  },

  validateRequest(config: any) {
    const errors: string[] = [];
    if (!config.url || !config.url.trim()) {
      errors.push("GraphQL endpoint URL is required");
    }
    if (!config.query || !config.query.trim()) {
      errors.push("Query is required");
    }
    if (config.variables) {
      try {
        if (typeof config.variables === "string" && config.variables.trim()) {
          JSON.parse(config.variables);
        }
      } catch (e) {
        errors.push("Variables must be valid JSON");
      }
    }
    return { valid: errors.length === 0, errors };
  },

  buildRequest(config: any) {
    let variables = null;
    if (config.variables) {
      try {
        variables = typeof config.variables === "string"
          ? JSON.parse(config.variables)
          : config.variables;
      } catch (e) {
        variables = null;
      }
    }

    return {
      url: config.url,
      headers: config.headers || {},
      query: config.query,
      variables,
      operationName: config.operationName || undefined
    };
  },

  parseResponse(raw: any) {
    const parsed: any = {
      status: raw.status,
      statusText: raw.statusText,
      duration: raw.duration ?? raw.time ?? 0,
      time: raw.time ?? raw.duration ?? 0,
      headers: raw.headers || {},
      body: raw.body || "",
      json: raw.json || null,
      error: raw.error || null,
      size: raw.body ? new Blob([raw.body]).size : 0
    };

    // Extract GraphQL-specific fields
    if (parsed.json) {
      parsed.data = parsed.json.data || null;
      parsed.errors = parsed.json.errors || null;
      parsed.extensions = parsed.json.extensions || null;
      parsed.hasErrors = Array.isArray(parsed.json.errors) && parsed.json.errors.length > 0;
    }

    return parsed;
  },

  /**
   * Fetch the GraphQL schema via introspection.
   */
  async fetchSchema(url: string, headers: Record<string, string> = {}) {
    try {
      const payload = {
        url,
        headers: { ...headers, "Content-Type": "application/json" },
        query: INTROSPECTION_QUERY
      };

      if ((window as any).api?.sendGraphQL) {
        const result = await (window as any).api.sendGraphQL(payload);
        if (result.json?.data?.__schema) {
          return result.json.data.__schema;
        }
      }
      return null;
    } catch (err) {
      console.error("Schema introspection failed:", err);
      return null;
    }
  },

  /**
   * Detect the operation type from a query string.
   */
  detectOperationType(query: string) {
    if (!query) return "QUERY";
    const trimmed = query.trim().toLowerCase();
    if (trimmed.startsWith("mutation")) return "MUTATION";
    if (trimmed.startsWith("subscription")) return "SUBSCRIPTION";
    return "QUERY";
  }
};

export default GraphQLProtocol;
