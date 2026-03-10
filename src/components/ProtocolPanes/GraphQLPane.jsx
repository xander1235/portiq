import React, { useState, useCallback, useRef, useEffect } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { json } from "@codemirror/lang-json";
import { GraphQLProtocol } from "../../protocols/graphql.js";

/**
 * GraphQLPane - Request editor for GraphQL queries/mutations.
 *
 * Props:
 *   url, setUrl, headers, onSend, isSending, getEnvVars
 */
export function GraphQLPane({
  url,
  setUrl,
  config,
  setConfig,
  onSend,
  isSending,
  response,
  getEnvVars
}) {
  const { query, variables, operationName, headers } = config || { query: "", variables: "{}", headers: {} };

  const setQuery = (v) => setConfig(prev => ({ ...prev, query: v }));
  const setVariables = (v) => setConfig(prev => ({ ...prev, variables: v }));
  const setOperationName = (v) => setConfig(prev => ({ ...prev, operationName: v }));
  const setHeaders = (v) => setConfig(prev => ({ ...prev, headers: v }));

  const [activeTab, setActiveTab] = useState("query"); // query | variables | headers | schema
  const [schema, setSchema] = useState(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState(null);

  const operationType = GraphQLProtocol.detectOperationType(query);

  const handleFetchSchema = useCallback(async () => {
    if (!url) return;
    setSchemaLoading(true);
    setSchemaError(null);
    try {
      const result = await GraphQLProtocol.fetchSchema(url, headers || {});
      if (result) {
        setSchema(result);
      } else {
        setSchemaError("Could not fetch schema. Make sure introspection is enabled on the server.");
      }
    } catch (err) {
      setSchemaError(err.message);
    } finally {
      setSchemaLoading(false);
    }
  }, [url, headers]);

  const handleSend = useCallback(() => {
    const validation = GraphQLProtocol.validateRequest({ url, query, variables });
    if (!validation.valid) {
      alert(validation.errors.join("\n"));
      return;
    }
    onSend?.();
  }, [url, query, variables, onSend]);

  const operationColors = {
    QUERY: "#6366f1",
    MUTATION: "#f59e0b",
    SUBSCRIPTION: "#10b981"
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: "8px" }}>
      {/* URL bar */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center", padding: "8px 12px" }}>
        <span style={{
          padding: "4px 10px",
          borderRadius: "6px",
          fontSize: "0.75rem",
          fontWeight: 700,
          background: `${operationColors[operationType]}20`,
          color: operationColors[operationType],
          flexShrink: 0
        }}>
          {operationType}
        </span>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="https://api.example.com/graphql"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
        />
        <button
          className="primary"
          onClick={handleSend}
          disabled={isSending}
          style={{ flexShrink: 0, padding: "8px 20px" }}
        >
          {isSending ? "Sending..." : "Execute"}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "2px", padding: "0 12px", borderBottom: "1px solid var(--border)" }}>
        {["query", "variables", "headers", "schema"].map((tab) => (
          <button
            key={tab}
            className={activeTab === tab ? "ghost active" : "ghost"}
            onClick={() => setActiveTab(tab)}
            style={{ textTransform: "capitalize", fontSize: "0.85rem", padding: "6px 14px" }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "auto", padding: "0 12px 12px" }}>
        {activeTab === "query" && (
          <div style={{ height: "100%" }}>
            <CodeMirror
              value={query}
              onChange={(val) => setQuery(val)}
              theme={vscodeDark}
              height="100%"
              style={{ fontSize: "13px", borderRadius: "8px", overflow: "hidden", border: "1px solid var(--border)" }}
              placeholder={`query {\n  users {\n    id\n    name\n    email\n  }\n}`}
            />
          </div>
        )}

        {activeTab === "variables" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", height: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <label style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Operation Name (optional)</label>
              <input
                className="input"
                style={{ flex: 1, maxWidth: "300px" }}
                placeholder="MyQuery"
                value={operationName}
                onChange={(e) => setOperationName(e.target.value)}
              />
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Variables (JSON)</div>
            <div style={{ flex: 1 }}>
              <CodeMirror
                value={variables}
                onChange={(val) => setVariables(val)}
                theme={vscodeDark}
                extensions={[json()]}
                height="100%"
                style={{ fontSize: "13px", borderRadius: "8px", overflow: "hidden", border: "1px solid var(--border)" }}
                placeholder='{\n  "userId": "123"\n}'
              />
            </div>
          </div>
        )}

        {activeTab === "headers" && (
          <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            <p>Headers are inherited from the HTTP headers configuration. GraphQL requests automatically include <code>Content-Type: application/json</code>.</p>
          </div>
        )}

        {activeTab === "schema" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button className="ghost" onClick={handleFetchSchema} disabled={schemaLoading || !url}>
                {schemaLoading ? "Loading..." : "Fetch Schema"}
              </button>
              {schemaError && (
                <span style={{ fontSize: "0.8rem", color: "var(--accent-red, #ef4444)" }}>{schemaError}</span>
              )}
            </div>
            {schema && (
              <div style={{ fontSize: "0.8rem", color: "var(--text)" }}>
                <div style={{ marginBottom: "8px", fontWeight: 600 }}>Types ({schema.types?.length || 0})</div>
                <div style={{
                  maxHeight: "300px", overflow: "auto",
                  background: "var(--panel)", borderRadius: "8px",
                  padding: "12px", border: "1px solid var(--border)"
                }}>
                  {schema.types?.filter(t => !t.name.startsWith("__")).map((type) => (
                    <div key={type.name} style={{ marginBottom: "8px" }}>
                      <span style={{ fontWeight: 600, color: "var(--accent)" }}>{type.kind}</span>{" "}
                      <span>{type.name}</span>
                      {type.fields && (
                        <div style={{ paddingLeft: "16px", color: "var(--text-muted)" }}>
                          {type.fields.slice(0, 10).map(f => (
                            <div key={f.name}>• {f.name}</div>
                          ))}
                          {type.fields.length > 10 && (
                            <div>... and {type.fields.length - 10} more fields</div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Response area for GraphQL */}
      {response && (
        <div style={{
          borderTop: "1px solid var(--border)",
          padding: "12px",
          maxHeight: "40%",
          overflow: "auto"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <span style={{
              padding: "2px 8px",
              borderRadius: "4px",
              fontSize: "0.75rem",
              fontWeight: 600,
              background: response.hasErrors ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)",
              color: response.hasErrors ? "#ef4444" : "#22c55e"
            }}>
              {response.status || "—"} {response.statusText || ""}
            </span>
            {response.duration && (
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{response.duration}ms</span>
            )}
          </div>

          {response.errors && (
            <div style={{
              background: "rgba(239,68,68,0.05)",
              border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: "8px",
              padding: "8px 12px",
              marginBottom: "8px"
            }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "#ef4444", marginBottom: "4px" }}>
                GraphQL Errors
              </div>
              {response.errors.map((err, i) => (
                <div key={i} style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                  • {err.message}
                  {err.locations && (
                    <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
                      {" "}(line {err.locations[0]?.line}, col {err.locations[0]?.column})
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {response.data && (
            <CodeMirror
              value={JSON.stringify(response.data, null, 2)}
              theme={vscodeDark}
              extensions={[json()]}
              readOnly
              height="200px"
              style={{ fontSize: "13px", borderRadius: "8px", overflow: "hidden", border: "1px solid var(--border)" }}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default GraphQLPane;
