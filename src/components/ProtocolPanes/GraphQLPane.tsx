import React, { useState, useCallback, useRef, useEffect } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { json } from "@codemirror/lang-json";
import { GraphQLProtocol } from "../../protocols/graphql";

/**
 * GraphQLPane - Request editor for GraphQL queries/mutations.
 *
 * Props:
 *   url, setUrl, headers, onSend, isSending, getEnvVars
 */
export interface GraphQLPaneProps {
  url: string;
  setUrl: (v: string) => void;
  config: any;
  setConfig: React.Dispatch<React.SetStateAction<any>>;
  onSend: () => void;
  isSending: boolean;
  response?: any;
}


export function GraphQLPane({
  url,
  setUrl,
  config,
  setConfig,
  onSend,
  isSending,
  response
}: GraphQLPaneProps) {
  const { query, variables, operationName, headers } = config || { query: "", variables: "{}", headers: {} };

  const setQuery = (v: string) => setConfig((prev: any) => ({ ...prev, query: v }));
  const setVariables = (v: string) => setConfig((prev: any) => ({ ...prev, variables: v }));
  const setOperationName = (v: string) => setConfig((prev: any) => ({ ...prev, operationName: v }));
  const setHeaders = (v: any) => setConfig((prev: any) => ({ ...prev, headers: v }));

  const [activeTab, setActiveTab] = useState("query"); // query | variables | headers | schema
  const [schema, setSchema] = useState<any>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [schemaFilter, setSchemaFilter] = useState("");
  const [selectedTypeName, setSelectedTypeName] = useState("");

  const operationType = GraphQLProtocol.detectOperationType(query);
  const schemaTypes = (schema?.types || []).filter((type: any) => type?.name && !type.name.startsWith("__"));
  const filteredSchemaTypes = schemaTypes.filter((type: any) => {
    const search = schemaFilter.trim().toLowerCase();
    if (!search) return true;
    return (
      type.name.toLowerCase().includes(search) ||
      (type.fields || []).some((field: any) => field.name.toLowerCase().includes(search))
    );
  });
  const selectedSchemaType = filteredSchemaTypes.find((type: any) => type.name === selectedTypeName)
    || schemaTypes.find((type: any) => type.name === selectedTypeName)
    || filteredSchemaTypes[0]
    || null;

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
    } catch (err: any) {
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

  const operationColors: Record<string, string> = {
    QUERY: "#6366f1",
    MUTATION: "#f59e0b",
    SUBSCRIPTION: "#10b981"
  };

  const fillPaneStyle: React.CSSProperties = {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column"
  };

  const editorFrameStyle: React.CSSProperties = {
    flex: 1,
    minHeight: 0,
    borderRadius: "8px",
    overflow: "hidden",
    border: "1px solid var(--border)"
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, gap: "8px" }}>
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

      {operationType === "SUBSCRIPTION" && (
        <div style={{
          margin: "0 12px",
          padding: "10px 12px",
          borderRadius: "8px",
          border: "1px solid rgba(245, 158, 11, 0.25)",
          background: "rgba(245, 158, 11, 0.08)",
          color: "var(--text-muted)",
          fontSize: "0.8rem"
        }}>
          Subscription operations usually require a WebSocket transport. The current GraphQL pane executes over HTTP only.
        </div>
      )}

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
      <div style={{ ...fillPaneStyle, padding: "0 12px 12px" }}>
        {activeTab === "query" && (
          <div style={fillPaneStyle}>
            <CodeMirror
              value={query}
              onChange={(val) => setQuery(val)}
              theme={vscodeDark}
              height="100%"
              style={{ ...editorFrameStyle, fontSize: "13px" }}
              placeholder={`query {\n  users {\n    id\n    name\n    email\n  }\n}`}
            />
          </div>
        )}

        {activeTab === "variables" && (
          <div style={{ ...fillPaneStyle, gap: "8px" }}>
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
            <div style={fillPaneStyle}>
              <CodeMirror
                value={variables}
                onChange={(val) => setVariables(val)}
                theme={vscodeDark}
                extensions={[json()]}
                height="100%"
                style={{ ...editorFrameStyle, fontSize: "13px" }}
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
          <div style={{ ...fillPaneStyle, gap: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button className="ghost" onClick={handleFetchSchema} disabled={schemaLoading || !url}>
                {schemaLoading ? "Loading..." : "Fetch Schema"}
              </button>
              <input
                className="input"
                style={{ maxWidth: "260px" }}
                placeholder="Search types or fields"
                value={schemaFilter}
                onChange={(e) => setSchemaFilter(e.target.value)}
              />
              {schemaError && (
                <span style={{ fontSize: "0.8rem", color: "var(--accent-red, #ef4444)" }}>{schemaError}</span>
              )}
            </div>
            {schema && (
              <div style={{ ...fillPaneStyle, fontSize: "0.8rem", color: "var(--text)", display: "grid", gridTemplateColumns: "260px 1fr", gap: "12px" } as React.CSSProperties}>
                <div style={{
                  minHeight: 0,
                  overflow: "auto",
                  background: "var(--panel)",
                  borderRadius: "8px",
                  padding: "12px",
                  border: "1px solid var(--border)"
                }}>
                  <div style={{ marginBottom: "8px", fontWeight: 600 }}>Types ({filteredSchemaTypes.length})</div>
                  {filteredSchemaTypes.map((type: any) => (
                    <button
                      key={type.name}
                      className="ghost"
                      onClick={() => setSelectedTypeName(type.name)}
                      style={{
                        width: "100%",
                        justifyContent: "flex-start",
                        marginBottom: "6px",
                        borderColor: selectedSchemaType?.name === type.name ? "var(--accent)" : "var(--border)",
                        color: selectedSchemaType?.name === type.name ? "var(--accent)" : "var(--text)"
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{type.name}</span>
                    </button>
                  ))}
                </div>
                <div style={{
                  minHeight: 0,
                  overflow: "auto",
                  background: "var(--panel)",
                  borderRadius: "8px",
                  padding: "12px",
                  border: "1px solid var(--border)"
                }}>
                  {selectedSchemaType ? (
                    <>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" }}>
                        <span style={{ fontWeight: 700, fontSize: "1rem" }}>{selectedSchemaType.name}</span>
                        <span style={{ color: "var(--accent)", fontWeight: 600 }}>{selectedSchemaType.kind}</span>
                      </div>
                      {selectedSchemaType.description && (
                        <div style={{ marginBottom: "12px", color: "var(--text-muted)" }}>{selectedSchemaType.description}</div>
                      )}
                      {(selectedSchemaType.fields || []).length > 0 && (
                        <div style={{ marginBottom: "12px" }}>
                          <div style={{ fontWeight: 600, marginBottom: "6px" }}>Fields</div>
                          {(selectedSchemaType.fields || []).map((field: any) => (
                            <div key={field.name} style={{ padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                              <div style={{ fontWeight: 600 }}>{field.name}</div>
                              {field.description && <div style={{ color: "var(--text-muted)" }}>{field.description}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                      {(selectedSchemaType.inputFields || []).length > 0 && (
                        <div style={{ marginBottom: "12px" }}>
                          <div style={{ fontWeight: 600, marginBottom: "6px" }}>Input Fields</div>
                          {(selectedSchemaType.inputFields || []).map((field: any) => (
                            <div key={field.name} style={{ padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                              <div style={{ fontWeight: 600 }}>{field.name}</div>
                              {field.description && <div style={{ color: "var(--text-muted)" }}>{field.description}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                      {(selectedSchemaType.enumValues || []).length > 0 && (
                        <div>
                          <div style={{ fontWeight: 600, marginBottom: "6px" }}>Enum Values</div>
                          {(selectedSchemaType.enumValues || []).map((field: any) => (
                            <div key={field.name} style={{ padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                              <div style={{ fontWeight: 600 }}>{field.name}</div>
                              {field.description && <div style={{ color: "var(--text-muted)" }}>{field.description}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ color: "var(--text-muted)" }}>No matching schema types.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

export default GraphQLPane;
