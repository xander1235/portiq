import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom";
import CodeMirror from '@uiw/react-codemirror';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { xml as xmlLang } from '@codemirror/lang-xml';
import { linter, lintGutter } from '@codemirror/lint';
import { autocompletion } from '@codemirror/autocomplete';
import { EditorView, Decoration, ViewPlugin, MatchDecorator, hoverTooltip } from '@codemirror/view';
import { generateRequestFromPrompt, generateTestsFromResponse, summarizeResponse } from "./services/ai.js";
import { jsonToCsv, jsonToXml, xmlToJson, prettifyXml } from "./services/format.js";
import { applyDerivedFields, filterRows, sortRows } from "./services/table.js";

const responseTabs = ["Pretty", "Raw", "XML", "Table", "Visualize", "Headers"];
const requestTabs = ["Params", "Headers", "Auth", "Body", "Tests"];
const templates = [
  { id: "crud", label: "CRUD (REST)" },
  { id: "graphql", label: "GraphQL" },
  { id: "auth", label: "Auth / Token" },
  { id: "webhook", label: "Webhook Receiver" },
  { id: "search", label: "Search / Query" }
];

const xmlLinter = linter((view) => {
  const diagnostics = [];
  const text = view.state.doc.toString();
  if (!text.trim()) return diagnostics;

  // Mask interpolations to avoid valid variables throwing syntax errors
  const masked = text.replace(/\{\{[^}]+\}\}/g, m => 'x'.repeat(m.length));

  const parser = new DOMParser();
  const doc = parser.parseFromString(masked, "text/xml");
  const parseError = doc.querySelector("parsererror");

  if (parseError) {
    let line = 1, col = 1, msg = parseError.textContent || "Invalid XML";
    const chromeMatch = msg.match(/line (\d+) at column (\d+)/);
    if (chromeMatch) {
      line = parseInt(chromeMatch[1], 10);
      col = parseInt(chromeMatch[2], 10);
    }
    let pos = 0;
    try {
      if (line <= view.state.doc.lines) {
        pos = view.state.doc.line(line).from + Math.max(0, col - 1);
      }
    } catch (e) { }

    diagnostics.push({
      from: pos,
      to: pos,
      severity: "error",
      message: msg.slice(0, 150)
    });
  }
  return diagnostics;
});

const customJsonLinter = linter((view) => {
  const text = view.state.doc.toString();
  if (!text.trim()) return [];

  try {
    const noComments = text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length));
    const masked = noComments.replace(/\{\{[^}]+\}\}/g, m => '"' + 'x'.repeat(Math.max(0, m.length - 2)) + '"');
    JSON.parse(masked);
    return [];
  } catch (e) {
    const diagnostics = jsonParseLinter()(view);
    const interpolations = [];
    const regex = /\{\{[^}]+\}\}/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      interpolations.push({ from: match.index, to: match.index + match[0].length });
    }
    return diagnostics.filter(d => {
      return !interpolations.some(i => (d.to >= i.from - 2 && d.from <= i.to + 2));
    });
  }
});

const envVarMatcher = new MatchDecorator({
  regexp: /\{\{([^}]+)\}\}/g,
  decoration: (match) => Decoration.mark({
    class: "cm-env-var",
    attributes: { "data-env-key": match[1].trim() }
  })
});
const envVarHighlightPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = envVarMatcher.createDeco(view);
    }
    update(update) {
      this.decorations = envVarMatcher.updateDeco(update, this.decorations);
    }
  },
  {
    decorations: (v) => v.decorations
  }
);

function findArrayPaths(value, prefix = "$") {
  const paths = [];
  if (Array.isArray(value)) {
    paths.push(prefix);
    value.forEach((item, idx) => {
      paths.push(...findArrayPaths(item, `${prefix}[${idx}]`));
    });
    return paths;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, child]) => {
      paths.push(...findArrayPaths(child, `${prefix}.${key}`));
    });
  }
  return paths;
}

function getValueByPath(root, path) {
  if (!path || path === "$") return root;
  const cleaned = path.replace(/^\$\./, "");
  const parts = cleaned.split(".").flatMap((part) => {
    const match = part.match(/(\w+)\[(\d+)\]/);
    if (match) return [match[1], Number(match[2])];
    return [part];
  });
  return parts.reduce((acc, key) => (acc == null ? acc : acc[key]), root);
}

function EnvInput({ value, onChange, placeholder, className, style, envVars, onUpdateEnvVar }) {
  const containerStyle = { position: "relative", display: "flex", alignItems: "center", flex: 1, ...style };
  const inputRef = React.useRef(null);
  const textRef = React.useRef(null);
  const popupRef = React.useRef(null);
  const [editingKey, setEditingKey] = React.useState(null);
  const [draftValue, setDraftValue] = React.useState("");
  const [hoveredData, setHoveredData] = React.useState(null);

  React.useEffect(() => {
    function handleClickOutside(event) {
      if (editingKey && popupRef.current && !popupRef.current.contains(event.target)) {
        setEditingKey(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [editingKey]);

  const handleScroll = () => {
    if (inputRef.current && textRef.current) {
      textRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  };

  React.useEffect(() => {
    handleScroll();
  }, [value]);

  const renderHighlighted = () => {
    if (!value) {
      return <span style={{ color: "var(--muted)" }}>{placeholder}</span>;
    }
    const parts = value.split(/(\{\{.*?\}\})/g);
    return parts.map((part, i) => {
      if (part.startsWith("{{") && part.endsWith("}}")) {
        const key = part.slice(2, -2).trim();
        const exists = envVars && Object.prototype.hasOwnProperty.call(envVars, key);
        return (
          <span
            key={i}
            onPointerEnter={(e) => {
              const rect = e.target.getBoundingClientRect();
              setHoveredData({ key, rect });
            }}
            onPointerLeave={() => setHoveredData(null)}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (inputRef.current) {
                inputRef.current.focus();
                const rect = e.target.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const charWidth = rect.width / part.length;
                const charOffset = Math.round(clickX / charWidth);
                const prefixLength = parts.slice(0, i).join('').length;
                const totalOffset = prefixLength + charOffset;
                inputRef.current.setSelectionRange(totalOffset, totalOffset);
              }
            }}
            onDoubleClick={(e) => {
              if (!onUpdateEnvVar) return;
              e.preventDefault();
              e.stopPropagation();
              setEditingKey(key);
              setDraftValue(exists ? envVars[key] : "");
              setHoveredData(null);
            }}
            style={{
              position: "relative",
              color: exists ? "var(--accent-2)" : "#ff5555",
              backgroundColor: exists ? "rgba(46, 211, 198, 0.15)" : "rgba(255, 85, 85, 0.15)",
              borderRadius: "3px",
              padding: "0 2px",
              cursor: onUpdateEnvVar ? "text" : "default",
              pointerEvents: "auto"
            }}
          >
            {part}
          </span>
        );
      }
      return <span key={i} style={{ pointerEvents: "none" }}>{part}</span>;
    });
  };

  return (
    <div className={`env-input-wrap ${className}`} style={containerStyle}>
      {hoveredData && !editingKey && ReactDOM.createPortal(
        <div style={{
          position: "fixed",
          bottom: window.innerHeight - hoveredData.rect.top + 6,
          left: hoveredData.rect.left + (hoveredData.rect.width / 2),
          transform: "translateX(-50%)",
          background: "var(--panel-2)",
          border: "1px solid var(--border)",
          padding: "4px 8px",
          borderRadius: "4px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.6)",
          color: "var(--text)",
          fontSize: "0.80rem",
          whiteSpace: "nowrap",
          zIndex: 99999,
          pointerEvents: "none",
          display: "flex",
          flexDirection: "column",
          alignItems: "center"
        }}>
          <div style={{ fontWeight: 600, color: (envVars && Object.prototype.hasOwnProperty.call(envVars, hoveredData.key)) ? 'var(--text)' : '#ff5555' }}>
            {(envVars && Object.prototype.hasOwnProperty.call(envVars, hoveredData.key)) ? envVars[hoveredData.key] : "Unresolved Variable"}
          </div>
          {onUpdateEnvVar && (
            <div style={{ fontSize: "0.65rem", color: "var(--muted)", marginTop: "3px", fontWeight: 500 }}>
              Double-click to edit
            </div>
          )}
          <div style={{
            position: "absolute",
            top: "100%",
            left: "50%",
            transform: "translateX(-50%)",
            borderWidth: "4px",
            borderStyle: "solid",
            borderColor: "var(--border) transparent transparent transparent"
          }}></div>
        </div>,
        document.body
      )}
      {editingKey && (
        <div ref={popupRef} style={{
          position: "absolute",
          top: "100%", left: 0,
          marginTop: "4px",
          zIndex: 100,
          background: "var(--panel-2)",
          border: "1px solid var(--border)",
          padding: "8px",
          borderRadius: "8px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          minWidth: "220px",
          color: "var(--text)"
        }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>Edit variable: {editingKey}</div>
          <input
            autoFocus
            className="input compact"
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onUpdateEnvVar(editingKey, draftValue);
                setEditingKey(null);
              }
              if (e.key === "Escape") setEditingKey(null);
            }}
            placeholder="Value..."
          />
          <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
            <button className="ghost compact" onPointerDown={() => setEditingKey(null)}>Cancel</button>
            <button
              className="primary compact"
              onPointerDown={(e) => {
                e.preventDefault();
                onUpdateEnvVar(editingKey, draftValue);
                setEditingKey(null);
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
      <div style={{ position: "relative", flex: 1, display: "flex", alignItems: "center", overflow: "hidden", padding: 0, margin: 0, height: "100%" }}>
        <div
          ref={textRef}
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0, left: 0, right: 0, bottom: 0,
            pointerEvents: "none",
            whiteSpace: "pre",
            overflow: "hidden",
            color: "var(--text)",
            zIndex: 3,
            fontFamily: "inherit",
            fontSize: "inherit",
            fontWeight: "inherit",
            letterSpacing: "inherit",
            wordSpacing: "inherit",
            display: "flex",
            alignItems: "center",
          }}
        >
          {renderHighlighted()}
        </div>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={handleScroll}
          spellCheck={false}
          style={{
            flex: 1,
            width: "100%",
            height: "100%",
            padding: 0,
            margin: 0,
            border: "none",
            background: "transparent",
            outline: "none",
            color: "transparent",
            caretColor: "var(--text)",
            fontFamily: "inherit",
            fontSize: "inherit",
            fontWeight: "inherit",
            letterSpacing: "inherit",
            wordSpacing: "inherit",
            zIndex: 2,
            minWidth: 0,
            position: "relative"
          }}
        />
      </div>
    </div>
  );
}

function TableEditor({ rows, onChange, keyPlaceholder, valuePlaceholder, envVars, onUpdateEnvVar }) {
  function updateRow(index, field, value) {
    const next = rows.map((row, idx) => (idx === index ? { ...row, [field]: value } : row));
    onChange(next);
  }

  function addRow() {
    onChange([...rows, { key: "", value: "", comment: "", enabled: true }]);
  }

  function removeRow(index) {
    onChange(rows.filter((_, idx) => idx !== index));
  }

  return (
    <div className="table-editor">
      <div className="table-editor-header">
        <div />
        <div>{keyPlaceholder}</div>
        <div>{valuePlaceholder}</div>
        <div>Comment</div>
        <div className="table-editor-actions">
          <button className="ghost" onClick={addRow}>Add</button>
        </div>
      </div>
      <div className="table-rows">
        {rows.map((row, index) => (
          <div className="table-row" key={index}>
            <input
              type="checkbox"
              className="checkbox"
              checked={row.enabled !== false}
              onChange={(e) => updateRow(index, "enabled", e.target.checked)}
            />
            <input
              className="input table-input"
              value={row.key}
              placeholder={keyPlaceholder || "Key"}
              onChange={(e) => updateRow(index, "key", e.target.value)}
            />
            <EnvInput
              className="input table-input"
              value={row.value}
              placeholder={valuePlaceholder || "Value"}
              onChange={(val) => updateRow(index, "value", val)}
              envVars={envVars}
              onUpdateEnvVar={onUpdateEnvVar}
              style={{ width: "100%" }}
            />
            <input
              className="input table-input"
              value={row.comment || ""}
              placeholder="Comment"
              onChange={(e) => updateRow(index, "comment", e.target.value)}
            />
            <button className="ghost icon-button" onClick={() => removeRow(index)} aria-label="Remove row">
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function useLocalStorage(key, initialValue) {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.warn(error);
      return initialValue;
    }
  });

  const setValue = (value) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.warn(error);
    }
  };

  return [storedValue, setValue];
}

function App() {
  const [activeRequestTab, setActiveRequestTab] = useLocalStorage("ui_activeRequestTab", "Body");
  const [activeResponseTab, setActiveResponseTab] = useLocalStorage("ui_activeResponseTab", "Pretty");
  const [method, setMethod] = useLocalStorage("ui_method", "GET");
  const [url, setUrl] = useLocalStorage("ui_url", "https://api.example.com/users");
  const [headersText, setHeadersText] = useLocalStorage("ui_headersText", "{\n  \"Content-Type\": \"application/json\"\n}");
  const [bodyText, setBodyText] = useLocalStorage("ui_bodyText", "");
  const [aiPrompt, setAiPrompt] = useLocalStorage("ui_aiPrompt", "");
  const [templateId, setTemplateId] = useLocalStorage("ui_templateId", "");

  const [response, setResponse] = useState(null);
  const [responseSummary, setResponseSummary] = useState({ summary: "No response yet.", hints: [] });
  const [error, setError] = useState("");
  const [activeSidebar, setActiveSidebar] = useLocalStorage("ui_activeSidebar", "Collections");
  const [showSettings, setShowSettings] = useState(false);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [showRightRail, setShowRightRail] = useLocalStorage("ui_showRightRail", false);
  const [collections, setCollections] = useLocalStorage("ui_collections", [
    {
      id: "col-default",
      name: "Users API",
      items: [
        {
          type: "folder",
          id: "fld-users",
          name: "Users",
          items: [
            {
              type: "request",
              id: "req-1",
              name: "List Users",
              description: "Fetches the user list",
              tags: ["list", "users"],
              method: "GET",
              url: "https://api.example.com/users"
            },
            {
              type: "request",
              id: "req-2",
              name: "Create User",
              description: "Creates a new user",
              tags: ["create", "users"],
              method: "POST",
              url: "https://api.example.com/users"
            }
          ]
        }
      ]
    }
  ]);
  const [activeCollectionId, setActiveCollectionId] = useLocalStorage("ui_activeCollectionId", "col-default");
  const [environments, setEnvironments] = useLocalStorage("ui_environments", [
    {
      id: "env-default",
      name: "Local",
      vars: [{ key: "baseUrl", value: "https://api.example.com", comment: "", enabled: true }]
    }
  ]);
  const [activeEnvId, setActiveEnvId] = useLocalStorage("ui_activeEnvId", "env-default");

  const [paramsRows, setParamsRows] = useLocalStorage("ui_paramsRows", [{ key: "", value: "", comment: "", enabled: true }]);
  const [headersRows, setHeadersRows] = useLocalStorage("ui_headersRows", [{ key: "Content-Type", value: "application/json", comment: "", enabled: true }]);
  const [authRows, setAuthRows] = useLocalStorage("ui_authRows", [{ key: "Authorization", value: "Bearer <token>", comment: "", enabled: false }]);
  const [authType, setAuthType] = useLocalStorage("ui_authType", "none");
  const [authConfig, setAuthConfig] = useLocalStorage("ui_authConfig", {
    bearer: { token: "" },
    basic: { username: "", password: "" },
    api_key: { key: "", value: "", add_to: "header" }
  });
  const [bodyType, setBodyType] = useLocalStorage("ui_bodyType", "json");
  const [bodyRows, setBodyRows] = useLocalStorage("ui_bodyRows", [{ key: "", value: "", comment: "", enabled: true }]);
  const [testsPreText, setTestsPreText] = useLocalStorage("ui_testsPreText", "");
  const [testsPostText, setTestsPostText] = useLocalStorage("ui_testsPostText", "");
  const [testsInputText, setTestsInputText] = useLocalStorage("ui_testsInputText", "{\n  \"status\": 200,\n  \"body\": {\"ok\": true}\n}");
  const [testsOutput, setTestsOutput] = useState([]);
  const [headersMode, setHeadersMode] = useLocalStorage("ui_headersMode", "table");
  const [testsMode, setTestsMode] = useLocalStorage("ui_testsMode", "post");
  const [showTestInput, setShowTestInput] = useState(false);
  const [showTestOutput, setShowTestOutput] = useState(false);
  const [selectedTablePath, setSelectedTablePath] = useState("$");
  const [showEnvModal, setShowEnvModal] = useState(false);
  const [selectedEnvIds, setSelectedEnvIds] = useState([]);
  const [showCollectionModal, setShowCollectionModal] = useState(false);
  const [selectedCollectionIds, setSelectedCollectionIds] = useState([]);
  const [showCollectionMenu, setShowCollectionMenu] = useState(false);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showImportTextModal, setShowImportTextModal] = useState(false);
  const [showImportApiModal, setShowImportApiModal] = useState(false);
  const [showImportCollisionModal, setShowImportCollisionModal] = useState(false);
  const [importCollisionData, setImportCollisionData] = useState(null);
  const [importCollisionNameDraft, setImportCollisionNameDraft] = useState("");
  const [importTextDraft, setImportTextDraft] = useState("");
  const [importApiDraft, setImportApiDraft] = useState("");
  const [editingCollectionName, setEditingCollectionName] = useState(false);
  const [collectionNameDraft, setCollectionNameDraft] = useState("");
  const [editingFolderId, setEditingFolderId] = useState("");
  const [folderNameDraft, setFolderNameDraft] = useState("");
  const [editingEnvKey, setEditingEnvKey] = useState(null);
  const [editingEnvDraft, setEditingEnvDraft] = useState("");
  const [cmEnvEdit, setCmEnvEdit] = useState(null);
  const [openFolderMenuId, setOpenFolderMenuId] = useState("");
  const [requestName, setRequestName] = useLocalStorage("ui_requestName", "/users");
  const [currentRequestId, setCurrentRequestId] = useLocalStorage("ui_currentRequestId", "");
  const [editingRequestId, setEditingRequestId] = useState("");
  const [requestNameDraft, setRequestNameDraft] = useState("");
  const [editingMainRequestName, setEditingMainRequestName] = useState(false);
  const [topSearch, setTopSearch] = useState("");

  const [showSnippetModal, setShowSnippetModal] = useState(false);
  const [snippetLanguage, setSnippetLanguage] = useLocalStorage("ui_snippetLang", "curl");
  const [snippetInterpolate, setSnippetInterpolate] = useLocalStorage("ui_snippetInterpolate", false);
  const [snippetSearch, setSnippetSearch] = useState("");

  const [showExportModal, setShowExportModal] = useState(false);
  const [exportTargetNode, setExportTargetNode] = useState(null);
  const [exportSelections, setExportSelections] = useState(new Set());
  const [exportCollapsedFolders, setExportCollapsedFolders] = useState(new Set());
  const [exportInterpolate, setExportInterpolate] = useLocalStorage("ui_exportInterpolate", false);

  const [leftWidth, setLeftWidth] = useLocalStorage("ui_leftWidth", 260);
  const [rightWidth, setRightWidth] = useLocalStorage("ui_rightWidth", 260);
  const [topHeight, setTopHeight] = useLocalStorage("ui_topHeight", window.innerHeight / 2);
  const [draggingLeft, setDraggingLeft] = useState(false);
  const [draggingRight, setDraggingRight] = useState(false);
  const [draggingMain, setDraggingMain] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState(new Set());
  const [draggedItemId, setDraggedItemId] = useState(null);
  const [dragOverItemId, setDragOverItemId] = useState(null);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [itemToMove, setItemToMove] = useState(null);
  const [moveTargetId, setMoveTargetId] = useState("root");
  const [moveSearchQuery, setMoveSearchQuery] = useState("");

  const [search, setSearch] = useState("");
  const [searchKey, setSearchKey] = useState("");
  const [sortKey, setSortKey] = useState("");
  const [sortDirection, setSortDirection] = useState("asc");
  const [derivedName, setDerivedName] = useState("");
  const [derivedExpr, setDerivedExpr] = useState("");
  const [derivedFields, setDerivedFields] = useState([]);

  const parsedJson = useMemo(() => {
    if (response?.json) return response.json;
    if (response?.body) {
      try {
        return JSON.parse(response.body);
      } catch (err) {
        return null;
      }
    }
    return null;
  }, [response]);

  const tableCandidates = useMemo(() => {
    if (!parsedJson) return [];
    const paths = findArrayPaths(parsedJson);
    return paths.length ? paths : ["$"];
  }, [parsedJson]);

  const tableRows = useMemo(() => {
    if (!parsedJson) return [];
    const target = getValueByPath(parsedJson, selectedTablePath);
    if (Array.isArray(target)) return target;
    if (target && typeof target === "object") return [target];
    return [];
  }, [parsedJson, selectedTablePath]);

  const computedRows = useMemo(() => {
    const filtered = filterRows(tableRows, search, searchKey);
    const withDerived = applyDerivedFields(filtered, derivedFields);
    return sortRows(withDerived, sortKey, sortDirection);
  }, [tableRows, search, searchKey, derivedFields, sortKey, sortDirection]);

  const csv = useMemo(() => {
    if (!parsedJson) return "";
    return jsonToCsv(parsedJson);
  }, [parsedJson]);

  const xml = useMemo(() => {
    if (parsedJson) {
      return `<response>\n${jsonToXml(parsedJson, 1)}\n</response>`;
    }
    return "";
  }, [parsedJson]);

  const pretty = useMemo(() => {
    if (parsedJson) return JSON.stringify(parsedJson, null, 2);
    if (response?.body) return response.body;
    return "";
  }, [response, parsedJson]);

  const raw = useMemo(() => response?.body || "", [response]);

  // Handle clicking outside to close menus
  useEffect(() => {
    function handleClickOutside(e) {
      if (!e.target.closest(".menu-wrap") && !e.target.closest(".menu")) {
        setOpenFolderMenuId("");
        setShowCollectionMenu(false);
        setShowImportMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Sidebar resizing
  useEffect(() => {
    function handleMouseMove(e) {
      if (draggingLeft) {
        setLeftWidth(Math.max(150, Math.min(e.clientX, window.innerWidth / 2)));
      } else if (draggingRight) {
        setRightWidth(Math.max(150, Math.min(window.innerWidth - e.clientX, window.innerWidth / 2)));
      } else if (draggingMain) {
        setTopHeight(Math.max(100, Math.min(e.clientY - 60, window.innerHeight - 150))); // -60 for topbar rough height
      }
    }
    function handleMouseUp() {
      setDraggingLeft(false);
      setDraggingRight(false);
      setDraggingMain(false);
    }
    if (draggingLeft || draggingRight || draggingMain) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "none";
      if (draggingMain) {
        document.body.style.cursor = "row-resize";
      } else {
        document.body.style.cursor = "col-resize";
      }
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [draggingLeft, draggingRight, draggingMain]);

  async function loadPersisted() {
    try {
      if (window.api?.loadState) {
        return await window.api.loadState("appState");
      }
    } catch (err) {
      // fall through to localStorage
    }
    return localStorage.getItem("appState");
  }

  function savePersisted(value) {
    if (window.api?.saveState) {
      window.api.saveState("appState", value).catch(() => {
        localStorage.setItem("appState", value);
      });
      return;
    }
    localStorage.setItem("appState", value);
  }

  useEffect(() => {
    let isMounted = true;
    loadPersisted().then((value) => {
      if (!isMounted || !value) return;
      try {
        const state = JSON.parse(value);
        if (state.method) setMethod(state.method);
        if (state.url) setUrl(state.url);
        if (state.headersText) setHeadersText(state.headersText);
        if (state.bodyText !== undefined) setBodyText(state.bodyText);
        if (state.testsPreText !== undefined) setTestsPreText(state.testsPreText);
        if (state.testsPostText !== undefined) setTestsPostText(state.testsPostText);
        if (state.testsInputText) setTestsInputText(state.testsInputText);
        if (state.bodyType) setBodyType(state.bodyType);
        if (state.paramsRows) setParamsRows(state.paramsRows);
        if (state.headersRows) setHeadersRows(state.headersRows);
        if (state.authRows) setAuthRows(state.authRows);
        if (state.bodyRows) setBodyRows(state.bodyRows);
        if (state.activeRequestTab) setActiveRequestTab(state.activeRequestTab);
        if (state.activeResponseTab) setActiveResponseTab(state.activeResponseTab);
        if (state.templateId) setTemplateId(state.templateId);
        if (Array.isArray(state.collections) && state.collections.length > 0) {
          setCollections(state.collections);
        }
        if (state.activeCollectionId) setActiveCollectionId(state.activeCollectionId);
        if (Array.isArray(state.environments) && state.environments.length > 0) {
          setEnvironments(state.environments);
        }
        if (state.activeEnvId) setActiveEnvId(state.activeEnvId);
        if (state.search !== undefined) setSearch(state.search);
        if (state.searchKey !== undefined) setSearchKey(state.searchKey);
        if (state.sortKey !== undefined) setSortKey(state.sortKey);
        if (state.sortDirection) setSortDirection(state.sortDirection);
        if (state.selectedTablePath) setSelectedTablePath(state.selectedTablePath);
        if (state.headersMode) setHeadersMode(state.headersMode);
        if (state.testsMode) setTestsMode(state.testsMode);
      } catch (err) {
        // ignore corrupt state
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const payload = {
      method,
      url,
      headersText,
      bodyText,
      testsPreText,
      testsPostText,
      testsInputText,
      bodyType,
      paramsRows,
      headersRows,
      authRows,
      bodyRows,
      activeRequestTab,
      activeResponseTab,
      templateId,
      collections,
      activeCollectionId,
      environments,
      activeEnvId,
      search,
      searchKey,
      sortKey,
      sortDirection,
      selectedTablePath,
      headersMode,
      testsMode
    };
    const timer = setTimeout(() => {
      const value = JSON.stringify(payload);
      savePersisted(value);
    }, 200);
    return () => clearTimeout(timer);
  }, [
    method,
    url,
    headersText,
    bodyText,
    testsPreText,
    testsPostText,
    testsInputText,
    bodyType,
    paramsRows,
    headersRows,
    authRows,
    bodyRows,
    activeRequestTab,
    activeResponseTab,
    templateId,
    collections,
    activeCollectionId,
    environments,
    activeEnvId,
    search,
    searchKey,
    sortKey,
    sortDirection,
    selectedTablePath,
    headersMode,
    testsMode
  ]);

  useEffect(() => {
    const handler = () => {
      const payload = {
        method,
        url,
        headersText,
        bodyText,
        testsPreText,
        testsPostText,
        testsInputText,
        bodyType,
        paramsRows,
        headersRows,
        authRows,
        bodyRows,
        activeRequestTab,
        activeResponseTab,
        templateId,
        collections,
        activeCollectionId,
        environments,
        activeEnvId,
        search,
        searchKey,
        sortKey,
        sortDirection,
        selectedTablePath,
        headersMode,
        testsMode
      };
      const value = JSON.stringify(payload);
      savePersisted(value);
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [
    method,
    url,
    headersText,
    bodyText,
    testsPreText,
    testsPostText,
    testsInputText,
    bodyType,
    paramsRows,
    headersRows,
    authRows,
    bodyRows,
    activeRequestTab,
    activeResponseTab,
    templateId,
    collections,
    activeCollectionId,
    environments,
    activeEnvId,
    search,
    searchKey,
    sortKey,
    sortDirection,
    selectedTablePath,
    headersMode,
    testsMode
  ]);

  function parseHeaders() {
    try {
      let parsed = {};
      if (headersText && headersText.trim().length > 0) {
        parsed = JSON.parse(headersText);
      } else {
        parsed = headersRows
          .filter((row) => row.key && row.enabled !== false)
          .reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
      }

      const authHeaders = getCompiledAuthHeaders(authType, authConfig, authRows, (v) => v);
      return { ...authHeaders, ...parsed };
    } catch (err) {
      setError("Headers must be valid JSON.");
      return null;
    }
  }

  function getCompiledAuthHeaders(type, config, customRows, valFn) {
    if (type === "none") return {};
    if (type === "bearer" && config.bearer?.token) {
      return { "Authorization": `Bearer ${valFn(config.bearer.token)}` };
    }
    if (type === "basic" && (config.basic?.username || config.basic?.password)) {
      const creds = `${valFn(config.basic.username)}:${valFn(config.basic.password)}`;
      return { "Authorization": `Basic ${btoa(creds)}` };
    }
    if (type === "api_key" && config.api_key?.add_to === "header" && config.api_key?.key) {
      return { [valFn(config.api_key.key)]: valFn(config.api_key.value) };
    }
    if (type === "custom") {
      return customRows
        .filter((row) => row.key && row.enabled !== false)
        .reduce((acc, row) => ({ ...acc, [valFn(row.key)]: valFn(row.value) }), {});
    }
    return {};
  }

  function getCompiledAuthParams(type, config, valFn) {
    if (type === "api_key" && config.api_key?.add_to === "query" && config.api_key?.key) {
      return { [valFn(config.api_key.key)]: valFn(config.api_key.value) };
    }
    return {};
  }

  function getActiveCollection() {
    if (!Array.isArray(collections) || collections.length === 0) return null;
    return collections.find((col) => col.id === activeCollectionId) || collections[0];
  }

  function addCollection() {
    const id = `col-${Date.now()}`;
    const next = { id, name: `Collection ${collections.length + 1}`, items: [] };
    setCollections((prev) => [...prev, next]);
    setActiveCollectionId(id);
  }

  function duplicateCollection(collectionId) {
    const colToCopy = collections.find(c => c.id === collectionId);
    if (!colToCopy) return;

    const deepCloneWithNewIds = (item) => {
      const cloned = JSON.parse(JSON.stringify(item));
      const recreateIds = (node) => {
        if (node.type === "folder") node.id = `fld-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        else if (node.type === "request") node.id = `req-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        if (node.items) node.items.forEach(recreateIds);
      };
      if (cloned.items) cloned.items.forEach(recreateIds);
      return cloned;
    };

    const cloned = deepCloneWithNewIds(colToCopy);
    cloned.id = `col-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    cloned.name = `${cloned.name} Copy`;

    setCollections(prev => [...prev, cloned]);
    setActiveCollectionId(cloned.id);
  }

  function exportCollection(collectionId) {
    const colToExport = collections.find(c => c.id === collectionId);
    if (!colToExport) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(colToExport, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `${colToExport.name || "export"}.json`);
    dlAnchorElem.click();
    dlAnchorElem.remove();
  }

  function parseImportData(imported) {
    let collection = null;

    if (imported.meta && imported.meta.format === "httpie") {
      const colId = `col-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      collection = {
        id: colId,
        name: imported.entry?.name || "HTTPie Import",
        items: []
      };

      const requests = imported.entry?.requests || [];

      requests.forEach((req, idx) => {
        const parts = (req.name || `Request ${idx}`).split(' / ').map(p => p.trim());
        // Only treat it as folders if there's an overarching collection name matches the first part
        if (parts.length > 1 && parts[0] === collection.name) {
          parts.shift(); // Remove the root collection name from the folders path
        }

        const reqName = parts.pop();

        let currentItems = collection.items;
        parts.forEach(part => {
          let found = currentItems.find(i => i.type === "folder" && i.name === part);
          if (!found) {
            found = {
              type: "folder",
              id: `fld-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
              name: part,
              items: []
            };
            currentItems.push(found);
          }
          currentItems = found.items;
        });

        const parsedReq = {
          type: "request",
          id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          name: reqName,
          method: req.method || "GET",
          url: req.url || "",
          headersRows: (req.headers || []).map(h => ({ key: h.name, value: h.value, enabled: true })),
          paramsRows: (req.queryParams || []).map(q => ({ key: q.name, value: q.value, enabled: true })),
          authRows: [{ key: "", value: "", enabled: false }],
          bodyRows: [{ key: "", value: "", enabled: true }]
        };

        if (req.body?.type === "text" && req.body?.text?.value) {
          parsedReq.bodyType = "json";
          parsedReq.bodyText = req.body.text.value;
        }
        if (req.body?.type === "form" && req.body?.form?.fields?.length > 0) {
          parsedReq.bodyType = "form";
          parsedReq.bodyRows = req.body.form.fields.map(f => ({ key: f.name, value: f.value, enabled: true }));
        }

        if (parsedReq.headersRows.length === 0) parsedReq.headersRows = [{ key: "", value: "", enabled: true }];
        if (parsedReq.paramsRows.length === 0) parsedReq.paramsRows = [{ key: "", value: "", enabled: true }];

        currentItems.push(parsedReq);
      });
    } else if (imported.info && imported.info.schema && imported.info.schema.includes("postman.com/json/collection/v2.1.0")) {
      const colId = `col-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      collection = {
        id: colId,
        name: imported.info.name || "Postman Import",
        items: []
      };

      const parsePostmanItem = (pmItem) => {
        if (pmItem.item) {
          return {
            type: "folder",
            id: `fld-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            name: pmItem.name || "Imported Folder",
            items: pmItem.item.map(parsePostmanItem).filter(Boolean)
          };
        } else if (pmItem.request) {
          const pmReq = pmItem.request;
          const parsedReq = {
            type: "request",
            id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            name: pmItem.name || "Imported Request",
            method: pmReq.method || "GET",
            url: typeof pmReq.url === 'string' ? pmReq.url : (pmReq.url?.raw || ""),
            headersRows: (pmReq.header || []).map(h => ({ key: h.key, value: h.value, enabled: true })),
            paramsRows: (pmReq.url?.query || []).map(q => ({ key: q.key, value: q.value, enabled: true })),
            authRows: [{ key: "", value: "", enabled: false }],
            bodyRows: [{ key: "", value: "", enabled: true }]
          };

          if (pmReq.body) {
            const mode = pmReq.body.mode;
            if (mode === 'raw') {
              parsedReq.bodyType = "json";
              parsedReq.bodyText = pmReq.body.raw || "";
            } else if (mode === 'urlencoded') {
              parsedReq.bodyType = "form";
              parsedReq.bodyRows = (pmReq.body.urlencoded || []).map(p => ({ key: p.key, value: p.value, enabled: true }));
            } else if (mode === 'formdata') {
              parsedReq.bodyType = "multipart";
              parsedReq.bodyRows = (pmReq.body.formdata || []).map(p => ({ key: p.key, value: p.value, enabled: true }));
            }
          }

          if (parsedReq.headersRows.length === 0) parsedReq.headersRows = [{ key: "", value: "", enabled: true }];
          if (parsedReq.paramsRows.length === 0) parsedReq.paramsRows = [{ key: "", value: "", enabled: true }];

          return parsedReq;
        }
        return null;
      };

      collection.items = (imported.item || []).map(parsePostmanItem).filter(Boolean);

    } else if (imported.id) {
      imported.id = `col-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      collection = imported;
    }

    if (!collection) return null;

    const existing = collections.find(c => c.name && collection.name && c.name.toLowerCase() === collection.name.toLowerCase());
    if (existing) {
      setImportCollisionData(collection);
      setImportCollisionNameDraft(`${collection.name} Copy`);
      setShowImportCollisionModal(true);
      return false; // False indicates it was caught by collision flow
    }

    return collection;
  }

  function handleImportCollisionSubmit() {
    if (!importCollisionData) return;
    const finalCol = { ...importCollisionData, name: importCollisionNameDraft.trim() || `${importCollisionData.name} Copy` };
    setCollections((prev) => [...prev, finalCol]);
    setActiveCollectionId(finalCol.id);
    setShowImportCollisionModal(false);
    setImportCollisionData(null);
  }

  function importCollection() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const imported = JSON.parse(event.target.result);
          const parsedCol = parseImportData(imported);
          if (parsedCol === false) return; // Handled by collision modal
          if (!parsedCol) {
            alert("Invalid collection format. Expected Commu or HTTPie format.");
            return;
          }
          setCollections((prev) => [...prev, parsedCol]);
          setActiveCollectionId(parsedCol.id);
        } catch (err) {
          alert("Failed to parse JSON file. Error: " + err.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function handleImportTextSubmit() {
    if (!importTextDraft) return;
    try {
      const imported = JSON.parse(importTextDraft);
      const parsedCol = parseImportData(imported);
      if (parsedCol === false) {
        setShowImportTextModal(false); // Hide the parent modal so the collision modal takes over
        setImportTextDraft("");
        return;
      }
      if (!parsedCol) {
        alert("Invalid collection format. Expected Commu or HTTPie format.");
        return;
      }
      setCollections((prev) => [...prev, parsedCol]);
      setActiveCollectionId(parsedCol.id);
      setShowImportTextModal(false);
      setImportTextDraft("");
    } catch (err) {
      alert("Failed to parse the provided text as JSON. Error: " + err.message);
    }
  }

  function handleImportApiSubmit() {
    if (!importApiDraft) return;
    fetch(importApiDraft)
      .then(res => res.json())
      .then(imported => {
        const parsedCol = parseImportData(imported);
        if (parsedCol === false) {
          setShowImportApiModal(false);
          setImportApiDraft("");
          return;
        }
        if (!parsedCol) {
          alert("Invalid collection format. Expected Commu or HTTPie format.");
          return;
        }
        setCollections((prev) => [...prev, parsedCol]);
        setActiveCollectionId(parsedCol.id);
        setShowImportApiModal(false);
        setImportApiDraft("");
      })
      .catch(err => {
        alert("Failed to fetch or parse the collection from the URL. Error: " + err.message);
      });
  }

  function updateCollectionName(value) {
    setCollections((prev) =>
      prev.map((col) => (col.id === activeCollectionId ? { ...col, name: value } : col))
    );
  }

  function addRequestToCollection(folderId = null) {
    const col = getActiveCollection();
    if (!col) return;
    const id = `req-${Date.now()}`;
    const name = "New Request";
    const req = {
      type: "request",
      id,
      name,
      description: "",
      tags: [],
      method: "GET",
      url: "",
      headersText: "",
      bodyText: "",
      testsPreText: "",
      testsPostText: "",
      testsInputText: "",
      bodyType: "json",
      paramsRows: [{ key: "", value: "", enabled: true }],
      headersRows: [{ key: "", value: "", enabled: true }],
      authRows: [{ key: "", value: "", enabled: false }],
      bodyRows: [{ key: "", value: "", enabled: true }]
    };

    if (!folderId) {
      const nextItems = Array.isArray(col.items) ? [...col.items, req] : [req];
      setCollections((prev) =>
        prev.map((item) => (item.id === col.id ? { ...item, items: nextItems } : item))
      );
      loadRequest(req);
      setEditingRequestId(req.id);
      setRequestNameDraft(req.name);
      return;
    }

    const insertIntoFolder = (items) => {
      return items.map(item => {
        if (item.type === "folder") {
          if (item.id === folderId) {
            return { ...item, items: [...(item.items || []), req] };
          }
          return { ...item, items: insertIntoFolder(item.items || []) };
        }
        return item;
      });
    };

    setCollections((prev) =>
      prev.map((item) => (item.id === col.id ? { ...item, items: insertIntoFolder(item.items || []) } : item))
    );
    loadRequest(req);
    setEditingRequestId(req.id);
    setRequestNameDraft(req.name);
  }

  function loadRequest(req) {
    if (!req) return;
    setRequestName(req.name || "New Request");
    setCurrentRequestId(req.id || "");
    setMethod(req.method || "GET");
    setUrl(req.url || "");
    setHeadersText(req.headersText || "");
    setBodyText(req.bodyText || "");
    setTestsPreText(req.testsPreText || "");
    setTestsPostText(req.testsPostText || "");
    setTestsInputText(req.testsInputText || "{\n  \"status\": 200,\n  \"body\": {\"ok\": true}\n}");
    setBodyType(req.bodyType || "json");
    setParamsRows(req.paramsRows || [{ key: "", value: "", enabled: true }]);
    setHeadersRows(req.headersRows || [{ key: "", value: "", enabled: true }]);
    setAuthRows(req.authRows || [{ key: "", value: "", enabled: false }]);

    // Backward compatibility for existing payloads
    if (req.authType) {
      setAuthType(req.authType);
    } else {
      const hasActiveAuth = req.authRows && req.authRows.some(r => r.key && r.enabled);
      setAuthType(hasActiveAuth ? "custom" : "none");
    }

    setAuthConfig(req.authConfig || {
      bearer: { token: "" },
      basic: { username: "", password: "" },
      api_key: { key: "", value: "", add_to: "header" }
    });

    setBodyRows(req.bodyRows || [{ key: "", value: "", enabled: true }]);
  }

  function updateRequestState(requestId, field, value) {
    const updateItems = (items) =>
      items.map((item) => {
        if (item.type === "folder") {
          return { ...item, items: updateItems(item.items || []) };
        }
        if (item.type === "request" && item.id === requestId) {
          return { ...item, [field]: value };
        }
        return item;
      });
    setCollections((prev) =>
      prev.map((col) =>
        col.id === activeCollectionId ? { ...col, items: updateItems(col.items || []) } : col
      )
    );
  }

  function updateRequestName(requestId, name) {
    updateRequestState(requestId, "name", name);
  }

  function updateRequestMethod(requestId, method) {
    updateRequestState(requestId, "method", method);
  }

  function deleteRequest(requestId) {
    const filterItems = (items) =>
      items
        .filter((item) => !(item.type === "request" && item.id === requestId))
        .map((item) => {
          if (item.type === "folder") {
            return { ...item, items: filterItems(item.items || []) };
          }
          return item;
        });
    setCollections((prev) =>
      prev.map((col) =>
        col.id === activeCollectionId ? { ...col, items: filterItems(col.items || []) } : col
      )
    );
  }

  function addFolderToCollection(parentFolderId = null) {
    const col = getActiveCollection();
    if (!col) return;
    const id = `fld-${Date.now()}`;
    const folder = { type: "folder", id, name: "New Folder", items: [] };

    if (!parentFolderId) {
      const nextItems = Array.isArray(col.items) ? [...col.items, folder] : [folder];
      setCollections((prev) =>
        prev.map((item) => (item.id === col.id ? { ...item, items: nextItems } : item))
      );
    } else {
      const insertIntoFolder = (items) => {
        return items.map(item => {
          if (item.type === "folder") {
            if (item.id === parentFolderId) {
              return { ...item, items: [...(item.items || []), folder] };
            }
            return { ...item, items: insertIntoFolder(item.items || []) };
          }
          return item;
        });
      };

      setCollections((prev) =>
        prev.map((item) => (item.id === col.id ? { ...item, items: insertIntoFolder(item.items || []) } : item))
      );
    }

    // Auto-enter edit mode for the newly created folder
    setEditingFolderId(id);
    setFolderNameDraft("New Folder");
  }

  function updateFolderName(folderId, name) {
    const updateItems = (items) =>
      items.map((item) => {
        if (item.type === "folder") {
          if (item.id === folderId) {
            return { ...item, name };
          }
          return { ...item, items: updateItems(item.items || []) };
        }
        return item;
      });
    setCollections((prev) =>
      prev.map((col) =>
        col.id === activeCollectionId ? { ...col, items: updateItems(col.items || []) } : col
      )
    );
  }

  function deleteFolder(folderId) {
    const filterItems = (items) =>
      items
        .filter((item) => !(item.type === "folder" && item.id === folderId))
        .map((item) => {
          if (item.type === "folder") {
            return { ...item, items: filterItems(item.items || []) };
          }
          return item;
        });
    setCollections((prev) =>
      prev.map((col) =>
        col.id === activeCollectionId ? { ...col, items: filterItems(col.items || []) } : col
      )
    );
  }

  function getAllFolders(items, depth = 0, prefix = "") {
    let folders = [];
    if (!items) return folders;
    for (const item of items) {
      if (item.type === "folder") {
        const fullPath = prefix ? `${prefix} / ${item.name}` : item.name;
        folders.push({ id: item.id, name: fullPath, depth });
        if (Array.isArray(item.items)) {
          folders = folders.concat(getAllFolders(item.items, depth + 1, fullPath));
        }
      }
    }
    return folders;
  }

  function moveItemInCollection(sourceId, targetId, isTargetFolder) {
    if (sourceId === targetId) return;

    setCollections(prev => prev.map(col => {
      if (col.id !== activeCollectionId) return col;

      const clonedCol = JSON.parse(JSON.stringify(col));
      let itemToMove = null;

      const findAndRemove = (arr) => {
        for (let i = 0; i < arr.length; i++) {
          if (arr[i].id === sourceId) {
            itemToMove = arr.splice(i, 1)[0];
            return true;
          }
          if (arr[i].type === "folder" && arr[i].items) {
            if (findAndRemove(arr[i].items)) return true;
          }
        }
        return false;
      };

      findAndRemove(clonedCol.items);

      if (!itemToMove) return col;

      if (itemToMove.type === "folder" && isTargetFolder) {
        let isTargetDescendant = false;
        const checkDescendant = (arr) => {
          if (!arr) return;
          for (const child of arr) {
            if (child.id === targetId) isTargetDescendant = true;
            if (child.type === "folder") checkDescendant(child.items);
          }
        };
        checkDescendant(itemToMove.items);
        if (isTargetDescendant) return col;
      }

      if (!targetId) {
        clonedCol.items.push(itemToMove);
      } else {
        let inserted = false;
        const insertItem = (arr) => {
          if (inserted) return;
          for (let i = 0; i < arr.length; i++) {
            if (arr[i].id === targetId) {
              if (isTargetFolder) {
                if (!arr[i].items) arr[i].items = [];
                arr[i].items.push(itemToMove);
              } else {
                arr.splice(i + 1, 0, itemToMove);
              }
              inserted = true;
              return;
            }
            if (arr[i].type === "folder" && arr[i].items) {
              insertItem(arr[i].items);
            }
          }
        };
        insertItem(clonedCol.items);

        if (!inserted) clonedCol.items.push(itemToMove);
      }

      return clonedCol;
    }));
  }

  function duplicateItem(itemId) {
    const recreateIds = (node) => {
      if (node.type === "folder") node.id = `fld-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      else if (node.type === "request") node.id = `req-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      if (node.items) node.items.forEach(recreateIds);
    };

    const duplicateInArray = (items) => {
      const idx = items.findIndex(i => i.id === itemId);
      if (idx !== -1) {
        const cloned = JSON.parse(JSON.stringify(items[idx]));
        recreateIds(cloned);
        cloned.name = `${cloned.name} Copy`;
        const newItems = [...items];
        newItems.splice(idx + 1, 0, cloned);
        return { modified: true, items: newItems };
      }

      let modified = false;
      const newItems = items.map(item => {
        if (item.type === "folder") {
          const res = duplicateInArray(item.items || []);
          if (res.modified) {
            modified = true;
            return { ...item, items: res.items };
          }
        }
        return item;
      });
      return { modified, items: newItems };
    };

    setCollections((prev) =>
      prev.map((col) => {
        if (col.id === activeCollectionId) {
          const res = duplicateInArray(col.items || []);
          if (res.modified) {
            return { ...col, items: res.items };
          }
        }
        return col;
      })
    );
  }

  function exportCollection(collectionOrFolderId) {
    const coll = getActiveCollection();
    if (!coll) return;

    let rootNode = null;
    if (coll.id === collectionOrFolderId) {
      rootNode = coll;
    } else {
      const traverse = (items) => {
        for (let item of items) {
          if (item.id === collectionOrFolderId) return item;
          if (item.type === "folder" && item.items) {
            const res = traverse(item.items);
            if (res) return res;
          }
        }
        return null;
      };
      rootNode = traverse(coll.items);
    }
    if (!rootNode) return;

    const allIds = new Set();
    const collectIds = (node) => {
      allIds.add(node.id);
      if (node.items) node.items.forEach(collectIds);
    };
    collectIds(rootNode);

    setExportTargetNode(rootNode);
    setExportSelections(allIds);
    setShowExportModal(true);
  }

  function getExportPayload() {
    if (!exportTargetNode) return { jsonStr: "", fileName: "export.json" };

    const translateNode = (node) => {
      if (!exportSelections.has(node.id)) return null;

      if (node.type === "folder" || (node.id === exportTargetNode.id && node.id.startsWith("col-"))) {
        const children = (node.items || []).map(translateNode).filter(Boolean);
        if (node.id === exportTargetNode.id && node.id.startsWith("col-")) {
          return children;
        }
        return {
          name: node.name,
          item: children
        };
      }
      if (node.type === "request") {
        // If exportInterpolate is true, leave placeholders intact. If false, evaluate them using interpolate()
        const val = (v) => exportInterpolate ? String(v) : interpolate(String(v));

        let pmReqUrl = node.url ? val(node.url) : "";
        const pmReqMethod = node.method || "GET";
        const pmHeaders = (node.headersRows || []).filter(h => h.key && h.enabled !== false).map(h => ({
          key: val(h.key),
          value: val(h.value)
        }));
        const pmParams = (node.paramsRows || []).filter(p => p.key && p.enabled !== false).map(p => ({
          key: val(p.key),
          value: val(p.value)
        }));

        const type = node.authType || "none";
        const config = node.authConfig || {};
        const cRows = node.authRows || [];
        const authP = getCompiledAuthParams(type, config, val);
        Object.entries(authP).forEach(([k, v]) => {
          pmParams.push({ key: k, value: v });
        });
        const authH = getCompiledAuthHeaders(type, config, cRows, val);
        Object.entries(authH).forEach(([k, v]) => {
          pmHeaders.push({ key: k, value: v });
        });

        const urlObject = { raw: pmReqUrl };
        try {
          if (pmReqUrl.includes("://")) {
            const u = new URL(pmReqUrl);
            urlObject.protocol = u.protocol.replace(':', '');
            urlObject.host = u.hostname.split('.');
            urlObject.port = u.port || undefined;
            urlObject.path = u.pathname.split('/').filter(Boolean);
            urlObject.query = pmParams;
          } else {
            urlObject.host = pmReqUrl.split('.');
            urlObject.query = pmParams;
          }
        } catch (e) { /* ignore parse errors, keep raw */ }

        let bodyMode = "raw";
        let bodyOptions = {};
        if (node.bodyType === "json") { bodyOptions = { raw: { language: "json" } }; }
        else if (node.bodyType === "form") { bodyMode = "urlencoded"; }
        else if (node.bodyType === "multipart") { bodyMode = "formdata"; }

        const pmReqBody = { mode: bodyMode };
        if (bodyMode === "raw") {
          if (node.bodyText) pmReqBody.raw = val(node.bodyText);
          pmReqBody.options = bodyOptions;
        }
        if (bodyMode === "urlencoded") {
          pmReqBody.urlencoded = (node.bodyRows || []).filter(r => r.key && r.enabled !== false).map(r => ({
            key: val(r.key),
            value: val(r.value),
            type: "text"
          }));
        }
        if (bodyMode === "formdata") {
          pmReqBody.formdata = (node.bodyRows || []).filter(r => r.key && r.enabled !== false).map(r => ({
            key: val(r.key),
            value: val(r.value),
            type: "text"
          }));
        }

        return {
          name: node.name,
          request: {
            method: pmReqMethod,
            header: pmHeaders,
            body: Object.keys(pmReqBody).length > 1 || pmReqBody.raw ? pmReqBody : undefined,
            url: urlObject
          },
          response: []
        };
      }
      return null;
    };

    let postmanItems = [];
    if (exportTargetNode.id.startsWith("col-")) {
      const translated = translateNode(exportTargetNode);
      if (Array.isArray(translated)) postmanItems = translated;
    } else {
      const translated = translateNode(exportTargetNode);
      if (translated) postmanItems = [translated];
    }

    const exportData = {
      info: {
        name: exportTargetNode.name || "Commu Collection",
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
      },
      item: postmanItems
    };

    return {
      jsonStr: JSON.stringify(exportData, null, 2),
      fileName: `${exportTargetNode.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_collection.json`
    };
  }

  function renderExportTree(node, depth = 0) {
    if (!node) return null;

    // Auto-selection check for folders: if all children are selected, parent is considered selected
    const isNodeSelected = (n) => {
      if (n.type === "request") return exportSelections.has(n.id);
      if (!n.items || n.items.length === 0) return exportSelections.has(n.id);
      return n.items.every(child => isNodeSelected(child));
    };

    const isSelected = isNodeSelected(node);

    const toggle = () => {
      const next = new Set(exportSelections);
      if (isSelected) {
        // Uncheck self and all children
        const removeIds = (n) => { next.delete(n.id); if (n.items) n.items.forEach(removeIds); };
        removeIds(node);
      } else {
        // Check self and all children
        const addIds = (n) => { next.add(n.id); if (n.items) n.items.forEach(addIds); };
        addIds(node);
      }
      setExportSelections(next);
    };

    if (node.type === "folder" || node.id.startsWith("col-")) {
      const isCollapsed = exportCollapsedFolders.has(node.id);
      const toggleCollapse = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = new Set(exportCollapsedFolders);
        if (isCollapsed) next.delete(node.id);
        else next.add(node.id);
        setExportCollapsedFolders(next);
      };

      return (
        <div key={node.id} style={{ marginLeft: depth > 0 ? '16px' : '0', marginBottom: '8px' }}>
          <div className="export-row" style={{ borderBottom: 'none', padding: '4px 0' }}>

            <button
              className="ghost icon-button compact"
              style={{ width: '20px', height: '20px', padding: 0, marginRight: '4px', transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.2s' }}
              onClick={toggleCollapse}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>

            <label>
              <input type="checkbox" checked={isSelected} onChange={toggle} />
              <span style={{ fontWeight: '500', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                {node.name}
              </span>
            </label>
          </div>
          {!isCollapsed && node.items && node.items.length > 0 && (
            <div style={{ paddingLeft: '8px', borderLeft: '1px solid rgba(255,255,255,0.05)' }}>
              {node.items.map(child => renderExportTree(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    const methodColorClass = node.method ? node.method.toLowerCase() : 'get';

    return (
      <div key={node.id} style={{ marginLeft: depth > 0 ? '16px' : '0' }} className="export-row">
        <label>
          <input type="checkbox" checked={isSelected} onChange={toggle} />
          <span className={`export-badge ${methodColorClass}`}>{node.method || 'GET'}</span>
          <span className="export-title" title={node.name}>{node.name}</span>
        </label>
        <div className="export-tags">
          {node.bodyType && node.bodyType !== "none" && (
            <span className="export-tag green">Body</span>
          )}
          {((node.authType && node.authType !== "none") || (!node.authType && node.authRows && node.authRows.some(a => a.key && a.enabled))) && (
            <span className="export-tag">Auth</span>
          )}
        </div>
      </div>
    );
  }

  function matchesQuery(item, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    if (item.type === "folder") {
      return item.name?.toLowerCase().includes(q) || (item.items || []).some((child) => matchesQuery(child, query));
    }
    if (item.type === "request") {
      const tagMatch = Array.isArray(item.tags) && item.tags.some((tag) => tag.toLowerCase().includes(q));
      return (
        item.name?.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q) ||
        tagMatch
      );
    }
    return false;
  }

  function renderCollectionItems(items, depth = 0) {
    if (!Array.isArray(items)) return null;
    const filtered = items.filter((item) => matchesQuery(item, topSearch));
    const folders = filtered.filter((item) => item.type === "folder");
    const requests = filtered.filter((item) => item.type === "request");
    return [
      ...folders.map((item) => {
        if (item.type === "folder") {
          return (
            <div
              className="tree-node"
              key={item.id}
              draggable
              onDragStart={(e) => {
                e.stopPropagation();
                setDraggedItemId(item.id);
                e.dataTransfer.setData("text/plain", item.id);
                if (!collapsedFolders.has(item.id)) {
                  setCollapsedFolders(prev => new Set(prev).add(item.id));
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (draggedItemId !== item.id && dragOverItemId !== item.id) {
                  setDragOverItemId(item.id);
                }
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (dragOverItemId === item.id) setDragOverItemId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOverItemId(null);
                setDraggedItemId(null);
                const sourceId = e.dataTransfer.getData("text/plain");
                if (sourceId) moveItemInCollection(sourceId, item.id, true);
              }}
              onDragEnd={() => {
                setDraggedItemId(null);
                setDragOverItemId(null);
              }}
            >
              <div className={`tree-folder ${dragOverItemId === item.id ? 'drag-over' : ''} ${draggedItemId === item.id ? 'dragging' : ''}`}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, minWidth: 0 }}>
                  <button
                    className="ghost icon-button icon-plain"
                    style={{ padding: '0 4px', fontSize: '0.65rem', color: 'var(--muted)', width: '20px' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCollapsedFolders(prev => {
                        const next = new Set(prev);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        return next;
                      });
                    }}
                  >
                    {collapsedFolders.has(item.id) ? '▶' : '▼'}
                  </button>
                  {editingFolderId === item.id ? (
                    <input
                      autoFocus
                      className="input compact"
                      value={folderNameDraft}
                      onChange={(e) => setFolderNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || (e.ctrlKey && e.key.toLowerCase() === "s")) {
                          updateFolderName(item.id, folderNameDraft.trim() || item.name);
                          setEditingFolderId("");
                          setFolderNameDraft("");
                        }
                      }}
                      onBlur={() => {
                        updateFolderName(item.id, folderNameDraft.trim() || item.name);
                        setEditingFolderId("");
                        setFolderNameDraft("");
                      }}
                    />
                  ) : (
                    <button
                      className="ghost folder-name"
                      onDoubleClick={() => {
                        setEditingFolderId(item.id);
                        setFolderNameDraft(item.name);
                      }}
                    >
                      {item.name}
                    </button>
                  )}
                </div>
                <div className="menu-wrap">
                  <button
                    className="ghost icon-button icon-plain"
                    onClick={() => setOpenFolderMenuId((prev) => (prev === item.id ? "" : item.id))}
                    aria-label="Folder options"
                  >
                    ⋮
                  </button>
                  {openFolderMenuId === item.id && (
                    <div className="menu">
                      <button
                        className="ghost"
                        onClick={() => {
                          setEditingFolderId(item.id);
                          setFolderNameDraft(item.name);
                          setOpenFolderMenuId("");
                        }}
                      >
                        Rename
                      </button>
                      <button
                        className="ghost"
                        onClick={() => {
                          duplicateItem(item.id);
                          setOpenFolderMenuId("");
                        }}
                      >
                        Duplicate
                      </button>
                      <button
                        className="ghost"
                        onClick={() => {
                          setItemToMove(item);
                          setMoveTargetId("root");
                          setShowMoveModal(true);
                          setOpenFolderMenuId("");
                        }}
                      >
                        Move
                      </button>
                      <button
                        className="ghost"
                        onClick={() => {
                          deleteFolder(item.id);
                          setOpenFolderMenuId("");
                        }}
                      >
                        Delete
                      </button>
                      <button
                        className="ghost"
                        onClick={() => {
                          exportCollection(item.id);
                          setOpenFolderMenuId("");
                        }}
                      >
                        Export
                      </button>
                      <button
                        className="ghost"
                        onClick={() => {
                          addFolderToCollection(item.id);
                          setOpenFolderMenuId("");
                        }}
                      >
                        Create Folder
                      </button>
                      <button
                        className="ghost"
                        onClick={() => {
                          addRequestToCollection(item.id);
                          setOpenFolderMenuId("");
                        }}
                      >
                        Create Request
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {!collapsedFolders.has(item.id) && (
                <div className="tree-children">{renderCollectionItems(item.items, depth + 1)}</div>
              )}
            </div>
          );
        }
        return null;
      }),
      ...(requests.length
        ? requests.map((item) => (
          <div
            className="tree-node"
            key={item.id}
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              setDraggedItemId(item.id);
              e.dataTransfer.setData("text/plain", item.id);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (draggedItemId !== item.id && dragOverItemId !== item.id) {
                setDragOverItemId(item.id);
              }
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (dragOverItemId === item.id) setDragOverItemId(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOverItemId(null);
              setDraggedItemId(null);
              const sourceId = e.dataTransfer.getData("text/plain");
              if (sourceId) moveItemInCollection(sourceId, item.id, false);
            }}
            onDragEnd={() => {
              setDraggedItemId(null);
              setDragOverItemId(null);
            }}
          >
            <div className={`tree-request ${dragOverItemId === item.id ? 'drag-over' : ''} ${draggedItemId === item.id ? 'dragging' : ''}`} onClick={() => loadRequest(item)}>
              <div className="tree-request-header">
                <span className={`badge method-${item.method}`}>{item.method}</span>
                {editingRequestId === item.id ? (
                  <input
                    autoFocus
                    className="input compact"
                    value={requestNameDraft}
                    onChange={(e) => setRequestNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || (e.ctrlKey && e.key.toLowerCase() === "s")) {
                        updateRequestName(item.id, requestNameDraft.trim() || item.name);
                        setEditingRequestId("");
                        setRequestNameDraft("");
                      }
                    }}
                    onBlur={() => {
                      updateRequestName(item.id, requestNameDraft.trim() || item.name);
                      setEditingRequestId("");
                      setRequestNameDraft("");
                    }}
                  />
                ) : (
                  <button
                    className="ghost tree-title"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingRequestId(item.id);
                      setRequestNameDraft(item.name);
                    }}
                  >
                    {item.name}
                  </button>
                )}
                <div className="menu-wrap">
                  <button
                    className="ghost icon-button icon-plain"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenFolderMenuId((prev) => (prev === item.id ? "" : item.id));
                    }}
                    aria-label="Request options"
                  >
                    ⋮
                  </button>
                  {openFolderMenuId === item.id && (
                    <div className="menu">
                      <button
                        className="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingRequestId(item.id);
                          setRequestNameDraft(item.name);
                          setOpenFolderMenuId("");
                        }}
                      >
                        Rename
                      </button>
                      <button
                        className="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          duplicateItem(item.id);
                          setOpenFolderMenuId("");
                        }}
                      >
                        Duplicate
                      </button>
                      <button
                        className="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setItemToMove(item);
                          setMoveTargetId("root");
                          setShowMoveModal(true);
                          setOpenFolderMenuId("");
                        }}
                      >
                        Move
                      </button>
                      <button
                        className="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteRequest(item.id);
                          setOpenFolderMenuId("");
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {item.description && <div className="tree-desc">{item.description}</div>}
              {Array.isArray(item.tags) && item.tags.length > 0 && (
                <div className="tree-tags">
                  {item.tags.map((tag) => (
                    <span className="tag" key={`${item.id}-${tag}`}>{tag}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))
        : [])
    ];
  }

  function getActiveEnv() {
    if (!Array.isArray(environments) || environments.length === 0) return null;
    return environments.find((env) => env.id === activeEnvId) || environments[0];
  }

  function getEnvVars() {
    const env = getActiveEnv();
    if (!env) return {};
    return env.vars
      .filter((row) => row.key && row.enabled !== false)
      .reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
  }

  function handleUpdateEnvVar(key, newValue) {
    if (!activeEnvId) return;
    setEnvironments((prev) => prev.map(env => {
      if (env.id !== activeEnvId) return env;
      const existing = env.vars.find(v => v.key === key);
      let updatedVars;
      if (existing) {
        updatedVars = env.vars.map(v => v.key === key ? { ...v, value: newValue } : v);
      } else {
        updatedVars = [...env.vars, { key, value: newValue, comment: "", enabled: true }];
      }
      return { ...env, vars: updatedVars };
    }));
  }

  function interpolate(value) {
    if (typeof value !== "string") return value;
    const vars = getEnvVars();
    return value.replace(/\{\{(.*?)\}\}/g, (_match, key) => {
      const trimmed = String(key).trim();
      return Object.prototype.hasOwnProperty.call(vars, trimmed) ? vars[trimmed] : "";
    });
  }

  function rowsToObject(rows, interpolateValues = true) {
    const val = (v) => interpolateValues ? interpolate(v) : v;
    return rows
      .filter((row) => row.key && row.enabled !== false)
      .reduce((acc, row) => ({ ...acc, [val(row.key)]: val(row.value) }), {});
  }

  function objectToRows(obj) {
    if (!obj || typeof obj !== "object") return [{ key: "", value: "", enabled: true }];
    return Object.entries(obj).map(([key, value]) => ({
      key,
      value: typeof value === "string" ? value : JSON.stringify(value),
      enabled: true
    }));
  }

  function setContentType(type) {
    const map = {
      json: "application/json",
      xml: "application/xml",
      form: "application/x-www-form-urlencoded",
      multipart: "multipart/form-data",
      raw: "text/plain"
    };
    const next = headersRows.map((row) => {
      if (row.key.toLowerCase() === "content-type") {
        return { ...row, value: map[type] || row.value, enabled: true };
      }
      return row;
    });
    if (!next.find((row) => row.key.toLowerCase() === "content-type")) {
      next.push({ key: "Content-Type", value: map[type] || "application/json", enabled: true });
    }
    setHeadersRows(next);
    setHeadersText(JSON.stringify(rowsToObject(next), null, 2));
  }

  function stripJsonComments(text) {
    return text
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
  }

  function buildUrlWithParams(interpolateValues = true) {
    const val = (v) => interpolateValues ? interpolate(v) : v;
    let base = val(url || "");

    // Fix missing slash between a port and the path (e.g. http://localhost:8080api -> http://localhost:8080/api)
    // Only insert a slash if the port is immediately followed by a letter or valid path character, not a number (to prevent breaking port 8080 into 808/0)
    base = base.replace(/^(https?:\/\/[a-zA-Z0-9.-]+:\d+)([a-zA-Z_\-~])/i, "$1/$2");

    const activeParams = [...(paramsRows || [])];

    // Inject API Key into query if configured
    const authParams = getCompiledAuthParams(authType, authConfig, val);
    Object.entries(authParams).forEach(([k, v]) => {
      activeParams.push({ key: k, value: v, enabled: true });
    });

    if (!activeParams.length) return base;
    const query = activeParams
      .filter((row) => row.key && row.enabled !== false)
      .map((row) => `${encodeURIComponent(val(row.key))}=${encodeURIComponent(val(row.value || ""))}`)
      .join("&");
    if (!query) return base;
    return base.includes("?") ? `${base}&${query}` : `${base}?${query}`;
  }

  function generateSnippet() {
    const val = (v) => snippetInterpolate ? v : interpolate(v);
    const reqMethod = method || "GET";
    const reqUrl = buildUrlWithParams(!snippetInterpolate);

    const activeHeaders = headersRows.filter(r => r.key && r.enabled !== false);
    const headerObj = {};
    activeHeaders.forEach(r => { headerObj[val(r.key)] = val(r.value); });

    const authHeaders = getCompiledAuthHeaders(authType, authConfig, authRows, val);
    Object.entries(authHeaders).forEach(([k, v]) => {
      headerObj[k] = v;
    });

    let reqBody = bodyText;
    if (bodyType === "json") {
      reqBody = stripJsonComments(val(bodyText));
    } else if (bodyType === "form" || bodyType === "multipart") {
      const data = rowsToObject(bodyRows, snippetInterpolate);
      reqBody = new URLSearchParams(data).toString();
    } else {
      reqBody = val(bodyText);
    }

    const snippetVars = new Set();
    const extractVars = (str) => {
      if (typeof str !== 'string') return;
      const matches = str.match(/\{\{(.*?)\}\}/g);
      if (matches) {
        matches.forEach(m => snippetVars.add(m.replace(/[{}]/g, '').trim()));
      }
    };

    if (!snippetInterpolate) {
      extractVars(reqUrl);
      extractVars(reqBody);
      Object.entries(headerObj).forEach(([k, v]) => { extractVars(k); extractVars(v); });
    }

    const varDeclarations = Array.from(snippetVars).map(v => {
      // getEnvVars() returns an array like [{key: 'baseUrl', value: 'http://...'}, ...]
      const row = getEnvVars().find(e => e.key === v);
      return { key: v, value: row ? row.value : "" };
    });

    if (snippetLanguage === "curl") {
      let curl = `curl -X ${reqMethod} '${reqUrl}'`;
      Object.entries(headerObj).forEach(([k, v]) => {
        curl += ` \\\n  -H '${k}: ${v}'`;
      });
      if (reqBody && reqMethod !== "GET") {
        curl += ` \\\n  -d '${reqBody.replace(/'/g, "'\\''")}'`;
      }
      return curl;
    }
    if (snippetLanguage === "raw") {
      let raw = `${reqMethod} ${reqUrl} HTTP/1.1\n`;
      Object.entries(headerObj).forEach(([k, v]) => {
        raw += `${k}: ${v}\n`;
      });
      if (reqBody && reqMethod !== "GET") {
        raw += `\n${reqBody}`;
      }
      return raw;
    }
    if (snippetLanguage === "python") {
      let py = `import requests\n\n`;
      if (varDeclarations.length > 0) {
        varDeclarations.forEach(v => { py += `${v.key} = "${v.value.replace(/"/g, '\\"')}"\n` });
        py += `\n`;
      }
      const pyStr = (s) => s.includes('{{') ? `f"${s.replace(/\{\{(.*?)\}\}/g, '{$1}')}"` : `"${s}"`;

      py += `url = ${pyStr(reqUrl)}\n`;
      if (Object.keys(headerObj).length > 0) {
        py += `headers = {\n`;
        Object.entries(headerObj).forEach(([k, v]) => {
          py += `    ${pyStr(k)}: ${pyStr(v.replace(/"/g, '\\"'))},\n`;
        });
        py += `}\n`;
      }
      if (reqBody && reqMethod !== "GET") {
        if (bodyType === 'json') {
          py += `\ndata = ${reqBody || "{}"}\n`; // JSON formatting is tricky with vars inside, Python handles dict natively but we have raw text
          // If we have vars inside the json text, we should probably evaluate it as an f-string
          if (reqBody.includes('{{')) {
            py = py.replace(`\ndata = ${reqBody || "{}"}\n`, `\ndata = f"""${reqBody}"""\n`);
          }
        } else {
          py += `\ndata = ${reqBody.includes('{{') ? `f"""${reqBody}"""` : `"""${reqBody}"""`}\n`;
        }
        py += `\nresponse = requests.${reqMethod.toLowerCase()}(url, headers=headers${Object.keys(headerObj).length > 0 ? '' : 'headers=None'}, data=data)\n`;
      } else {
        py += `\nresponse = requests.${reqMethod.toLowerCase()}(url, headers=headers${Object.keys(headerObj).length > 0 ? '' : 'headers=None'})\n`;
      }
      py += `\nprint(response.text)`;
      return py;
    }
    if (snippetLanguage === "node") {
      let js = ``;
      if (varDeclarations.length > 0) {
        varDeclarations.forEach(v => { js += `const ${v.key} = "${v.value.replace(/"/g, '\\"')}";\n` });
        js += `\n`;
      }
      const jsStr = (s) => s.includes('{{') ? `\`${s.replace(/\{\{(.*?)\}\}/g, '${$1}')}\`` : `"${s}"`;

      js += `const response = await fetch(${jsStr(reqUrl)}, {\n  method: "${reqMethod}",\n`;
      if (Object.keys(headerObj).length > 0) {
        js += `  headers: {\n`;
        Object.entries(headerObj).forEach(([k, v]) => {
          js += `    [${jsStr(k)}]: ${jsStr(v.replace(/"/g, '\\"'))},\n`;
        });
        js += `  },\n`;
      }
      if (reqBody && reqMethod !== "GET") {
        let jsBody = ``;
        if (bodyType === 'json') {
          jsBody = `JSON.stringify(${reqBody.includes('{{') ? `JSON.parse(\`${reqBody.replace(/\{\{(.*?)\}\}/g, '${$1}')}\`)` : (reqBody || "{}")})`;
        } else {
          jsBody = jsStr(reqBody);
        }
        js += `  body: ${jsBody}\n`;
      }
      js += `});\n\nconst data = await response.json();\nconsole.log(data);`;
      return js;
    }
    if (snippetLanguage === "c") {
      let c = `#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <curl/curl.h>\n\nint main(void) {\n`;
      if (varDeclarations.length > 0) {
        varDeclarations.forEach(v => { c += `  const char* ${v.key} = "${v.value.replace(/"/g, '\\"')}";\n` });
        c += `\n`;
      }
      // C doesn't easily interpolate URLs dynamically without snprintf. To keep it simple, we'll keep placeholders natively unless resolved.
      c += `  CURL *curl = curl_easy_init();\n  if(curl) {\n`;
      c += `    curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "${reqMethod}");\n`;
      // If interpolations exist, we fallback to static string
      c += `    curl_easy_setopt(curl, CURLOPT_URL, "${reqUrl}");\n`;
      if (Object.keys(headerObj).length > 0) {
        c += `    struct curl_slist *headers = NULL;\n`;
        Object.entries(headerObj).forEach(([k, v]) => {
          c += `    headers = curl_slist_append(headers, "${k}: ${v.replace(/"/g, '\\"')}");\n`;
        });
        c += `    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);\n`;
      }
      if (reqBody && reqMethod !== "GET") {
        c += `    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, "${reqBody.replace(/"/g, '\\"').replace(/\n/g, '\\n')}");\n`;
      }
      c += `    CURLcode res = curl_easy_perform(curl);\n    curl_easy_cleanup(curl);\n  }\n  return 0;\n}`;
      return c;
    }
    if (snippetLanguage === "csharp") {
      let cs = `using System;\nusing System.Net.Http;\nusing System.Threading.Tasks;\n\nclass Program\n{\n    static async Task Main()\n    {\n`;
      if (varDeclarations.length > 0) {
        varDeclarations.forEach(v => { cs += `        var ${v.key} = "${v.value.replace(/"/g, '\\"')}";\n` });
        cs += `\n`;
      }
      const csStr = (s) => s.includes('{{') ? `$"${s.replace(/\{\{(.*?)\}\}/g, '{$1}')}"` : `"${s}"`;

      cs += `        var client = new HttpClient();\n        var request = new HttpRequestMessage(new HttpMethod("${reqMethod}"), ${csStr(reqUrl)});\n`;
      Object.entries(headerObj).forEach(([k, v]) => {
        if (k.toLowerCase() !== 'content-type') {
          cs += `        request.Headers.Add(${csStr(k)}, ${csStr(v.replace(/"/g, '\\"'))});\n`;
        }
      });
      if (reqBody && reqMethod !== "GET") {
        let cType = headerObj['Content-Type'] || headerObj['content-type'] || 'text/plain';
        cs += `        request.Content = new StringContent(${csStr(reqBody.replace(/"/g, '\\"').replace(/\n/g, '\\n'))}, System.Text.Encoding.UTF8, "${cType}");\n`;
      }
      cs += `        var response = await client.SendAsync(request);\n        response.EnsureSuccessStatusCode();\n        Console.WriteLine(await response.Content.ReadAsStringAsync());\n    }\n}`;
      return cs;
    }
    if (snippetLanguage === "go") {
      let go = `package main\n\nimport (\n\t"fmt"\n\t"io/ioutil"\n\t"net/http"\n\t"strings"\n)\n\nfunc main() {\n`;
      if (varDeclarations.length > 0) {
        varDeclarations.forEach(v => { go += `\t${v.key} := "${v.value.replace(/"/g, '\\"')}"\n` });
        go += `\n`;
      }
      // Go string interpolation requires fmt.Sprintf, keeping simple for now. 
      // User can manually interpolate or use snippetInterpolate=true
      const goStr = (s) => s.includes('{{') ? `fmt.Sprintf("${s.replace(/\{\{(.*?)\}\}/g, '%s')}", ${s.match(/\{\{(.*?)\}\}/g).map(m => m.replace(/[{}]/g, '').trim()).join(', ')})` : `"${s}"`;

      let bodyStr = `nil`;
      if (reqBody && reqMethod !== "GET") {
        if (reqBody.includes("{{")) {
          go += `\tpayloadStr := ${goStr(reqBody.replace(/`/g, '\\"'))}\n`;
          go += `\tpayload := strings.NewReader(payloadStr)\n`;
        } else {
          go += `\tpayload := strings.NewReader(\`${reqBody.replace(/`/g, '`+"`"+`')}\`)\n`;
        }
        bodyStr = `payload`;
      }
      go += `\n\treq, _ := http.NewRequest("${reqMethod}", ${goStr(reqUrl)}, ${bodyStr})\n\n`;
      Object.entries(headerObj).forEach(([k, v]) => {
        go += `\treq.Header.Add(${goStr(k)}, ${goStr(v.replace(/"/g, '\\"'))})\n`;
      });
      go += `\n\tres, _ := http.DefaultClient.Do(req)\n\tdefer res.Body.Close()\n\tbody, _ := ioutil.ReadAll(res.Body)\n\n\tfmt.Println(string(body))\n}`;
      return go;
    }
    return "";
  }

  function buildTemplatePrompt() {
    const selected = templates.find((item) => item.id === templateId);
    if (!selected) return aiPrompt;
    return `Template: ${selected.label}. ${aiPrompt || ""}`.trim();
  }

  async function handleSend() {
    setError("");
    const headers = parseHeaders();
    if (headers === null) return;
    let body = bodyText;
    if (bodyType === "json") {
      body = stripJsonComments(interpolate(bodyText));
    }
    if (bodyType === "form") {
      const data = rowsToObject(bodyRows);
      body = new URLSearchParams(data).toString();
    }
    if (bodyType === "multipart") {
      const data = rowsToObject(bodyRows);
      body = new URLSearchParams(data).toString();
    }
    if (bodyType === "xml") {
      body = interpolate(bodyText);
    }
    if (bodyType === "raw") {
      body = interpolate(bodyText);
    }
    const payload = {
      method,
      url: buildUrlWithParams(),
      headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, interpolate(v)])),
      body
    };

    const preOutput = [];
    const preContext = {
      request: {
        method: payload.method,
        url: payload.url,
        headers: { ...payload.headers },
        body: payload.body,
        params: rowsToObject(paramsRows)
      },
      response: null
    };
    runScript(testsPreText, preContext, preOutput);
    payload.method = preContext.request.method || payload.method;
    payload.url = preContext.request.url || payload.url;
    payload.headers = preContext.request.headers || payload.headers;
    payload.body = preContext.request.body ?? payload.body;
    if (preOutput.length) {
      setTestsOutput(preOutput.join("\n"));
      setShowTestOutput(true);
    }

    const result = await window.api.sendRequest(payload);

    if (result.error) {
      setError(result.error);
    }

    setResponse(result);
    const summary = await summarizeResponse(result);
    setResponseSummary(summary);

    const postOutput = [];
    runScript(testsPostText, { request: payload, response: result }, postOutput);
    if (postOutput.length) {
      setTestsOutput(postOutput.join("\n"));
      setShowTestOutput(true);
    }
  }

  async function handleGenerateRequest() {
    const finalPrompt = buildTemplatePrompt();
    if (!finalPrompt.trim()) return;
    const draft = await generateRequestFromPrompt(finalPrompt);
    setMethod(draft.method);
    setUrl(draft.url);
    setHeadersText(JSON.stringify(draft.headers, null, 2));
    setBodyText(draft.body || "");
  }

  function handleHeadersTextChange(value) {
    setHeadersText(value);
    try {
      const parsed = value.trim() ? JSON.parse(value) : {};
      setHeadersRows(objectToRows(parsed));
    } catch (err) {
      // Keep text as-is; user may still be typing
    }
  }

  function handleHeadersRowsChange(next) {
    setHeadersRows(next);
    setHeadersText(JSON.stringify(rowsToObject(next), null, 2));
    if (currentRequestId) updateRequestState(currentRequestId, "headersRows", next);
  }

  async function handleGenerateTests() {
    const tests = await generateTestsFromResponse({ method, url }, response);
    setActiveRequestTab("Tests");
    setTestsPostText(tests.join("\n"));
  }

  function runTests() {
    setTestsOutput([]);
    let input = null;
    try {
      input = JSON.parse(testsInputText);
    } catch (err) {
      setTestsOutput([{ type: "error", text: "Invalid test input JSON.", label: testsMode }]);
      setShowTestOutput(true);
      return;
    }
    try {
      const out = [];
      const ctx = {
        request: input.request || {},
        response: input.response || input
      };
      if (testsMode === "pre") {
        runScript(testsPreText, ctx, out, "pre-script");
      } else {
        runScript(testsPostText, ctx, out, "post-script");
      }
      setTestsOutput(out.length ? out : [{ type: "info", text: "Tests executed.", label: testsMode }]);
      setShowTestOutput(true);
    } catch (err) {
      setTestsOutput([{ type: "error", text: err.message, label: testsMode, errorType: err.name }]);
      setShowTestOutput(true);
    }
  }

  function runScript(code, context, output, label) {
    if (!code || !code.trim()) return;
    const safeOutput = output || [];
    const request = context.request || {};
    const response = context.response || {};
    const pm = buildPm(request, response, safeOutput, label || "script");
    const api = {
      log: (msg) => safeOutput.push({ type: "log", text: String(msg), label: label || "script" }),
      setHeader: (key, value) => {
        request.headers = request.headers || {};
        request.headers[key] = value;
      },
      setParam: (key, value) => {
        request.params = request.params || {};
        request.params[key] = value;
      },
      setBody: (value) => {
        request.body = value;
      },
      setUrl: (value) => {
        request.url = value;
      }
    };
    // eslint-disable-next-line no-new-func
    const fn = new Function("context", "api", "pm", "output", code);
    fn({ request, response }, api, pm, safeOutput);
  }

  function buildPm(request, response, output, label) {
    const pm = {
      request: {
        headers: request.headers || {},
        url: request.url || "",
        method: request.method || ""
      },
      response: {
        code: response?.status ?? response?.code ?? 0,
        status: response?.statusText || "",
        text: () => response?.body ?? "",
        json: () => {
          if (response?.json) return response.json;
          if (response?.body) {
            try {
              return JSON.parse(response.body);
            } catch (err) {
              return null;
            }
          }
          return null;
        }
      },
      test: (name, fn) => {
        try {
          fn();
          output.push({ type: "pass", text: name, label });
        } catch (err) {
          output.push({
            type: "fail",
            text: name,
            label,
            errorType: err.name,
            errorMessage: err.message
          });
        }
      },
      expect: (value) => ({
        to: {
          equal: (expected) => {
            if (value !== expected) throw new Error(`Expected ${expected} but got ${value}`);
          },
          be: {
            true: () => {
              if (value !== true) throw new Error(`Expected true but got ${value}`);
            },
            false: () => {
              if (value !== false) throw new Error(`Expected false but got ${value}`);
            }
          },
          contain: (expected) => {
            if (!String(value).includes(String(expected))) {
              throw new Error(`Expected ${value} to contain ${expected}`);
            }
          }
        }
      })
    };
    return pm;
  }

  function handleAddDerivedField() {
    if (!derivedName || !derivedExpr) return;
    setDerivedFields((prev) => [...prev, { name: derivedName, expression: derivedExpr }]);
    setDerivedName("");
    setDerivedExpr("");
  }

  function handleSort(key) {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handleXmlToJson() {
    try {
      const json = xmlToJson(raw);
      setResponse((prev) => ({ ...prev, json }));
    } catch (err) {
      setError("Unable to parse XML.");
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand">AI API Client</div>
          <button
            className={activeSidebar === "Collections" ? "ghost active" : "ghost"}
            onClick={() => setActiveSidebar("Collections")}
          >
            Collections
          </button>
          <button
            className={activeSidebar === "History" ? "ghost active" : "ghost"}
            onClick={() => setActiveSidebar("History")}
          >
            History
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '8px' }}>
            <select
              className="input compact"
              value={activeEnvId}
              onChange={(e) => setActiveEnvId(e.target.value)}
              style={{ padding: '4px 24px 4px 8px', maxWidth: '150px' }}
            >
              <option value="" disabled>Select Environment</option>
              {environments.map(env => (
                <option key={env.id} value={env.id}>{env.name}</option>
              ))}
            </select>
            <button className="ghost" onClick={() => setShowEnvModal(true)} title="Manage Environments">
              Manage Environments
            </button>
          </div>
        </div>
        <div className="topbar-actions">
          <input
            className="input topbar-search"
            placeholder="Search collections, tags, history"
            value={topSearch}
            onChange={(e) => setTopSearch(e.target.value)}
          />
          <button className="ghost" onClick={() => setShowWorkspace(true)}>Workspace: Default</button>
          <button className="ghost" onClick={() => setShowSettings(true)}>Settings</button>
        </div>
      </header>

      <div
        className={showRightRail ? "layout" : "layout rail-collapsed"}
        style={{
          gridTemplateColumns: showRightRail
            ? `${leftWidth}px 10px 1fr 10px ${rightWidth}px`
            : `${leftWidth}px 10px 1fr 10px 44px`
        }}
      >
        <aside className="sidebar">
          <div className="sidebar-panel">
            <div className="panel-title header-row">
              <span>{activeSidebar}</span>
              {activeSidebar === "Collections" && (
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button className="ghost" onClick={() => setShowCollectionModal(true)}>Manage</button>
                  <div className="menu-wrap">
                    <button className="ghost" onClick={() => setShowImportMenu(prev => !prev)}>Import</button>
                    {showImportMenu && (
                      <div className="menu" style={{ right: 0, left: 'auto', minWidth: '150px' }}>
                        <button className="ghost" onClick={() => { importCollection(); setShowImportMenu(false); }}>From File</button>
                        <button className="ghost" onClick={() => { setShowImportTextModal(true); setShowImportMenu(false); }}>From Text</button>
                        <button className="ghost" onClick={() => { setShowImportApiModal(true); setShowImportMenu(false); }}>From API URL</button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            {activeSidebar === "Collections" && (
              <div className="panel-body">
                <div className="collection-section">
                  <div className="panel-row">
                    <select
                      className="input compact"
                      value={activeCollectionId}
                      onChange={(e) => setActiveCollectionId(e.target.value)}
                    >
                      {collections.map((col) => (
                        <option key={col.id} value={col.id}>{col.name}</option>
                      ))}
                    </select>
                    <button className="ghost icon-button" onClick={addCollection} title="Create Collection" aria-label="Create collection">
                      +
                    </button>
                  </div>
                </div>
                <div className="collection-section">
                  <div className="panel-row">
                    {editingCollectionName ? (
                      <input
                        autoFocus
                        className="input"
                        placeholder="Collection name"
                        value={collectionNameDraft}
                        onChange={(e) => setCollectionNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || (e.ctrlKey && e.key.toLowerCase() === "s")) {
                            updateCollectionName(collectionNameDraft.trim() || getActiveCollection()?.name || "");
                            setEditingCollectionName(false);
                          }
                        }}
                        onBlur={() => {
                          updateCollectionName(collectionNameDraft.trim() || getActiveCollection()?.name || "");
                          setEditingCollectionName(false);
                        }}
                      />
                    ) : (
                      <button
                        className="ghost folder-name"
                        onDoubleClick={() => {
                          setEditingCollectionName(true);
                          setCollectionNameDraft(getActiveCollection()?.name || "");
                        }}
                      >
                        {getActiveCollection()?.name || "Untitled Collection"}
                      </button>
                    )}
                    <div className="menu-wrap" style={{ marginLeft: 'auto' }}>
                      <button
                        className="ghost icon-button"
                        aria-label="Collection options"
                        onClick={() => setShowCollectionMenu((prev) => !prev)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg>
                      </button>
                      {showCollectionMenu && (
                        <div className="menu">
                          <button
                            className="ghost"
                            onClick={() => {
                              addFolderToCollection();
                              setShowCollectionMenu(false);
                            }}
                          >
                            Create Folder
                          </button>
                          <button
                            className="ghost"
                            onClick={() => {
                              addRequestToCollection();
                              setShowCollectionMenu(false);
                            }}
                          >
                            Create Request
                          </button>
                          <button
                            className="ghost"
                            onClick={() => {
                              duplicateCollection(activeCollectionId);
                              setShowCollectionMenu(false);
                            }}
                          >
                            Duplicate Collection
                          </button>
                          <button
                            className="ghost"
                            onClick={() => {
                              exportCollection(activeCollectionId);
                              setShowCollectionMenu(false);
                            }}
                          >
                            Export Collection
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div
                    className={`panel-list ${dragOverItemId === 'root' ? 'drag-over' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (draggedItemId && dragOverItemId !== 'root') {
                        setDragOverItemId('root');
                      }
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      // Only clear if we are leaving the panel-list itself, not when entering children
                      if (e.currentTarget === e.target) {
                        if (dragOverItemId === 'root') setDragOverItemId(null);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOverItemId(null);
                      setDraggedItemId(null);
                      const sourceId = e.dataTransfer.getData("text/plain");
                      if (sourceId) moveItemInCollection(sourceId, null, true);
                    }}
                    style={{ minHeight: '100px', paddingBottom: '20px' }}
                  >
                    {renderCollectionItems(getActiveCollection()?.items || [])}
                  </div>
                </div>
              </div>
            )}
            {activeSidebar === "Environments" && (
              <div className="panel-body">
                Click Environments to manage variables.
              </div>
            )}
            {activeSidebar === "History" && (
              <div className="panel-body">Browse request history and re-run previous calls.</div>
            )}
          </div>
        </aside>

        <div className="resizer" onMouseDown={() => setDraggingLeft(true)} />

        <main className="main" style={{ gridTemplateRows: `${topHeight}px 10px 1fr` }}>
          <section className="request">
            <div className="request-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {editingMainRequestName ? (
                  <input
                    autoFocus
                    className="input compact"
                    value={requestName}
                    onChange={(e) => setRequestName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || (e.ctrlKey && e.key.toLowerCase() === "s")) {
                        if (currentRequestId) {
                          updateRequestName(currentRequestId, requestName.trim() || "New Request");
                        }
                        setEditingMainRequestName(false);
                      }
                    }}
                    onBlur={() => {
                      if (currentRequestId) {
                        updateRequestName(currentRequestId, requestName.trim() || "New Request");
                      }
                      setEditingMainRequestName(false);
                    }}
                  />
                ) : (
                  <span className="request-name" onDoubleClick={() => setEditingMainRequestName(true)}>
                    {requestName}
                  </span>
                )}
              </div>
              <button
                className="ghost icon-button"
                title="Export Code Snippet"
                onClick={() => setShowSnippetModal(true)}
              >
                &lt;/&gt;
              </button>
            </div>
            <div className="request-bar">
              <select
                className="input method"
                value={method}
                onChange={(e) => {
                  setMethod(e.target.value);
                  if (currentRequestId) {
                    updateRequestMethod(currentRequestId, e.target.value);
                  }
                }}
              >
                <option>GET</option>
                <option>POST</option>
                <option>PUT</option>
                <option>DELETE</option>
              </select>
              <EnvInput
                className="input url"
                value={url}
                onChange={(val) => setUrl(val)}
                envVars={getEnvVars()}
                onUpdateEnvVar={handleUpdateEnvVar}
                placeholder="https://api.example.com/v1/users/{{id}}"
                style={{ flex: 1 }}
              />
              <button className="primary" onClick={handleSend}>Send</button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div className="tabs" style={{ marginBottom: 0 }}>
                {requestTabs.map((tab) => (
                  <button
                    key={tab}
                    className={tab === activeRequestTab ? "tab active" : "tab"}
                    onClick={() => setActiveRequestTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {activeRequestTab === "Headers" && (
                  <div className="tabs" style={{ marginBottom: 0 }}>
                    <button
                      className={headersMode === "table" ? "tab active" : "tab"}
                      onClick={() => setHeadersMode("table")}
                    >
                      Table
                    </button>
                    <button
                      className={headersMode === "json" ? "tab active" : "tab"}
                      onClick={() => setHeadersMode("json")}
                    >
                      JSON
                    </button>
                  </div>
                )}
                {activeRequestTab === "Body" && (
                  <>
                    <select
                      className="input compact"
                      value={bodyType}
                      onChange={(e) => {
                        setBodyType(e.target.value);
                        setContentType(e.target.value);
                      }}
                    >
                      <option value="json">JSON</option>
                      <option value="xml">XML</option>
                      <option value="form">x-www-form-urlencoded</option>
                      <option value="multipart">form-data (simple)</option>
                      <option value="raw">Raw</option>
                    </select>
                    {(bodyType === "json" || bodyType === "xml") && (
                      <button
                        className="ghost compact"
                        style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                        onClick={() => {
                          try {
                            if (bodyType === "json") {
                              const stripComments = (str) => str.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
                              const parsed = JSON.parse(stripComments(bodyText));
                              setBodyText(JSON.stringify(parsed, null, 2));
                            } else if (bodyType === "xml") {
                              setBodyText(prettifyXml(bodyText));
                            }
                          } catch (e) {
                            // Ignored if invalid
                          }
                        }}
                      >
                        Prettify
                      </button>
                    )}
                    {bodyType === "json" && <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Supports // comments</div>}
                  </>
                )}
                {activeRequestTab === "Tests" && (
                  <>
                    <button className="ghost compact" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => setShowTestOutput((prev) => !prev)}>
                      Output
                    </button>
                    <button className="ghost compact" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => setShowTestInput((prev) => !prev)}>
                      Test Input
                    </button>
                    <div className="tabs" style={{ marginBottom: 0 }}>
                      <button
                        className={testsMode === "pre" ? "tab active" : "tab"}
                        onClick={() => setTestsMode("pre")}
                      >
                        Pre-request
                      </button>
                      <button
                        className={testsMode === "post" ? "tab active" : "tab"}
                        onClick={() => setTestsMode("post")}
                      >
                        Post-response
                      </button>
                    </div>
                    <button className="primary compact" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={runTests}>Run Tests</button>
                  </>
                )}
              </div>
            </div>

            <div className="editor">
              {activeRequestTab === "Params" && (
                <TableEditor
                  rows={paramsRows}
                  onChange={(r) => {
                    setParamsRows(r);
                    if (currentRequestId) updateRequestState(currentRequestId, "paramsRows", r);
                  }}
                  keyPlaceholder="Query Param"
                  valuePlaceholder="Value"
                  envVars={getEnvVars()}
                  onUpdateEnvVar={handleUpdateEnvVar}
                />
              )}
              {activeRequestTab === "Headers" && (
                <div className="headers-editor">
                  {headersMode === "table" && (
                    <TableEditor
                      rows={headersRows}
                      onChange={handleHeadersRowsChange}
                      keyPlaceholder="Header"
                      valuePlaceholder="Value"
                      envVars={getEnvVars()}
                    />
                  )}
                  {headersMode === "json" && (
                    <textarea
                      className="textarea fixed"
                      value={headersText}
                      onChange={(e) => handleHeadersTextChange(e.target.value)}
                      placeholder="Paste JSON headers here"
                    />
                  )}
                </div>
              )}
              {activeRequestTab === "Auth" && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Type</span>
                    <select
                      className="input compact"
                      style={{ width: '200px' }}
                      value={authType}
                      onChange={(e) => {
                        setAuthType(e.target.value);
                        if (currentRequestId) updateRequestState(currentRequestId, "authType", e.target.value);
                      }}
                    >
                      <option value="none">No Auth</option>
                      <option value="bearer">Bearer Token</option>
                      <option value="basic">Basic Auth</option>
                      <option value="api_key">API Key</option>
                      <option value="custom">Custom (Legacy)</option>
                    </select>
                  </div>

                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
                    {authType === "none" && (
                      <div style={{ color: 'var(--muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>
                        This request does not use any authorization.
                      </div>
                    )}

                    {authType === "bearer" && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '400px' }}>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.85rem' }}>
                          <span style={{ fontWeight: 500 }}>Token</span>
                          <input
                            type="text"
                            className="input"
                            placeholder="Token"
                            value={authConfig.bearer?.token || ""}
                            onChange={(e) => {
                              const next = { ...authConfig, bearer: { ...authConfig.bearer, token: e.target.value } };
                              setAuthConfig(next);
                              if (currentRequestId) updateRequestState(currentRequestId, "authConfig", next);
                            }}
                          />
                        </label>
                      </div>
                    )}

                    {authType === "basic" && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '400px' }}>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.85rem' }}>
                          <span style={{ fontWeight: 500 }}>Username</span>
                          <input
                            type="text"
                            className="input"
                            placeholder="Username"
                            value={authConfig.basic?.username || ""}
                            onChange={(e) => {
                              const next = { ...authConfig, basic: { ...authConfig.basic, username: e.target.value } };
                              setAuthConfig(next);
                              if (currentRequestId) updateRequestState(currentRequestId, "authConfig", next);
                            }}
                          />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.85rem' }}>
                          <span style={{ fontWeight: 500 }}>Password</span>
                          <input
                            type="password"
                            className="input"
                            placeholder="Password"
                            value={authConfig.basic?.password || ""}
                            onChange={(e) => {
                              const next = { ...authConfig, basic: { ...authConfig.basic, password: e.target.value } };
                              setAuthConfig(next);
                              if (currentRequestId) updateRequestState(currentRequestId, "authConfig", next);
                            }}
                          />
                        </label>
                      </div>
                    )}

                    {authType === "api_key" && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '400px' }}>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.85rem' }}>
                          <span style={{ fontWeight: 500 }}>Key</span>
                          <input
                            type="text"
                            className="input"
                            placeholder="Key"
                            value={authConfig.api_key?.key || ""}
                            onChange={(e) => {
                              const next = { ...authConfig, api_key: { ...authConfig.api_key, key: e.target.value } };
                              setAuthConfig(next);
                              if (currentRequestId) updateRequestState(currentRequestId, "authConfig", next);
                            }}
                          />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.85rem' }}>
                          <span style={{ fontWeight: 500 }}>Value</span>
                          <input
                            type="text"
                            className="input"
                            placeholder="Value"
                            value={authConfig.api_key?.value || ""}
                            onChange={(e) => {
                              const next = { ...authConfig, api_key: { ...authConfig.api_key, value: e.target.value } };
                              setAuthConfig(next);
                              if (currentRequestId) updateRequestState(currentRequestId, "authConfig", next);
                            }}
                          />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.85rem' }}>
                          <span style={{ fontWeight: 500 }}>Add to</span>
                          <select
                            className="input compact"
                            value={authConfig.api_key?.add_to || "header"}
                            onChange={(e) => {
                              const next = { ...authConfig, api_key: { ...authConfig.api_key, add_to: e.target.value } };
                              setAuthConfig(next);
                              if (currentRequestId) updateRequestState(currentRequestId, "authConfig", next);
                            }}
                          >
                            <option value="header">Header</option>
                            <option value="query">Query Params</option>
                          </select>
                        </label>
                      </div>
                    )}

                    {authType === "custom" && (
                      <TableEditor
                        rows={authRows}
                        onChange={(r) => {
                          setAuthRows(r);
                          if (currentRequestId) updateRequestState(currentRequestId, "authRows", r);
                        }}
                        keyPlaceholder="Custom Key"
                        valuePlaceholder="Credentials"
                        envVars={getEnvVars()}
                        onUpdateEnvVar={handleUpdateEnvVar}
                      />
                    )}
                  </div>
                </div>
              )}
              {activeRequestTab === "Body" && (
                <div
                  className="body-editor"
                  style={{ position: 'relative' }}
                >
                  {(bodyType === "json" || bodyType === "xml" || bodyType === "raw") && (() => {
                    const currentEnvVars = getEnvVars();
                    const envAutoComplete = autocompletion({
                      override: [(context) => {
                        let word = context.matchBefore(/\{\{\w*/);
                        if (!word) return null;
                        if (word.from === word.to && !context.explicit) return null;
                        return {
                          from: word.from + 2,
                          options: Object.entries(currentEnvVars).map(([k, v]) => ({
                            label: k,
                            type: "variable",
                            detail: String(v) || "",
                            apply: `${k}}}`
                          }))
                        };
                      }]
                    });

                    const envHoverTooltip = hoverTooltip((view, pos, side) => {
                      const text = view.state.doc.toString();
                      const regex = /\{\{([^}]+)\}\}/g;
                      let match;
                      while ((match = regex.exec(text)) !== null) {
                        const start = match.index;
                        const end = start + match[0].length;
                        if (pos >= start && pos <= end) {
                          const key = match[1].trim();
                          const val = currentEnvVars[key];
                          const exists = Object.prototype.hasOwnProperty.call(currentEnvVars, key);
                          return {
                            pos: start,
                            end: end,
                            above: true,
                            create() {
                              const dom = document.createElement("div");
                              dom.style.background = "var(--panel-2)";
                              dom.style.border = "1px solid var(--border)";
                              dom.style.borderRadius = "4px";
                              dom.style.padding = "4px 8px";
                              dom.style.fontSize = "0.80rem";
                              dom.style.boxShadow = "0 4px 12px rgba(0,0,0,0.6)";
                              dom.style.whiteSpace = "nowrap";
                              dom.style.fontFamily = '"Space Grotesk", sans-serif';
                              dom.style.display = "flex";
                              dom.style.alignItems = "center";
                              dom.style.gap = "8px";

                              dom.style.pointerEvents = "auto";
                              dom.onmousedown = (e) => e.stopPropagation();

                              const textSpan = document.createElement("span");
                              textSpan.style.color = exists ? "var(--text)" : "#ff5555";
                              textSpan.textContent = exists ? `${key}: ${val}` : `Unresolved variable: ${key}`;

                              const editBtn = document.createElement("span");
                              editBtn.textContent = "✎ Edit";
                              editBtn.style.color = "var(--accent-blue)";
                              editBtn.style.cursor = "pointer";
                              editBtn.style.fontSize = "0.75rem";
                              editBtn.style.fontWeight = "bold";
                              editBtn.onclick = (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setCmEnvEdit({ key, value: String(val || "") });
                              };

                              dom.appendChild(editBtn);
                              dom.appendChild(textSpan);

                              return { dom };
                            }
                          };
                        }
                      }
                      return null;
                    });

                    return (
                      <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: '4px' }}>
                        <CodeMirror
                          value={bodyText}
                          height="100%"
                          theme={vscodeDark}
                          extensions={
                            bodyType === "json"
                              ? [json(), customJsonLinter, lintGutter(), envAutoComplete, envVarHighlightPlugin, envHoverTooltip]
                              : bodyType === "xml"
                                ? [xmlLang(), xmlLinter, lintGutter(), envAutoComplete, envVarHighlightPlugin, envHoverTooltip]
                                : [envAutoComplete, envVarHighlightPlugin, envHoverTooltip]
                          }
                          onChange={(value) => setBodyText(value)}
                          basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true, highlightActiveLine: false }}
                          style={{ height: '100%', fontSize: '13px' }}
                        />
                      </div>
                    );
                  })()}
                  {(bodyType === "form" || bodyType === "multipart") && (
                    <TableEditor
                      rows={bodyRows}
                      onChange={(r) => {
                        setBodyRows(r);
                        if (currentRequestId) updateRequestState(currentRequestId, "bodyRows", r);
                      }}
                      keyPlaceholder="Field"
                      valuePlaceholder="Value"
                      envVars={getEnvVars()}
                    />
                  )}
                </div>
              )}
              {activeRequestTab === "Tests" && (
                <div className="tests-editor">
                  {showTestInput && (
                    <div className="tests-input-inline">
                      <div className="panel-title">Test Input (JSON)</div>
                      <textarea
                        className="textarea compact"
                        value={testsInputText}
                        onChange={(e) => setTestsInputText(e.target.value)}
                      />
                    </div>
                  )}
                  {testsMode === "pre" && (
                    <textarea
                      className="textarea fixed"
                      value={testsPreText}
                      onChange={(e) => setTestsPreText(e.target.value)}
                    />
                  )}
                  {testsMode === "post" && (
                    <textarea
                      className="textarea fixed"
                      value={testsPostText}
                      onChange={(e) => setTestsPostText(e.target.value)}
                    />
                  )}
                  {showTestOutput && (
                    <div className="tests-output">
                      {testsOutput.map((entry, index) => (
                        <div className={`log ${entry.type}`} key={index}>
                          <span className="log-label">{entry.label || "script"}&gt;</span>
                          {entry.type === "pass" && <span className="log-type">PASS</span>}
                          {entry.type === "fail" && <span className="log-type">FAIL</span>}
                          {entry.type === "error" && <span className="log-type">ERROR</span>}
                          {entry.type === "info" && <span className="log-type">INFO</span>}
                          {entry.type === "log" && <span className="log-type">LOG</span>}
                          <span className="log-text">{entry.text}</span>
                          {entry.errorType && <span className="log-error">({entry.errorType}{entry.errorMessage ? `: ${entry.errorMessage}` : ""})</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          <div className="resizer vertical" onMouseDown={() => setDraggingMain(true)} />

          <section className="response">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div className="response-meta" style={{ marginBottom: 0 }}>
                <div>Status: {response?.status ? `${response.status} ${response.statusText}` : "-"}</div>
                <div>Latency: {response?.duration ? `${response.duration} ms` : "-"}</div>
                <div>Size: {response?.body ? `${response.body.length} bytes` : "-"}</div>
              </div>

              <div className="tabs" style={{ marginBottom: 0 }}>
                {responseTabs.map((tab) => (
                  <button
                    key={tab}
                    className={tab === activeResponseTab ? "tab active" : "tab"}
                    onClick={() => setActiveResponseTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {error && <div className="error">{error}</div>}

            <div className="response-body">
              {activeResponseTab === "Pretty" && (
                <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: '4px' }}>
                  <CodeMirror
                    value={pretty || "No response yet."}
                    readOnly={true}
                    theme={vscodeDark}
                    extensions={[json()]}
                    basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }}
                    style={{ fontSize: '13px', minHeight: '100px' }}
                  />
                </div>
              )}
              {activeResponseTab === "Raw" && (
                <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: '4px' }}>
                  <CodeMirror
                    value={raw || "No response yet."}
                    readOnly={true}
                    theme={vscodeDark}
                    basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }}
                    style={{ fontSize: '13px', minHeight: '100px' }}
                  />
                </div>
              )}
              {activeResponseTab === "XML" && (
                <div className="split">
                  <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: '4px' }}>
                    <CodeMirror
                      value={xml || raw || "No XML available."}
                      readOnly={true}
                      theme={vscodeDark}
                      extensions={[xmlLang()]}
                      basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }}
                      style={{ fontSize: '13px', minHeight: '100px' }}
                    />
                  </div>
                  <div className="inline-actions">
                    <button className="ghost" onClick={handleXmlToJson}>XML → JSON</button>
                    <button className="ghost" onClick={() => navigator.clipboard.writeText(xml || raw || "")}>Copy XML</button>
                  </div>
                </div>
              )}
              {activeResponseTab === "Headers" && (
                <div className="headers-view" style={{ overflow: 'auto', padding: '16px' }}>
                  {response?.headers && Object.keys(response.headers).length > 0 ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          <th style={{ padding: '8px', color: 'var(--muted)' }}>Header</th>
                          <th style={{ padding: '8px', color: 'var(--muted)' }}>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(response.headers).map(([key, value]) => (
                          <tr key={key} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                            <td style={{ padding: '8px', fontWeight: 500 }}>{key}</td>
                            <td style={{ padding: '8px', wordBreak: 'break-all', fontFamily: 'monospace' }}>{value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ color: 'var(--muted)' }}>No headers available.</div>
                  )}
                </div>
              )}
              {activeResponseTab === "Table" && (
                <div className="table-view">
                  <div className="table-toolbar">
                    <input
                      className="input search"
                      placeholder="Search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <select
                      className="input"
                      value={searchKey}
                      onChange={(e) => setSearchKey(e.target.value)}
                    >
                      <option value="">All keys</option>
                      {computedRows[0] && Object.keys(computedRows[0]).map((key) => (
                        <option key={key} value={key}>{key}</option>
                      ))}
                    </select>
                    <select
                      className="input"
                      value={selectedTablePath}
                      onChange={(e) => setSelectedTablePath(e.target.value)}
                    >
                      {tableCandidates.map((path) => (
                        <option key={path} value={path}>{path}</option>
                      ))}
                    </select>
                    <select
                      className="input"
                      value={sortKey}
                      onChange={(e) => setSortKey(e.target.value)}
                    >
                      <option value="">Sort key</option>
                      {computedRows[0] && Object.keys(computedRows[0]).map((key) => (
                        <option key={key} value={key}>{key}</option>
                      ))}
                    </select>
                    <button className="ghost" onClick={() => setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))}>
                      Sort: {sortDirection}
                    </button>
                    <button className="ghost" onClick={() => downloadText("table.csv", csv)}>Export CSV</button>
                    <button className="ghost" onClick={() => downloadText("table.json", JSON.stringify(tableRows, null, 2))}>Export JSON</button>
                  </div>
                  <div className="derived">
                    <input
                      className="input"
                      placeholder="Derived field name"
                      value={derivedName}
                      onChange={(e) => setDerivedName(e.target.value)}
                    />
                    <input
                      className="input"
                      placeholder="Expression e.g. name + ' (' + role + ')'"
                      value={derivedExpr}
                      onChange={(e) => setDerivedExpr(e.target.value)}
                    />
                    <button className="ghost" onClick={handleAddDerivedField}>Add</button>
                  </div>
                  <table>
                    <thead>
                      <tr>
                        {computedRows[0] ? Object.keys(computedRows[0]).map((key) => (
                          <th key={key} onClick={() => handleSort(key)}>{key}</th>
                        )) : (
                          <th>No data</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {computedRows.map((row, idx) => (
                        <tr key={idx}>
                          {Object.keys(row).map((key) => (
                            <td key={key}>{String(row[key])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {activeResponseTab === "Visualize" && (
                <div className="visualize">
                  <div className="viz-card">
                    <div className="viz-title">Summary</div>
                    <div className="viz-value">{responseSummary.summary}</div>
                  </div>
                  <div className="viz-card">
                    <div className="viz-title">Rows</div>
                    <div className="viz-value">{tableRows.length}</div>
                  </div>
                  <div className="viz-card">
                    <div className="viz-title">Status</div>
                    <div className="viz-value">{response?.status || "-"}</div>
                  </div>
                </div>
              )}
            </div>
          </section>
        </main>

        <div className="resizer" onMouseDown={() => setDraggingRight(true)} />

        <aside className={showRightRail ? "right-rail" : "right-rail collapsed"}>
          {showRightRail ? (
            <>
              <div className="right-rail-header">
                <div className="section-title">AI Assistant</div>
                <button className="ghost icon-button" onClick={() => setShowRightRail(false)} title="Collapse">
                  →
                </button>
              </div>
              <div className="card">
                <div className="card-title">Request Builder</div>
                <textarea
                  className="textarea small"
                  placeholder="Describe your request"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                />
                <button className="primary" onClick={handleGenerateRequest}>Generate Request</button>
                <div className="card-subtext">Template: {templateId ? templates.find((t) => t.id === templateId)?.label : "None"}</div>
              </div>
              <div className="card">
                <div className="card-title">Response Intelligence</div>
                <div className="card-text">Summary: {responseSummary.summary}</div>
                {responseSummary.hints.map((hint, index) => (
                  <div className="card-text" key={index}>Hint: {hint}</div>
                ))}
                <button className="ghost" onClick={handleGenerateTests}>Generate Tests</button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '8px' }}>
              <button
                className="ghost icon-button"
                onClick={() => setShowRightRail(true)}
                title="Expand AI Assistant"
                style={{ fontSize: '1.2rem', padding: '8px' }}
              >
                ✨
              </button>
            </div>
          )}
        </aside>
      </div>

      <footer className="dock">
        <button className="ghost">Console</button>
        <button className="ghost">Tests</button>
        <button className="ghost">Timing</button>
      </footer>

      {showSettings && (
        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Settings</div>
            <div className="modal-row">
              <label>
                <input type="checkbox" defaultChecked /> Enable AI request generation
              </label>
            </div>
            <div className="modal-row">
              <label>
                <input type="checkbox" defaultChecked /> Enable response summaries
              </label>
            </div>
            <div className="modal-row">
              <label>
                <input type="checkbox" /> Redact secrets before AI
              </label>
            </div>
            <button className="primary" onClick={() => setShowSettings(false)}>Close</button>
          </div>
        </div>
      )}

      {showWorkspace && (
        <div className="modal-backdrop" onClick={() => setShowWorkspace(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Workspace</div>
            <div className="modal-row">
              <label>Current workspace</label>
              <select className="input">
                <option>Default</option>
                <option>Team API</option>
              </select>
            </div>
            <div className="modal-row">
              <input className="input" placeholder="New workspace name" />
              <button className="ghost">Create</button>
            </div>
            <button className="primary" onClick={() => setShowWorkspace(false)}>Close</button>
          </div>
        </div>
      )}

      {showSnippetModal && (
        <div className="modal-backdrop" onClick={() => setShowSnippetModal(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()} style={{ width: '800px', maxWidth: '90vw' }}>
            <div className="modal-title">
              <div>Export Code Snippet</div>
              <button className="ghost icon-button" onClick={() => setShowSnippetModal(false)} style={{ margin: "-8px", padding: "8px" }}>✕</button>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'center' }}>
              <select
                className="input"
                value={snippetLanguage}
                onChange={(e) => setSnippetLanguage(e.target.value)}
                style={{ flex: 1 }}
              >
                <option value="curl">cURL</option>
                <option value="raw">Raw HTTP</option>
                <option value="python">Python (Requests)</option>
                <option value="node">Node.js (Fetch)</option>
                <option value="go">Go (Native)</option>
                <option value="c">C (libcurl)</option>
                <option value="csharp">C# (HttpClient)</option>
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={snippetInterpolate}
                  onChange={(e) => setSnippetInterpolate(e.target.checked)}
                />
                Replace values with placeholders
              </label>
            </div>

            <textarea
              className="textarea"
              readOnly
              value={generateSnippet()}
              style={{ minHeight: '350px', whiteSpace: 'pre', fontFamily: 'monospace', fontSize: '13px', background: 'var(--panel)' }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button className="ghost" onClick={() => setShowSnippetModal(false)}>Close</button>
              <button
                className="primary"
                onClick={() => {
                  navigator.clipboard.writeText(generateSnippet());
                }}
              >
                Copy to Clipboard
              </button>
            </div>
          </div>
        </div>
      )}

      {showExportModal && (
        <div className="modal-backdrop" onClick={() => setShowExportModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: '600px', maxWidth: '95vw', padding: '20px', gap: '20px' }}>
            <div className="modal-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>Export collection</div>
              <button className="ghost icon-button" onClick={() => setShowExportModal(false)} style={{ margin: "-8px", padding: "8px" }}>✕</button>
            </div>

            <div className="export-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                <span style={{ fontWeight: '600', fontSize: '1.05rem' }}>{exportTargetNode?.name}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="ghost input compact" style={{ fontSize: '11px', padding: '2px 8px' }} onClick={() => {
                    const allIds = new Set();
                    const collectIds = (n) => { allIds.add(n.id); if (n.items) n.items.forEach(collectIds); };
                    collectIds(exportTargetNode);
                    setExportSelections(allIds);
                  }}>Select All</button>
                  <button className="ghost input compact" style={{ fontSize: '11px', padding: '2px 8px' }} onClick={() => setExportSelections(new Set())}>None</button>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                  Requests <span style={{ color: 'var(--accent-green)', fontWeight: 'bold' }}>{Array.from(exportSelections).filter(id => id.startsWith('req-')).length}</span>
                </div>
              </div>
            </div>

            <div className="export-list" style={{ overflowY: 'auto', maxHeight: '50vh', padding: '8px 16px' }}>
              {renderExportTree(exportTargetNode)}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <button className="ghost" style={{ padding: '8px 16px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)' }} onClick={() => setShowExportModal(false)}>Cancel</button>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
                  <input
                    type="checkbox"
                    checked={exportInterpolate}
                    onChange={(e) => setExportInterpolate(e.target.checked)}
                  />
                  Preserve {"{{variables}}"} (don't evaluate)
                </label>
              </div>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <button
                  className="ghost icon-button"
                  title="Copy to Clipboard"
                  onClick={() => {
                    const { jsonStr } = getExportPayload();
                    navigator.clipboard.writeText(jsonStr);
                    setShowExportModal(false);
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </button>
                <button
                  className="ghost"
                  style={{ padding: '8px 16px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)' }}
                  onClick={() => alert("Exporting via API is coming soon!")}
                >
                  Export as API
                </button>
                <button
                  className="primary"
                  style={{ background: 'var(--accent-green)', color: '#000', fontWeight: '600', padding: '8px 24px', borderRadius: '8px' }}
                  onClick={() => {
                    const { jsonStr, fileName } = getExportPayload();
                    const blob = new Blob([jsonStr], { type: "application/json" });
                    const u = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = u;
                    a.download = fileName;
                    a.click();
                    URL.revokeObjectURL(u);
                    setShowExportModal(false);
                  }}
                >
                  Download
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {cmEnvEdit && (
        <div className="modal-backdrop" onClick={() => setCmEnvEdit(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Edit Variable: {cmEnvEdit.key}</div>
            <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="field-label">Value</div>
              <input
                className="input"
                value={cmEnvEdit.value}
                onChange={(e) => setCmEnvEdit({ ...cmEnvEdit, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleUpdateEnvVar(cmEnvEdit.key, cmEnvEdit.value);
                    setCmEnvEdit(null);
                  }
                }}
                autoFocus
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" }}>
                <button className="ghost" onClick={() => setCmEnvEdit(null)}>Cancel</button>
                <button className="primary" onClick={() => {
                  handleUpdateEnvVar(cmEnvEdit.key, cmEnvEdit.value);
                  setCmEnvEdit(null);
                }}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showEnvModal && (
        <div className="modal-backdrop" onClick={() => setShowEnvModal(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">
              <div>Manage Environments</div>
              <button className="ghost icon-button" onClick={() => setShowEnvModal(false)} style={{ margin: "-8px", padding: "8px" }}>✕</button>
            </div>
            <div className="env-layout">
              <div className="env-sidebar">
                <div className="env-sidebar-header">
                  <span style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Environments</span>
                  <button
                    className="ghost icon-button"
                    title="Create Environment"
                    style={{ padding: '4px', height: 'auto', minHeight: 0 }}
                    onClick={() => {
                      const id = `env-${Date.now()}`;
                      setEnvironments((prev) => [
                        ...prev,
                        { id, name: `Env ${prev.length + 1}`, vars: [{ key: "", value: "", comment: "", enabled: true }] }
                      ]);
                      setActiveEnvId(id);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  </button>
                </div>
                <div className="env-list scroll">
                  {environments.map((env) => (
                    <div
                      key={env.id}
                      className={activeEnvId === env.id ? "env-item active" : "env-item"}
                      onClick={() => setActiveEnvId(env.id)}
                    >
                      <div className="env-select">
                        {env.name}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="env-sidebar-footer">
                  <button
                    className="ghost container-fluid"
                    style={{ width: "100%", justifyContent: "center" }}
                    onClick={() => {
                      if (!activeEnvId) return;
                      const remaining = environments.filter((env) => env.id !== activeEnvId);
                      setEnvironments(remaining);
                      if (remaining.length > 0) {
                        setActiveEnvId(remaining[0].id);
                      } else {
                        setActiveEnvId(null);
                      }
                    }}
                  >
                    Delete Environment
                  </button>
                </div>
              </div>
              <div className="env-editor">
                {getActiveEnv() ? (
                  <>
                    <div style={{ display: "flex", alignItems: "center", marginBottom: "8px", gap: "12px" }}>
                      <input
                        className="input"
                        placeholder="Environment name"
                        value={getActiveEnv()?.name || ""}
                        style={{ fontSize: "1.2rem", fontWeight: "600", border: "none", background: "transparent", padding: "0" }}
                        onChange={(e) =>
                          setEnvironments((prev) =>
                            prev.map((env) =>
                              env.id === activeEnvId ? { ...env, name: e.target.value } : env
                            )
                          )
                        }
                      />
                    </div>
                    <div className="panel-body" style={{ marginBottom: "16px" }}>
                      Use in requests via interpolation: <code>{"{{variableName}}"}</code>
                    </div>
                    <div className="env-vars" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                      <TableEditor
                        rows={getActiveEnv()?.vars || []}
                        onChange={(rows) => {
                          setEnvironments((prev) =>
                            prev.map((env) =>
                              env.id === activeEnvId ? { ...env, vars: rows } : env
                            )
                          );
                        }}
                        keyPlaceholder="Key"
                        valuePlaceholder="Value"
                        envVars={getEnvVars()}
                        onUpdateEnvVar={handleUpdateEnvVar}
                      />
                    </div>
                  </>
                ) : (
                  <div className="empty-state">
                    <div className="empty-state-icon">
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                    </div>
                    <div>No environment selected</div>
                    <div style={{ fontSize: "0.85rem", marginTop: "8px" }}>Create one from the sidebar to manage variables.</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {
        showCollectionModal && (
          <div className="modal-backdrop" onClick={() => setShowCollectionModal(false)}>
            <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
              <div className="modal-title">Manage Collections</div>
              <div className="env-layout">
                <div className="env-sidebar">
                  <div className="env-sidebar-header">
                    <div className="field-label">Collections</div>
                    <button className="ghost" onClick={addCollection}>Create Collection</button>
                  </div>
                  <div className="env-list scroll">
                    {collections.map((col) => (
                      <label key={col.id} className="env-item">
                        <input
                          type="checkbox"
                          checked={selectedCollectionIds.includes(col.id)}
                          onChange={(e) => {
                            setSelectedCollectionIds((prev) =>
                              e.target.checked ? [...prev, col.id] : prev.filter((id) => id !== col.id)
                            );
                          }}
                        />
                        <button className="ghost env-select" onClick={() => setActiveCollectionId(col.id)}>
                          {col.name}
                        </button>
                      </label>
                    ))}
                  </div>
                  <button
                    className="ghost"
                    onClick={() => {
                      if (selectedCollectionIds.length === 0) return;
                      const remaining = collections.filter((col) => !selectedCollectionIds.includes(col.id));
                      if (remaining.length === 0) {
                        setSelectedCollectionIds([]);
                        return;
                      }
                      setCollections(remaining);
                      if (!remaining.find((col) => col.id === activeCollectionId)) {
                        setActiveCollectionId(remaining[0].id);
                      }
                      setSelectedCollectionIds([]);
                    }}
                  >
                    Delete Selected
                  </button>
                </div>

                <div className="env-editor">
                  {getActiveCollection() ? (
                    <>
                      <div className="panel-row">
                        <input
                          className="input"
                          placeholder="Collection name"
                          value={getActiveCollection()?.name || ""}
                          onChange={(e) => updateCollectionName(e.target.value)}
                        />
                      </div>
                      <div className="panel-body">
                        Use the left panel to select collections. Nested folders and requests remain in the collection tree.
                      </div>
                      <div className="modal-footer">
                        <button className="primary" onClick={() => setShowCollectionModal(false)}>Save</button>
                      </div>
                    </>
                  ) : (
                    <div className="empty-state">
                      No Collections. Create one from the left panel.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      }

      {showImportCollisionModal && (
        <div className="modal-backdrop" onClick={() => { setShowImportCollisionModal(false); setImportCollisionData(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Collection Already Exists</div>
            <div className="modal-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
              <div style={{ fontSize: '0.9rem', color: 'var(--text)' }}>
                A collection named <b>{importCollisionData?.name}</b> already exists in your workspace.
                Please provide a new name for the imported collection.
              </div>
              <input
                autoFocus
                className="input"
                style={{ width: '100%' }}
                value={importCollisionNameDraft}
                onChange={(e) => setImportCollisionNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleImportCollisionSubmit();
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button className="ghost" onClick={() => { setShowImportCollisionModal(false); setImportCollisionData(null); }}>Cancel</button>
              <button className="primary" onClick={handleImportCollisionSubmit}>Import Collection</button>
            </div>
          </div>
        </div>
      )}

      {
        showImportTextModal && (
          <div className="modal-backdrop" onClick={() => setShowImportTextModal(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-title">Import JSON from Text</div>
              <textarea
                className="input code-editor"
                value={importTextDraft}
                onChange={(e) => setImportTextDraft(e.target.value)}
                placeholder="Paste JSON collection here..."
                style={{ width: '100%', height: '200px', marginBottom: '10px' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button className="ghost" onClick={() => setShowImportTextModal(false)}>Cancel</button>
                <button className="primary" onClick={handleImportTextSubmit}>Import</button>
              </div>
            </div>
          </div>
        )
      }

      {
        showImportApiModal && (
          <div className="modal-backdrop" onClick={() => setShowImportApiModal(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-title">Import JSON from API URL</div>
              <input
                className="input"
                value={importApiDraft}
                onChange={(e) => setImportApiDraft(e.target.value)}
                placeholder="https://example.com/collection.json"
                style={{ width: '100%', marginBottom: '10px' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button className="ghost" onClick={() => setShowImportApiModal(false)}>Cancel</button>
                <button className="primary" onClick={handleImportApiSubmit}>Import</button>
              </div>
            </div>
          </div>
        )
      }

      {
        showMoveModal && itemToMove && (
          <div className="modal-backdrop" onClick={() => setShowMoveModal(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-title">Move "{itemToMove.name}"</div>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--muted)' }}>Select Destination</label>
                <input
                  className="input"
                  style={{ width: '100%', marginBottom: '8px' }}
                  placeholder="Search folders..."
                  value={moveSearchQuery}
                  onChange={(e) => setMoveSearchQuery(e.target.value)}
                  autoFocus
                />
                <select
                  className="input"
                  style={{ width: '100%' }}
                  size={8}
                  value={moveTargetId}
                  onChange={(e) => setMoveTargetId(e.target.value)}
                >
                  {!moveSearchQuery && <option value="root">Collection Root (Top Level)</option>}
                  {getAllFolders(getActiveCollection()?.items || [])
                    .filter(f => f.id !== itemToMove.id)
                    .filter(f => !moveSearchQuery || f.name.toLowerCase().includes(moveSearchQuery.toLowerCase()))
                    .map(folder => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))
                  }
                </select>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button className="ghost" onClick={() => { setShowMoveModal(false); setMoveSearchQuery(""); }}>Cancel</button>
                <button
                  className="primary"
                  onClick={() => {
                    if (moveTargetId === "root") {
                      moveItemInCollection(itemToMove.id, null, true);
                    } else {
                      moveItemInCollection(itemToMove.id, moveTargetId, true);
                    }
                    setShowMoveModal(false);
                    setItemToMove(null);
                    setMoveSearchQuery("");
                  }}
                >
                  Move Here
                </button>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
}

export default App;
