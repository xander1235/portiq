import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import ReactDOM from "react-dom";
import styles from "./App.module.css";
import logo from "./assets/logo.png";
import CodeMirror from '@uiw/react-codemirror';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { xml as xmlLang } from '@codemirror/lang-xml';
import { linter, lintGutter } from '@codemirror/lint';
import { autocompletion } from '@codemirror/autocomplete';
import { EditorView, Decoration, ViewPlugin, MatchDecorator, hoverTooltip } from '@codemirror/view';
import { generateRequestFromPrompt, generateTestsFromResponse, summarizeResponse, fetchModels } from "./services/ai.js";
import { jsonToCsv, jsonToXml, xmlToJson, prettifyXml } from "./services/format.js";
import { applyDerivedFields, filterRows, sortRows } from "./services/table.js";

import { useLocalStorage } from "./hooks/useLocalStorage.js";
import { useEnvironmentState } from "./hooks/useEnvironmentState.js";
import { xmlLinter } from "./utils/codemirror/xmlExtensions.js";
import { customJsonLinter } from "./utils/codemirror/jsonExtensions.js";
import { envVarHighlightPlugin, createEnvAutoComplete, createEnvHoverTooltip } from "./utils/codemirror/environmentExtensions.js";
import { SemanticSearch } from "./utils/semanticSearch.js";
import { flattenCollections } from "./utils/fuzzySearch.js";
import { get, set } from "idb-keyval";

import { TableEditor } from "./components/TableEditor.jsx";
import { EnvironmentModal } from "./components/Modals/EnvironmentModal.jsx";
import { ExportModal } from "./components/Modals/ExportModal.jsx";
import { GitHubSyncModal } from "./components/Modals/GitHubSyncModal.jsx";
import { SettingsModal } from "./components/Modals/SettingsModal.jsx";
import { RightRail } from "./components/RightRail/RightRail.jsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

import { Sidebar } from "./components/Sidebar/Sidebar.jsx";
import { RequestEditor } from "./components/RequestPane/RequestEditor.jsx";
import { ResponseViewer } from "./components/ResponsePane/ResponseViewer.jsx";
import { useRequestState } from "./hooks/useRequestState.js";
import layoutStyles from "./components/Layout/Layout.module.css";
import rightRailStyles from "./components/Layout/RightRail.module.css";

import { GraphQLPane } from "./components/ProtocolPanes/GraphQLPane.jsx";
import { WebSocketPane } from "./components/ProtocolPanes/WebSocketPane.jsx";
import { GrpcPane } from "./components/ProtocolPanes/GrpcPane.jsx";
import { MockServerPane } from "./components/ProtocolPanes/MockServerPane.jsx";
import { SseSocketPane } from "./components/ProtocolPanes/SseSocketPane.jsx";
import { McpPane } from "./components/ProtocolPanes/McpPane.jsx";
import { DagFlowPane } from "./components/ProtocolPanes/DagFlowPane.jsx";
import { ProtocolRegistry, GrpcProtocol } from "./protocols/index.js"; // register all built-in protocols
import { GraphQLProtocol } from "./protocols/graphql.js";

const responseTabs = ["Pretty", "Raw", "XML", "Table", "Visualize", "Headers"];
const requestTabs = ["Params", "Headers", "Auth", "Body", "Tests"];

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

function tokenizeJsonPath(path) {
  if (!path || path === "$") return [];
  const cleaned = path.replace(/^\$\.?/, "");
  const tokenPattern = /([^.[\]]+)|\[(\d+|\*)\]/g;
  const tokens = [];
  let match;
  while ((match = tokenPattern.exec(cleaned))) {
    if (match[1]) {
      tokens.push({ type: "property", value: match[1] });
    } else if (match[2] === "*") {
      tokens.push({ type: "wildcard" });
    } else {
      tokens.push({ type: "index", value: Number(match[2]) });
    }
  }
  return tokens;
}

function getValueByPath(root, path) {
  if (!path || path === "$") return root;
  const tokens = tokenizeJsonPath(path);
  let current = [root];

  for (const token of tokens) {
    const next = [];
    for (const item of current) {
      if (token.type === "property") {
        if (item != null && typeof item === "object" && token.value in item) {
          next.push(item[token.value]);
        }
        continue;
      }
      if (token.type === "index") {
        if (Array.isArray(item) && token.value < item.length) {
          next.push(item[token.value]);
        }
        continue;
      }
      if (token.type === "wildcard") {
        if (Array.isArray(item)) {
          next.push(...item);
        }
      }
    }
    current = next;
    if (current.length === 0) return undefined;
  }

  if (current.length === 1) return current[0];
  return current;
}

const SnippetLanguageSelector = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const options = [
    { id: "curl", name: "cURL", desc: "Command line utility", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 17l6-6-6-6M12 19h8" /></svg> },
    { id: "raw", name: "Raw HTTP", desc: "Plain HTTP text", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> },
    { id: "python", name: "Python", desc: "Requests library", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 8l4 4-4 4"></path><path d="M10 16h4"></path><circle cx="12" cy="12" r="10"></circle></svg> },
    { id: "node", name: "Node.js", desc: "Native fetch API", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg> },
    { id: "go", name: "Go", desc: "net/http package", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg> },
    { id: "c", name: "C", desc: "libcurl binding", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><path d="M9 16V8l6 8V8"></path></svg> },
    { id: "csharp", name: "C#", desc: "HttpClient", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"></path></svg> },
  ];

  const selected = options.find(o => o.id === value) || options[0];

  return (
    <div ref={dropdownRef} style={{ position: 'relative', minWidth: '240px', zIndex: 10 }}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          padding: '10px 14px', background: 'var(--panel)', border: '1px solid var(--border)',
          borderRadius: '8px', cursor: 'pointer', userSelect: 'none', transition: 'box-shadow 0.2s, border-color 0.2s',
          ...(isOpen ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 2px var(--accent-alpha, rgba(var(--accent-rgb), 0.2))' } : {})
        }}
      >
        <span style={{ color: 'var(--accent)', display: 'flex', background: 'var(--bg)', padding: '6px', borderRadius: '6px', border: '1px solid var(--border)' }}>{selected.icon}</span>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '2px' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)', lineHeight: 1 }}>{selected.name}</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1 }}>{selected.desc}</span>
        </div>
        <svg style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', color: 'var(--text-muted)' }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
      </div>

      {isOpen && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
          background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)', overflow: 'hidden', padding: '6px', zIndex: 100
        }}>
          {options.map((opt) => (
            <div
              key={opt.id}
              onClick={() => { onChange(opt.id); setIsOpen(false); }}
              onMouseOver={(e) => { e.currentTarget.style.background = 'var(--bg)'; }}
              onMouseOut={(e) => { e.currentTarget.style.background = opt.id === value ? 'var(--bg)' : 'transparent'; }}
              style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '8px 10px', borderRadius: '6px', cursor: 'pointer', transition: 'background 0.1s',
                background: opt.id === value ? 'var(--bg)' : 'transparent',
                border: '1px solid transparent',
                ...(opt.id === value ? { borderColor: 'var(--border)' } : {})
              }}
            >
              <span style={{ color: opt.id === value ? 'var(--accent)' : 'var(--text-muted)', display: 'flex' }}>{opt.icon}</span>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '2px' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: opt.id === value ? 'var(--text)' : 'var(--text-muted)', lineHeight: 1 }}>{opt.name}</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1 }}>{opt.desc}</span>
              </div>
              {opt.id === value && (
                <span style={{ color: 'var(--accent)' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function App() {
  const {
    method, setMethod,
    url, setUrl,
    headersText, setHeadersText,
    bodyText, setBodyText,
    testsPreText, setTestsPreText,
    testsPostText, setTestsPostText,
    testsInputText, setTestsInputText,
    paramsRows, setParamsRows,
    headersRows, setHeadersRows,
    authRows, setAuthRows,
    authType, setAuthType,
    authConfig, setAuthConfig,
    httpVersion, setHttpVersion,
    requestTimeoutMs, setRequestTimeoutMs,
    bodyType, setBodyType,
    bodyRows, setBodyRows,
    graphqlConfig, setGraphqlConfig,
    wsConfig, setWsConfig,
    protocol, setProtocol,
    requestName, setRequestName,
    currentRequestId, setCurrentRequestId,
    collections, setCollections,
    activeCollectionId, setActiveCollectionId,
    getActiveCollection,
    addCollection,
    duplicateCollection,
    updateCollectionName,
    addRequestToCollection,
    loadRequest,
    updateRequestState,
    updateRequestName,
    updateRequestMethod,
    deleteRequest,
    addFolderToCollection,
    updateFolderName,
    deleteFolder,
    moveItemInCollection,
    duplicateItem,
    getAllFolders,
    parseImportData,
    syncDraftToCollection,
    collectionActiveRequestIds
  } = useRequestState();

  const [activeRequestTab, setActiveRequestTab] = useLocalStorage("ui_activeRequestTab", "Body");
  const [activeResponseTab, setActiveResponseTab] = useLocalStorage("ui_activeResponseTab", "Pretty");
  const [aiPrompt, setAiPrompt] = useLocalStorage("ui_aiPrompt", "");
  const [aiChatSessions, setAiChatSessions] = useState([
    { id: "session_" + Date.now(), timestamp: Date.now(), messages: [{ role: "assistant", text: "Hi! How can I help you? Ask me to generate a request, or write tests for your last response." }] }
  ]);
  const [activeAiSessionId, setActiveAiSessionId] = useState(aiChatSessions[0].id);

  const aiChatHistory = useMemo(() => {
    const session = aiChatSessions.find(s => s.id === activeAiSessionId);
    return session ? session.messages : [];
  }, [aiChatSessions, activeAiSessionId]);

  const updateAiChatHistory = useCallback((updater) => {
    setAiChatSessions(prevSessions => {
      const sessionIndex = prevSessions.findIndex(s => s.id === activeAiSessionId);
      if (sessionIndex === -1) return prevSessions;

      const session = prevSessions[sessionIndex];
      const newHistory = typeof updater === 'function' ? updater(session.messages) : updater;
      
      const newSessions = [...prevSessions];
      newSessions[sessionIndex] = { ...session, messages: newHistory, timestamp: Date.now() };
      
      if (currentRequestId) {
        set(`ai_sessions_${currentRequestId}`, newSessions).catch(console.error);
      }
      return newSessions;
    });
  }, [activeAiSessionId, currentRequestId]);

  const createNewAiSession = useCallback(() => {
    const newSession = {
      id: "session_" + Date.now() + "_" + Math.random().toString(36).substring(2,9),
      timestamp: Date.now(),
      messages: [{ role: "assistant", text: "Hi! How can I help you? Ask me to generate a request, or write tests for your last response." }]
    };
    setAiChatSessions(prev => {
      const newSessions = [newSession, ...prev];
      if (currentRequestId) {
        set(`ai_sessions_${currentRequestId}`, newSessions).catch(console.error);
      }
      return newSessions;
    });
    setActiveAiSessionId(newSession.id);
  }, [currentRequestId]);
  const [isAiTyping, setIsAiTyping] = useState(false);
  const [showRightRail, setShowRightRail] = useLocalStorage("ui_showRightRail", false);
  const [activeRightTab, setActiveRightTab] = useLocalStorage("ui_activeRightTab", "ai");
  const [appLogs, setAppLogs] = useLocalStorage("ui_appLogs", []);
  const chatEndRef = useRef(null);

  const addLog = useCallback((logEntry) => {
    setAppLogs(prev => {
      const MAX_LOGS = 200;
      const newLogs = [...(prev || []), { timestamp: Date.now(), ...logEntry }];
      if (newLogs.length > MAX_LOGS) return newLogs.slice(newLogs.length - MAX_LOGS);
      return newLogs;
    });
  }, [setAppLogs]);


  const [aiProvider, setAiProvider] = useLocalStorage("ui_aiProvider", "openai");
  const [activeModel, setActiveModel] = useLocalStorage("ui_activeModel", "gpt-4o-mini");
  const [availableModels, setAvailableModels] = useState([]);
  const [aiApiKeyOpenAI, setAiApiKeyOpenAI] = useLocalStorage("ui_aiApiKeyOpenAI", "");
  const [aiApiKeyAnthropic, setAiApiKeyAnthropic] = useLocalStorage("ui_aiApiKeyAnthropic", "");
  const [aiApiKeyGemini, setAiApiKeyGemini] = useLocalStorage("ui_aiApiKeyGemini", "");
  const [aiSemanticSearchEnabled, setAiSemanticSearchEnabled] = useLocalStorage("ui_aiSemanticSearchEnabled", false);
  const [semanticProgress, setSemanticProgress] = useState(null);
  useEffect(() => {
    let isMounted = true;
    const fetchAvail = async () => {
      let key = "";
      if (aiProvider === "openai") key = aiApiKeyOpenAI;
      else if (aiProvider === "anthropic") key = aiApiKeyAnthropic;
      else if (aiProvider === "gemini") key = aiApiKeyGemini;

      if (!key) {
        if (isMounted) setAvailableModels([]);
        return;
      }

      const models = await fetchModels(aiProvider, key, addLog) || [];
      if (isMounted) {
        setAvailableModels(models);
        // Auto-select cheapest/default if nothing selected or current not in list
        if (models.length > 0 && !models.includes(activeModel)) {
          if (aiProvider === "openai") setActiveModel(models.includes("gpt-4o-mini") ? "gpt-4o-mini" : models[0]);
          else if (aiProvider === "anthropic") setActiveModel(models.includes("claude-3-5-haiku-latest") ? "claude-3-5-haiku-latest" : models[0]);
          else if (aiProvider === "gemini") setActiveModel(models.includes("gemini-1.5-flash") ? "gemini-1.5-flash" : models[0]);
          else setActiveModel(models[0]);
        }
      }
    };
    fetchAvail();
    return () => { isMounted = false; };
  }, [aiProvider, aiApiKeyOpenAI, aiApiKeyAnthropic, aiApiKeyGemini]); // Intentionally omitting activeModel to avoid loops

  useEffect(() => {
    if (aiSemanticSearchEnabled) {
      SemanticSearch.init((payload, type) => {
        if (type === 'PROGRESS' && payload.status === 'progress') {
          setSemanticProgress(`Downloading model... ${Math.round(payload.progress || 0)}%`);
        } else if (type === 'INDEX_PROGRESS') {
          setSemanticProgress(`Indexing ${payload.count}/${payload.total}...`);
        }
      }).then(() => {
        setSemanticProgress('Syncing index...');
        return SemanticSearch.indexAll(flattenCollections(collections));
      }).then(() => {
        setSemanticProgress('Ready & Synced');
        setTimeout(() => setSemanticProgress(null), 3000);
      }).catch(err => {
        setSemanticProgress('Error: ' + err.message);
        addLog({ source: "System", type: "error", message: `Semantic Search Error: ${err.message}` });
      });
    } else {
      setSemanticProgress(null);
    }
  }, [aiSemanticSearchEnabled, collections]);

  const [response, setResponse] = useState(null);
  const [responseSummary, setResponseSummary] = useState({ summary: "No response yet.", hints: [] });
  const responseCacheRef = React.useRef(new Map());
  const [error, setError] = useState("");
  const [activeSidebar, setActiveSidebar] = useLocalStorage("ui_activeSidebar", "Collections");
  const [showSettings, setShowSettings] = useState(false);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useLocalStorage("ui_sidebarCollapsed", false);
  const [isSending, setIsSending] = useState(false);
  const [activeHttpRequestId, setActiveHttpRequestId] = useState(null);

  // Protocol system state (per-request protocol is in useRequestState; these are protocol-specific UI state)
  const [graphqlResponse, setGraphqlResponse] = useState(null);
  const [grpcConfig, setGrpcConfig] = useState({});
  const [grpcResponse, setGrpcResponse] = useState(null);

  useEffect(() => {
    if (showRightRail && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [aiChatHistory, isAiTyping, showRightRail]);

  const [history, setHistory] = useLocalStorage("ui_history", []);
  const [historyRetentionDays, setHistoryRetentionDays] = useLocalStorage("ui_historyRetentionDays", 7);


  const {
    environments, setEnvironments,
    activeEnvId, setActiveEnvId,
    showEnvModal, setShowEnvModal,
    selectedEnvIds, setSelectedEnvIds,
    editingEnvKey, setEditingEnvKey,
    editingEnvDraft, setEditingEnvDraft,
    cmEnvEdit, setCmEnvEdit,
    getActiveEnv,
    getEnvVars,
    handleUpdateEnvVar,
    interpolate,
    redactSecrets
  } = useEnvironmentState();


  const [testsOutput, setTestsOutput] = useState([]);
  const [headersMode, setHeadersMode] = useLocalStorage("ui_headersMode", "table");
  const [testsMode, setTestsMode] = useLocalStorage("ui_testsMode", "post");
  const [showTestInput, setShowTestInput] = useState(false);
  const [showTestOutput, setShowTestOutput] = useState(false);
  const [selectedTablePath, setSelectedTablePath] = useState("$");
  const [showCollectionModal, setShowCollectionModal] = useState(false);
  const [selectedCollectionIds, setSelectedCollectionIds] = useState([]);
  const [showCollectionMenu, setShowCollectionMenu] = useState(false);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showImportTextModal, setShowImportTextModal] = useState(false);
  const [showImportApiModal, setShowImportApiModal] = useState(false);
  const [showImportCurlModal, setShowImportCurlModal] = useState(false);
  const [showImportCollisionModal, setShowImportCollisionModal] = useState(false);
  const [importCollisionData, setImportCollisionData] = useState(null);
  const [importCollisionNameDraft, setImportCollisionNameDraft] = useState("");
  const [importTextDraft, setImportTextDraft] = useState("");
  const [importApiDraft, setImportApiDraft] = useState("");
  const [importCurlDraft, setImportCurlDraft] = useState("");
  const [editingMainRequestName, setEditingMainRequestName] = useState(false);
  const [topSearch, setTopSearch] = useState("");

  const [showSnippetModal, setShowSnippetModal] = useState(false);
  const [snippetLanguage, setSnippetLanguage] = useState("curl");
  const [snippetInterpolate, setSnippetInterpolate] = useState(false);

  const [showExportModal, setShowExportModal] = useState(false);
  const [showGitHubSyncModal, setShowGitHubSyncModal] = useState(false);
  const [gitHubSyncState, setGitHubSyncState] = useState({
    status: "idle",
    label: "",
    detail: ""
  });
  const [exportTargetNode, setExportTargetNode] = useState(null);
  const [exportSelections, setExportSelections] = useState(new Set());
  const [exportCollapsedFolders, setExportCollapsedFolders] = useState(new Set());
  const [exportInterpolate, setExportInterpolate] = useState(true);

  // Manage Collections Tree State
  const [manageItemSelections, setManageItemSelections] = useState(new Set());
  const [manageCollapsedFolders, setManageCollapsedFolders] = useState(new Set());
  const [showEnvDropdown, setShowEnvDropdown] = useState(false);

  const [leftWidth, setLeftWidth] = useLocalStorage("ui_leftWidth", 260);
  const [rightWidth, setRightWidth] = useLocalStorage("ui_rightWidth", 260);
  const [topHeight, setTopHeight] = useLocalStorage("ui_topHeight", window.innerHeight / 2);
  const [draggingLeft, setDraggingLeft] = useState(false);
  const [draggingRight, setDraggingRight] = useState(false);
  const [draggingMain, setDraggingMain] = useState(false);

  const [showMoveModal, setShowMoveModal] = useState(false);
  const [itemToMove, setItemToMove] = useState(null);
  const [moveTargetId, setMoveTargetId] = useState("root");
  const [moveSearchQuery, setMoveSearchQuery] = useState("");
  const [wsClearSignal, setWsClearSignal] = useState(0);

  const [search, setSearch] = useState("");
  const [searchKey, setSearchKey] = useState("");
  const [sortKey, setSortKey] = useState("");
  const [sortDirection, setSortDirection] = useState("asc");
  const [derivedName, setDerivedName] = useState("");
  const [derivedExpr, setDerivedExpr] = useState("");
  const [derivedFields, setDerivedFields] = useState([]);

  function setActiveProtocolResponse(protocolId, nextResponse) {
    setResponse(nextResponse);
    if (protocolId === "graphql") {
      setGraphqlResponse(nextResponse);
      setGrpcResponse(null);
      return;
    }
    setGraphqlResponse(null);
    if (protocolId !== "grpc") {
      setGrpcResponse(null);
    }
  }

  function cacheResponseForRequest(requestId, nextResponse, nextSummary) {
    if (!requestId) return;
    const dataToSave = { response: nextResponse, responseSummary: nextSummary };
    responseCacheRef.current.set(requestId, dataToSave);
    set(`response_cache_${requestId}`, dataToSave).catch(console.error);
  }

  function restoreResponseForRequest(req, cached) {
    const nextResponse = cached?.response || null;
    const nextSummary = cached?.responseSummary || { summary: "No response yet.", hints: [] };
    setActiveProtocolResponse(req?.protocol || "http", nextResponse);
    setResponseSummary(nextSummary);
  }

  function clearActiveResponse(protocolId = protocol) {
    setActiveProtocolResponse(protocolId, null);
    setResponseSummary({ summary: "No response yet.", hints: [] });
  }

  function findRequestInItems(items, targetRequestId, folderPath = []) {
    for (const item of items || []) {
      if (item.type === "folder") {
        const nested = findRequestInItems(item.items || [], targetRequestId, [...folderPath, item.name]);
        if (nested) return nested;
        continue;
      }
      if (item.type === "request" && item.id === targetRequestId) {
        return { request: item, folderPath };
      }
    }
    return null;
  }

  function getCurrentRequestSyncContext() {
    const activeCollection = (collections || []).find((collection) => collection.id === activeCollectionId) || null;
    const located = activeCollection && currentRequestId
      ? findRequestInItems(activeCollection.items || [], currentRequestId)
      : null;

    return {
      requestId: currentRequestId || "",
      collectionId: activeCollection?.id || "",
      collectionName: activeCollection?.name || "Unassigned",
      folderPath: located?.folderPath || [],
      requestName: located?.request?.name || requestName || "New Request",
      protocol: protocol || "http"
    };
  }

  function handleCollectionSwitch(id) {
    syncDraftToCollection();
    setActiveCollectionId(id);
  }

  function handleRequestClick(req) {
    // Save current response to cache before switching
    if (currentRequestId) {
      cacheResponseForRequest(currentRequestId, response, responseSummary);
    }
    syncDraftToCollection();
    loadRequest(req);
    // Restore cached response for the target request
    if (req?.id) {
      if (responseCacheRef.current.has(req.id)) {
        restoreResponseForRequest(req, responseCacheRef.current.get(req.id));
      } else {
        // Try to load from persistent storage
        clearActiveResponse(req.protocol || "http");
        setResponseSummary({ summary: "Loading past response...", hints: [] });
        get(`response_cache_${req.id}`).then(cached => {
          if (cached) {
            responseCacheRef.current.set(req.id, cached);
            restoreResponseForRequest(req, cached);
          } else {
            clearActiveResponse(req.protocol || "http");
          }

          get(`ai_sessions_${req.id}`).then(sessions => {
            if (sessions && sessions.length > 0) {
              setAiChatSessions(sessions);
              setActiveAiSessionId(sessions[0].id);
            } else {
              const fresh = { id: "session_" + Date.now(), timestamp: Date.now(), messages: [{ role: "assistant", text: "Hi! How can I help you? Ask me to generate a request, or write tests for your last response." }] };
              setAiChatSessions([fresh]);
              setActiveAiSessionId(fresh.id);
            }
          }).catch(console.error);
        }).catch(() => {
          clearActiveResponse(req.protocol || "http");
        });
      }
    } else {
      clearActiveResponse(req?.protocol || "http");
      const fresh = { id: "session_" + Date.now(), timestamp: Date.now(), messages: [{ role: "assistant", text: "Hi! How can I help you? Ask me to generate a request, or write tests for your last response." }] };
      setAiChatSessions([fresh]);
      setActiveAiSessionId(fresh.id);
    }
    setError("");
  }

  // Effect to load the last active request when switching collections
  useEffect(() => {
    const lastRequestId = collectionActiveRequestIds[activeCollectionId];
    // Save current response before switching
    if (currentRequestId) {
      cacheResponseForRequest(currentRequestId, response, responseSummary);
    }
    if (lastRequestId) {
      if (currentRequestId !== lastRequestId) {
        const col = getActiveCollection();
        const findReq = (items) => {
          for (const item of items) {
            if (item.id === lastRequestId) return item;
            if (item.type === "folder" && item.items) {
              const res = findReq(item.items);
              if (res) return res;
            }
          }
          return null;
        };
        const req = findReq(col?.items || []);
        if (req) {
          loadRequest(req);
          // Restore cached response
          if (responseCacheRef.current.has(req.id)) {
            restoreResponseForRequest(req, responseCacheRef.current.get(req.id));
          } else {
            clearActiveResponse(req.protocol || "http");
            setResponseSummary({ summary: "Loading past response...", hints: [] });
            get(`response_cache_${req.id}`).then(cached => {
              if (cached) {
                responseCacheRef.current.set(req.id, cached);
                restoreResponseForRequest(req, cached);
              } else {
                clearActiveResponse(req.protocol || "http");
              }

              get(`ai_sessions_${req.id}`).then(sessions => {
                if (sessions && sessions.length > 0) {
                  setAiChatSessions(sessions);
                  setActiveAiSessionId(sessions[0].id);
                } else {
                  const fresh = { id: "session_" + Date.now(), timestamp: Date.now(), messages: [{ role: "assistant", text: "Hi! How can I help you? Ask me to generate a request, or write tests for your last response." }] };
                  setAiChatSessions([fresh]);
                  setActiveAiSessionId(fresh.id);
                }
              }).catch(console.error);
            }).catch(() => {
              clearActiveResponse(req.protocol || "http");
            });
          }
        } else {
          loadRequest(null);
          clearActiveResponse();
        }
      }
    } else {
      if (currentRequestId) {
        loadRequest(null);
        clearActiveResponse();
      }
    }
    setError("");
  }, [activeCollectionId]);

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
    if (Array.isArray(target)) {
      if (target.every((item) => Array.isArray(item))) {
        return target.flat();
      }
      return target;
    }
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
      if (e.target && typeof e.target.closest === "function") {
        if (!e.target.closest(".menu-wrap") && !e.target.closest(".menu")) {
          setShowCollectionMenu(false);
          setShowImportMenu(false);
        }
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

  const applyPersistedState = useCallback((state, historyValue) => {
    if (!state) return;
    try {
      if (state.method) setMethod(state.method);
      if (state.url) setUrl(state.url);
      if (state.headersText) setHeadersText(state.headersText);
      if (state.bodyText !== undefined) setBodyText(state.bodyText);
      if (state.testsPreText !== undefined) setTestsPreText(state.testsPreText);
      if (state.testsPostText !== undefined) setTestsPostText(state.testsPostText);
      if (state.testsInputText) setTestsInputText(state.testsInputText);
      if (state.httpVersion) setHttpVersion(state.httpVersion);
      if (state.requestTimeoutMs) setRequestTimeoutMs(state.requestTimeoutMs);
      if (state.bodyType) setBodyType(state.bodyType);
      if (state.paramsRows) setParamsRows(state.paramsRows);
      if (state.headersRows) setHeadersRows(state.headersRows);
      if (state.authRows) setAuthRows(state.authRows);
      if (state.authType !== undefined) setAuthType(state.authType);
      if (state.authConfig) setAuthConfig(state.authConfig);
      if (state.bodyRows) setBodyRows(state.bodyRows);
      if (state.graphqlConfig) setGraphqlConfig(state.graphqlConfig);
      if (state.wsConfig) setWsConfig(state.wsConfig);
      if (state.protocol) setProtocol(state.protocol);
      if (state.requestName !== undefined) setRequestName(state.requestName);
      if (state.currentRequestId !== undefined) setCurrentRequestId(state.currentRequestId);
      if (state.activeRequestTab) setActiveRequestTab(state.activeRequestTab);
      if (state.activeResponseTab) setActiveResponseTab(state.activeResponseTab);
      if (Array.isArray(state.collections) && state.collections.length > 0) {
        setCollections(state.collections);
      }
      if (state.activeCollectionId) setActiveCollectionId(state.activeCollectionId);
      if (Array.isArray(state.environments)) {
        setEnvironments(state.environments);
      }
      if (state.activeEnvId !== undefined) setActiveEnvId(state.activeEnvId);
      if (state.search !== undefined) setSearch(state.search);
      if (state.searchKey !== undefined) setSearchKey(state.searchKey);
      if (state.sortKey !== undefined) setSortKey(state.sortKey);
      if (state.sortDirection) setSortDirection(state.sortDirection);
      if (state.selectedTablePath) setSelectedTablePath(state.selectedTablePath);
      if (state.headersMode) setHeadersMode(state.headersMode);
      if (state.testsMode) setTestsMode(state.testsMode);
      if (state.historyRetentionDays !== undefined) setHistoryRetentionDays(state.historyRetentionDays);
      if (Array.isArray(historyValue)) {
        setHistory(historyValue);
      }
    } catch (err) {
      // ignore corrupt state
    }
  }, [
    setMethod,
    setUrl,
    setHeadersText,
    setBodyText,
    setTestsPreText,
    setTestsPostText,
    setTestsInputText,
    setHttpVersion,
    setRequestTimeoutMs,
    setBodyType,
    setParamsRows,
    setHeadersRows,
    setAuthRows,
    setAuthType,
    setAuthConfig,
    setBodyRows,
    setGraphqlConfig,
    setWsConfig,
    setProtocol,
    setRequestName,
    setCurrentRequestId,
    setActiveRequestTab,
    setActiveResponseTab,
    setCollections,
    setActiveCollectionId,
    setEnvironments,
    setActiveEnvId,
    setSearch,
    setSearchKey,
    setSortKey,
    setSortDirection,
    setSelectedTablePath,
    setHeadersMode,
    setTestsMode,
    setHistoryRetentionDays,
    setHistory
  ]);

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
        applyPersistedState(state);
      } catch (err) {
        // ignore corrupt state
      }
    });
    return () => {
      isMounted = false;
    };
  }, [applyPersistedState]);

  useEffect(() => {
    const payload = {
      method,
      url,
      headersText,
      bodyText,
      testsPreText,
      testsPostText,
      testsInputText,
      httpVersion,
      requestTimeoutMs,
      bodyType,
      paramsRows,
      headersRows,
      authRows,
      authType,
      authConfig,
      bodyRows,
      graphqlConfig,
      wsConfig,
      protocol,
      requestName,
      currentRequestId,
      historyRetentionDays,
      activeRequestTab,
      activeResponseTab,
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
    httpVersion,
    requestTimeoutMs,
    bodyType,
    paramsRows,
    headersRows,
    authRows,
    authType,
    authConfig,
    bodyRows,
    graphqlConfig,
    wsConfig,
    protocol,
    requestName,
    currentRequestId,
    historyRetentionDays,
    activeRequestTab,
    activeResponseTab,
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

  const handleGitHubSyncStateChange = useCallback((nextState) => {
    setGitHubSyncState(nextState || { status: "idle", label: "", detail: "" });
  }, []);

  const handlePulledState = useCallback((result) => {
    if (!result) return;
    applyPersistedState(result.appState, result.history);
  }, [applyPersistedState]);

  const gitHubSyncBadgeStyle = useMemo(() => {
    const status = gitHubSyncState?.status;
    if (status === "syncing" || status === "pulling") {
      return {
        color: "#7dd3fc",
        background: "rgba(56, 189, 248, 0.12)",
        border: "1px solid rgba(56, 189, 248, 0.24)"
      };
    }
    if (status === "synced" || status === "pulled") {
      return {
        color: "#34d399",
        background: "rgba(16, 185, 129, 0.12)",
        border: "1px solid rgba(16, 185, 129, 0.24)"
      };
    }
    if (status === "error") {
      return {
        color: "#f87171",
        background: "rgba(239, 68, 68, 0.12)",
        border: "1px solid rgba(239, 68, 68, 0.24)"
      };
    }
    return null;
  }, [gitHubSyncState]);

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
        httpVersion,
        requestTimeoutMs,
        bodyType,
        paramsRows,
        headersRows,
        authRows,
        authType,
        authConfig,
        bodyRows,
        graphqlConfig,
        wsConfig,
        protocol,
        requestName,
        currentRequestId,
        historyRetentionDays,
        activeRequestTab,
        activeResponseTab,
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
    httpVersion,
    requestTimeoutMs,
    bodyType,
    paramsRows,
    headersRows,
    authRows,
    authType,
    authConfig,
    bodyRows,
    graphqlConfig,
    wsConfig,
    protocol,
    requestName,
    currentRequestId,
    historyRetentionDays,
    activeRequestTab,
    activeResponseTab,
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
    let parsed = {};
    try {
      if (headersText && headersText.trim().length > 0) {
        parsed = JSON.parse(headersText);
      } else {
        parsed = headersRows
          .filter((row) => row.key && row.enabled !== false)
          .reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
      }
    } catch (err) {
      // If JSON is invalid, fall back to table rows if they exist, otherwise empty
      parsed = (headersRows || [])
        .filter((row) => row.key && row.enabled !== false)
        .reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
      console.warn("Header JSON invalid, falling back to table rows");
    }

    const authHeaders = getCompiledAuthHeaders(authType, authConfig, authRows, (v) => v);
    return { ...authHeaders, ...parsed };
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



  function handleImportCollisionSubmit() {
    if (!importCollisionData) return;
    const finalCol = { ...importCollisionData, name: importCollisionNameDraft.trim() || `${importCollisionData.name} Copy` };
    setCollections((prev) => [...prev, finalCol]);
    handleCollectionSwitch(finalCol.id);
    setShowImportCollisionModal(false);
    setImportCollisionData(null);
  }

  function tokenizeShellCommand(command) {
    const input = String(command || "").replace(new RegExp("\\\\\r?\\n", "g"), " ").trim();
    const tokens = [];
    let current = "";
    let quote = null;
    let escaping = false;

    for (let i = 0; i < input.length; i += 1) {
      const char = input[i];
      if (escaping) {
        current += char;
        escaping = false;
        continue;
      }
      if (char === "\\" && quote !== "'") {
        escaping = true;
        continue;
      }
      if (quote) {
        if (char === quote) {
          quote = null;
        } else {
          current += char;
        }
        continue;
      }
      if (char === "\"" || char === "'") {
        quote = char;
        continue;
      }
      if (/\s/.test(char)) {
        if (current) {
          tokens.push(current);
          current = "";
        }
        continue;
      }
      current += char;
    }

    if (current) tokens.push(current);
    return tokens;
  }

  function inferRequestNameFromUrl(value) {
    try {
      const parsed = new URL(value);
      const segments = parsed.pathname.split("/").filter(Boolean);
      return segments.length ? segments[segments.length - 1] : parsed.hostname;
    } catch {
      return "Imported cURL Request";
    }
  }

  function parseCurlCommand(command) {
    const tokens = tokenizeShellCommand(command);
    if (tokens.length === 0 || tokens[0] !== "curl") {
      throw new Error("Command must start with curl");
    }

    let method = "";
    let urlValue = "";
    let explicitMethod = false;
    let useQueryString = false;
    const headers = {};
    const dataParts = [];
    const formParts = [];

    const readValue = (index, label) => {
      const value = tokens[index + 1];
      if (value == null) throw new Error(`Missing value for ${label}`);
      return value;
    };

    for (let i = 1; i < tokens.length; i += 1) {
      const token = tokens[i];
      const nextValue = () => {
        const value = readValue(i, token);
        i += 1;
        return value;
      };

      if (token === "-X" || token === "--request") {
        method = nextValue().toUpperCase();
        explicitMethod = true;
        continue;
      }
      if (token.startsWith("--request=")) {
        method = token.split("=", 2)[1].toUpperCase();
        explicitMethod = true;
        continue;
      }
      if (token === "-H" || token === "--header") {
        const header = nextValue();
        const idx = header.indexOf(":");
        if (idx !== -1) {
          headers[header.slice(0, idx).trim()] = header.slice(idx + 1).trim();
        }
        continue;
      }
      if (token.startsWith("--header=")) {
        const header = token.split("=", 2)[1];
        const idx = header.indexOf(":");
        if (idx !== -1) {
          headers[header.slice(0, idx).trim()] = header.slice(idx + 1).trim();
        }
        continue;
      }
      if (["-d", "--data", "--data-raw", "--data-binary", "--data-ascii", "--data-urlencode"].includes(token)) {
        dataParts.push(nextValue());
        continue;
      }
      if (token.startsWith("--data=") || token.startsWith("--data-raw=") || token.startsWith("--data-binary=") || token.startsWith("--data-ascii=") || token.startsWith("--data-urlencode=")) {
        dataParts.push(token.split("=", 2)[1]);
        continue;
      }
      if (token === "-F" || token === "--form" || token === "--form-string") {
        formParts.push(nextValue());
        continue;
      }
      if (token.startsWith("--form=") || token.startsWith("--form-string=")) {
        formParts.push(token.split("=", 2)[1]);
        continue;
      }
      if (token === "-G" || token === "--get") {
        useQueryString = true;
        continue;
      }
      if (token === "--url") {
        urlValue = nextValue();
        continue;
      }
      if (token.startsWith("--url=")) {
        urlValue = token.split("=", 2)[1];
        continue;
      }
      if (token === "-u" || token === "--user") {
        const creds = nextValue();
        headers["Authorization"] = `Basic ${btoa(creds)}`;
        continue;
      }
      if (!token.startsWith("-") && !urlValue) {
        urlValue = token;
      }
    }

    if (!urlValue) {
      throw new Error("cURL command does not contain a URL");
    }

    const normalizedMethod = explicitMethod
      ? method
      : (formParts.length > 0 || dataParts.length > 0) && !useQueryString
        ? "POST"
        : "GET";

    let finalUrl = urlValue;
    let bodyType = "none";
    let bodyTextValue = "";
    let bodyRowsValue = [{ key: "", value: "", enabled: true }];

    if (useQueryString && dataParts.length > 0) {
      const urlObject = new URL(finalUrl);
      dataParts.forEach((part) => {
        const [key, value = ""] = part.split("=", 2);
        urlObject.searchParams.append(key, value);
      });
      finalUrl = urlObject.toString();
    } else if (formParts.length > 0) {
      bodyType = "multipart";
      bodyRowsValue = formParts.map((part) => {
        const [key, rawValue = ""] = part.split("=", 2);
        if (rawValue.startsWith("@")) {
          const filePath = rawValue.slice(1);
          const fileName = filePath.split(/[\/]/).pop() || "upload.bin";
          return {
            key,
            value: "",
            enabled: true,
            kind: "file",
            fileName,
            fileBase64: "",
            mimeType: "application/octet-stream",
            sourcePath: filePath
          };
        }
        return { key, value: rawValue, enabled: true, kind: "text" };
      });
    } else if (dataParts.length > 0 && !useQueryString) {
      const joined = dataParts.join("&");
      const contentType = Object.keys(headers).find((key) => key.toLowerCase() === "content-type");
      const contentTypeValue = contentType ? headers[contentType].toLowerCase() : "";
      if (contentTypeValue.includes("application/json") || /^[\[{]/.test(joined.trim())) {
        bodyType = "json";
        bodyTextValue = joined;
      } else if (contentTypeValue.includes("application/x-www-form-urlencoded") || dataParts.every((part) => part.includes("="))) {
        bodyType = "form";
        bodyRowsValue = dataParts.map((part) => {
          const [key, value = ""] = part.split("=", 2);
          return { key, value, enabled: true };
        });
      } else {
        bodyType = "raw";
        bodyTextValue = joined;
      }
    }

    let paramsRowsValue = [{ key: "", value: "", enabled: true }];
    try {
      const urlObject = new URL(finalUrl);
      const paramRows = Array.from(urlObject.searchParams.entries()).map(([key, value]) => ({ key, value, enabled: true }));
      paramsRowsValue = paramRows.length > 0 ? paramRows : paramsRowsValue;
      urlObject.search = "";
      finalUrl = urlObject.toString();
    } catch {
      // ignore URL parsing failure
    }

    const headersRowsValue = Object.keys(headers).length > 0 ? objectToRows(headers) : [{ key: "", value: "", enabled: true }];
    const requestName = inferRequestNameFromUrl(finalUrl);

    return {
      type: "request",
      id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: requestName,
      description: "",
      tags: [],
      protocol: "http",
      method: normalizedMethod,
      url: finalUrl,
      headersText: JSON.stringify(headers, null, 2),
      bodyText: bodyTextValue,
      testsPreText: "",
      testsPostText: "",
      testsInputText: '{\n  "status": 200,\n  "body": {"ok": true}\n}',
      httpVersion: "auto",
      requestTimeoutMs: 30000,
      bodyType,
      paramsRows: paramsRowsValue,
      headersRows: headersRowsValue,
      authRows: [{ key: "Authorization", value: "Bearer <token>", comment: "", enabled: false }],
      authType: "none",
      authConfig: {
        bearer: { token: "" },
        basic: { username: "", password: "" },
        api_key: { key: "", value: "", add_to: "header" }
      },
      bodyRows: bodyRowsValue,
      graphqlConfig: {
        query: "",
        variables: "{}",
        operationName: "",
        headers: {}
      },
      wsConfig: {
        headersText: "{\n}",
        headersRows: [{ key: "", value: "", comment: "", enabled: true }],
        headersMode: "table",
        protocolsText: "",
        protocolRows: [{ key: "", value: "", comment: "", enabled: true }],
        autoReconnect: false,
        reconnectInterval: 3000,
        connectTimeout: 10000,
        messageType: "text",
        messages: []
      }
    };
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
          handleCollectionSwitch(parsedCol.id);
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
      handleCollectionSwitch(parsedCol.id);
      setShowImportTextModal(false);
      setImportTextDraft("");
    } catch (err) {
      alert("Failed to parse the provided text as JSON. Error: " + err.message);
    }
  }

  function handleImportCurlSubmit() {
    if (!importCurlDraft.trim()) return;
    try {
      const parsedReq = parseCurlCommand(importCurlDraft);
      const createdReq = addRequestToCollection(null, (req) => Object.assign(req, parsedReq));
      if (createdReq) {
        handleRequestClick(createdReq);
      }
      setShowImportCurlModal(false);
      setImportCurlDraft("");
    } catch (err) {
      alert("Failed to parse the provided cURL command. Error: " + err.message);
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
        handleCollectionSwitch(parsedCol.id);
        setShowImportApiModal(false);
        setImportApiDraft("");
      })
      .catch(err => {
        alert("Failed to fetch or parse the collection from the URL. Error: " + err.message);
      });
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
      <div key={node.id} style={{ marginLeft: depth > 0 ? '16px' : '0', paddingLeft: '24px' }} className="export-row">
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

  function renderManageTree(node, depth = 0) {
    if (!node) return null;

    const isNodeSelected = (n) => {
      if (n.type === "request") return manageItemSelections.has(n.id);
      if (!n.items || n.items.length === 0) return manageItemSelections.has(n.id);
      return n.items.every(child => isNodeSelected(child));
    };

    const isSelected = isNodeSelected(node);

    const toggle = () => {
      const next = new Set(manageItemSelections);
      if (isSelected) {
        const removeIds = (n) => { next.delete(n.id); if (n.items) n.items.forEach(removeIds); };
        removeIds(node);
      } else {
        const addIds = (n) => { next.add(n.id); if (n.items) n.items.forEach(addIds); };
        addIds(node);
      }
      setManageItemSelections(next);
    };

    if (node.type === "folder" || node.id.startsWith("col-")) {
      const isCollapsed = manageCollapsedFolders.has(node.id);
      const toggleCollapse = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = new Set(manageCollapsedFolders);
        if (isCollapsed) next.delete(node.id);
        else next.add(node.id);
        setManageCollapsedFolders(next);
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
              {node.items.map(child => renderManageTree(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    const methodColorClass = node.method ? node.method.toLowerCase() : 'get';

    return (
      <div key={node.id} style={{ marginLeft: depth > 0 ? '16px' : '0', paddingLeft: '24px' }} className="export-row">
        <label>
          <input type="checkbox" checked={isSelected} onChange={toggle} />
          <span className={`export-badge ${methodColorClass}`}>{node.method || 'GET'}</span>
          <span className="export-title" title={node.name}>{node.name}</span>
        </label>
      </div>
    );
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
    let isMultipart = false;
    if (bodyType === "json") {
      reqBody = stripJsonComments(val(bodyText));
    } else if (bodyType === "form") {
      const data = rowsToObject(bodyRows, snippetInterpolate);
      reqBody = new URLSearchParams(data).toString();
    } else if (bodyType === "multipart") {
      isMultipart = true;
      reqBody = null; // we'll use -F flags instead
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
      // For multipart, skip Content-Type header (curl adds it automatically with -F)
      Object.entries(headerObj).forEach(([k, v]) => {
        if (isMultipart && k.toLowerCase() === "content-type") return;
        curl += ` \\\n  -H '${k}: ${v}'`;
      });
      if (isMultipart && reqMethod !== "GET") {
        (bodyRows || []).filter((row) => row.key && row.enabled !== false).forEach((row) => {
          if (row.kind === "file") {
            curl += ` \\\n  -F '${val(row.key)}=@${row.fileName || "upload.bin"}'`;
            return;
          }
          curl += ` \\\n  -F '${val(row.key)}=${val(row.value || "")}'`;
        });
      } else if (reqBody && reqMethod !== "GET") {
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
    return aiPrompt || "";
  }

  async function handleLoadHistory(item) {
    if (!item || !item.request) return;
    const req = item.request;
    const res = item.response;

    const mockReq = {
      name: "History Request",
      protocol: req.protocol || "http",
      method: req.method,
      url: req.url,
      bodyText: req.body || "",
      httpVersion: req.httpVersion || "auto",
      requestTimeoutMs: req.timeoutMs || 30000,
      bodyType: req.body ? "raw" : "none"
    };

    if (req.protocol === "graphql") {
      mockReq.graphqlConfig = {
        query: req.query || "",
        variables: typeof req.variables === "string" ? req.variables : JSON.stringify(req.variables || {}, null, 2),
        operationName: req.operationName || "",
        headers: req.headers || {}
      };
    }

    if (req.headers && Object.keys(req.headers).length > 0) {
      const hRows = Object.entries(req.headers).map(([k, v]) => ({ key: k, value: String(v), enabled: true }));
      hRows.push({ key: "", value: "", enabled: true });
      mockReq.headersRows = hRows;
      mockReq.headersText = JSON.stringify(req.headers, null, 2);
    }

    // Restore the workspace
    loadRequest(mockReq);

    // Restore the response
    if (res) {
      setActiveProtocolResponse(mockReq.protocol, res);
      const summary = await summarizeResponse(res);
      setResponseSummary(summary);
    } else {
      clearActiveResponse(mockReq.protocol);
      setResponseSummary({ summary: "No response recorded.", hints: [] });
    }
  }

  async function handleCancelHttpSend() {
    if (!activeHttpRequestId || !window.api?.cancelRequest) return;
    await window.api.cancelRequest({ requestId: activeHttpRequestId });
  }

  async function handleSend() {
    setIsSending(true);
    const requestId = `http-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setActiveHttpRequestId(requestId);
    setResponse(null);
    setResponseSummary({ summary: "Sending request...", hints: [] });
    setError("");
    try {
      const headers = parseHeaders();
      if (headers === null) return;
      let body = bodyType === "none" ? undefined : bodyText;
      let multipartParts;
      if (bodyType === "json") {
        const strippedJson = stripJsonComments(interpolate(bodyText));
        if (strippedJson.trim()) {
          try {
            body = JSON.stringify(JSON.parse(strippedJson));
          } catch (err) {
            setError(`Invalid JSON body: ${err.message}`);
            setResponseSummary({ summary: "Invalid JSON body.", hints: ["Fix the JSON syntax before sending."] });
            return;
          }
        } else {
          body = "";
        }
      }
      if (bodyType === "form") {
        const data = rowsToObject(bodyRows);
        body = new URLSearchParams(data).toString();
      }
      if (bodyType === "multipart") {
        multipartParts = (bodyRows || [])
          .filter((row) => row.key && row.enabled !== false)
          .map((row) => (
            row.kind === "file"
              ? {
                  kind: "file",
                  name: interpolate(row.key),
                  filename: row.fileName || "upload.bin",
                  contentType: row.mimeType || "application/octet-stream",
                  dataBase64: row.fileBase64 || ""
                }
              : {
                  kind: "text",
                  name: interpolate(row.key),
                  value: interpolate(row.value || "")
                }
          ));
        body = undefined;
      }
      if (bodyType === "xml") {
        body = interpolate(bodyText);
      }
      if (bodyType === "raw") {
        body = interpolate(bodyText);
      }
      const payload = {
        requestId,
        method,
        url: buildUrlWithParams(),
        headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, interpolate(v)])),
        body,
        multipartParts,
        timeoutMs: requestTimeoutMs,
        httpVersion
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
      await runScript(testsPreText, preContext, preOutput);
      payload.method = preContext.request.method || payload.method;
      payload.url = preContext.request.url || payload.url;
      payload.headers = preContext.request.headers || payload.headers;
      payload.body = preContext.request.body ?? payload.body;
      if (preOutput.length) {
        setTestsOutput(preOutput);
        setShowTestOutput(true);
      }

      addLog({ source: "API", type: "info", message: `Sending ${payload.method} ${payload.url}` });

      const result = await window.api.sendRequest(payload);

      if (result.cancelled) {
        addLog({ source: "API", type: "info", message: `Request cancelled: ${payload.method} ${payload.url}` });
        setResponseSummary({ summary: "Request cancelled.", hints: [] });
        return;
      }

      if (result.error) {
        setError(result.error);
        addLog({ source: "API", type: "error", message: `Request Error: ${payload.method} ${payload.url}`, data: result.error });
      } else {
        addLog({ source: "API", type: result.status >= 400 ? "error" : "success", message: `Response: ${result.status} ${result.statusText} (${result.time}ms) ${result.httpVersion ? `[${result.httpVersion}]` : ""}`.trim() });
      }

      setResponse(result);
      const summary = await summarizeResponse(result);
      setResponseSummary(summary);

      // Cache response for this request so it persists on navigation and app reload
      if (currentRequestId) {
        const dataToSave = { response: result, responseSummary: summary };
        responseCacheRef.current.set(currentRequestId, dataToSave);
        set(`response_cache_${currentRequestId}`, dataToSave).catch(console.error);
      }

      const now = Date.now();

      const redactedPayload = { ...payload };
      redactedPayload.url = redactSecrets(redactedPayload.url);
      if (redactedPayload.headers) {
        redactedPayload.headers = Object.fromEntries(
          Object.entries(redactedPayload.headers).map(([k, v]) => [k, redactSecrets(v)])
        );
      }
      if (redactedPayload.body) {
        redactedPayload.body = redactSecrets(redactedPayload.body);
      }

      const requestContext = getCurrentRequestSyncContext();
      const historyEntry = {
        timestamp: now,
        request: {
          ...redactedPayload,
          ...requestContext,
          protocol: "http",
          httpVersion,
          timeoutMs: requestTimeoutMs
        },
        response: result
      };
      const retentionMs = historyRetentionDays * 24 * 60 * 60 * 1000;
      setHistory(prev => {
        const next = [...(prev || []), historyEntry].filter(h => now - h.timestamp < retentionMs);
        return next;
      });

      const postOutput = [];
      await runScript(testsPostText, { request: payload, response: result }, postOutput);
      if (postOutput.length) {
        setTestsOutput(postOutput);
        setShowTestOutput(true);
      }
    } finally {
      setActiveHttpRequestId(null);
      setIsSending(false);
    }
  }

  async function handleGraphQLSend() {
    if (!url.trim()) return;
    setIsSending(true);
    clearActiveResponse("graphql");
    setResponseSummary({ summary: "Sending request...", hints: [] });
    setError("");
    try {
      const headers = parseHeaders();
      if (headers === null) return;

      const validation = GraphQLProtocol.validateRequest({
        url: interpolate(url),
        query: interpolate(graphqlConfig.query || ""),
        variables: interpolate(graphqlConfig.variables || "{}")
      });
      if (!validation.valid) {
        const message = validation.errors.join("\n");
        setError(message);
        setActiveProtocolResponse("graphql", GraphQLProtocol.parseResponse({ error: message }));
        return;
      }

      const requestPayload = GraphQLProtocol.buildRequest({
        url: interpolate(url),
        query: interpolate(graphqlConfig.query || ""),
        variables: interpolate(graphqlConfig.variables || "{}"),
        operationName: interpolate(graphqlConfig.operationName || ""),
        headers: headers ? Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, interpolate(v)])) : {}
      });

      const preOutput = [];
      const preContext = {
        request: {
          method: "POST",
          url: requestPayload.url,
          headers: { ...requestPayload.headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            query: requestPayload.query,
            variables: requestPayload.variables,
            operationName: requestPayload.operationName || undefined
          })
        },
        response: null
      };
      await runScript(testsPreText, preContext, preOutput);
      if (preOutput.length) {
        setTestsOutput(preOutput);
        setShowTestOutput(true);
      }

      addLog({ source: "API", type: "info", message: `Sending GraphQL POST ${requestPayload.url}` });

      const rawResult = await window.api.sendGraphQL(requestPayload);
      const result = GraphQLProtocol.parseResponse(rawResult);

      if (result.error) {
        setError(result.error);
        addLog({ source: "API", type: "error", message: `GraphQL Error: POST ${requestPayload.url}`, data: result.error });
      } else {
        addLog({
          source: "API",
          type: result.status >= 400 || result.hasErrors ? "error" : "success",
          message: `GraphQL Response: ${result.status} ${result.statusText} (${result.time || result.duration}ms)`
        });
      }

      setActiveProtocolResponse("graphql", result);
      const summary = await summarizeResponse(result);
      setResponseSummary(summary);
      cacheResponseForRequest(currentRequestId, result, summary);

      const now = Date.now();
      const requestContext = getCurrentRequestSyncContext();
      const historyEntry = {
        timestamp: now,
        request: {
          ...requestContext,
          protocol: "graphql",
          method: "POST",
          url: redactSecrets(requestPayload.url),
          headers: Object.fromEntries(
            Object.entries(requestPayload.headers || {}).map(([k, v]) => [k, redactSecrets(v)])
          ),
          query: redactSecrets(requestPayload.query || ""),
          variables: requestPayload.variables,
          operationName: requestPayload.operationName || ""
        },
        response: result
      };
      const retentionMs = historyRetentionDays * 24 * 60 * 60 * 1000;
      setHistory(prev => [...(prev || []), historyEntry].filter(h => now - h.timestamp < retentionMs));

      const postOutput = [];
      await runScript(testsPostText, { request: preContext.request, response: result }, postOutput);
      if (postOutput.length) {
        setTestsOutput(postOutput);
        setShowTestOutput(true);
      }
    } catch (err) {
      const result = GraphQLProtocol.parseResponse({ error: err.message });
      setActiveProtocolResponse("graphql", result);
      setError(err.message);
    } finally {
      setIsSending(false);
    }
  }

  async function handleGrpcSend() {
    if (!url.trim()) return;
    setIsSending(true);
    setGrpcResponse(null);
    try {
      // gRPC calls are currently a placeholder - requires native module
      // For now we show the config validation
      const validation = GrpcProtocol.validateRequest({
        url,
        service: grpcConfig.service,
        method: grpcConfig.method,
        requestBody: grpcConfig.requestBody
      });
      if (!validation.valid) {
        setGrpcResponse({ error: validation.errors.join("\n"), statusCode: 2 });
      } else {
        setGrpcResponse({
          error: "gRPC native transport not yet available. Install @grpc/grpc-js to enable.",
          statusCode: 12 // UNIMPLEMENTED
        });
      }
    } catch (err) {
      setGrpcResponse({ error: err.message, statusCode: 13 });
    } finally {
      setIsSending(false);
    }
  }

  // Unified send dispatcher that routes to the right protocol
  function handleProtocolSend() {
    switch (protocol) {
      case "graphql": return handleGraphQLSend();
      case "grpc": return handleGrpcSend();
      case "http":
      default: return handleSend();
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
    const aiSettings = {
      provider: aiProvider,
      model: activeModel,
      keys: {
        openai: aiApiKeyOpenAI,
        anthropic: aiApiKeyAnthropic,
        gemini: aiApiKeyGemini
      }
    };
    const tests = await generateTestsFromResponse({ method, url }, response, aiSettings);
    setActiveRequestTab("Tests");
    setTestsPostText(tests.join("\n"));
  }

  async function handleAiChatSubmit(overridePrompt) {
    const textToSubmit = typeof overridePrompt === 'string' ? overridePrompt : aiPrompt;
    if (!textToSubmit.trim()) return;

    const userMsg = { role: "user", text: textToSubmit };
    const newHistory = [...aiChatHistory, userMsg];
    updateAiChatHistory(newHistory);

    const currentPrompt = textToSubmit;
    if (typeof overridePrompt !== 'string') {
      setAiPrompt("");
    }
    setIsAiTyping(true);

    const aiSettings = {
      provider: aiProvider,
      model: activeModel,
      keys: {
        openai: aiApiKeyOpenAI,
        anthropic: aiApiKeyAnthropic,
        gemini: aiApiKeyGemini
      },
      semanticSearchEnabled: aiSemanticSearchEnabled
    };
    const currentState = { method, url, headersText, bodyText, protocol, graphqlConfig };
    const responseData = response ? { status: response.status, statusText: response.statusText, headers: response.headers, body: response.body || (response.json ? JSON.stringify(response.json) : "") } : null;

    // Feature 1: Pre-flight check. If asking about response but no response exists, abort the API call.
    const promptLower = textToSubmit.toLowerCase();
    const needsResponse = promptLower.includes("response") || promptLower.includes("extract") || promptLower.includes("result");
    
    if (needsResponse && !responseData) {
      setTimeout(() => {
        setIsAiTyping(false);
        updateAiChatHistory(prev => [...prev, { 
          role: "assistant", 
          text: "It looks like you want me to analyze the response, but you haven't clicked **Send** on the request yet. Please run the request first so I have data to extract!" 
        }]);
      }, 600); // Small delay to feel natural
      return;
    }

    try {
      {
        const finalPrompt = currentPrompt;
        const output = await generateRequestFromPrompt(finalPrompt, currentState, collections, aiSettings, activeAiSessionId, aiChatSessions, responseData);
        console.log("[AI DEBUG] Raw AI output:", JSON.stringify(output, null, 2));

        let assistantMsg = output.message || "I have updated the workspace.";
        
        // Some AI models append extra data fields (like "extractedData") outside the designated schema.
        // Catch all unrecognized top-level keys and append them as a formatted markdown block.
        const knownKeys = ['message', 'operations', '_usage', '_model'];
        const extraFields = {};
        for (const [key, value] of Object.entries(output)) {
          if (!knownKeys.includes(key) && value) {
             extraFields[key] = value;
          }
        }
        if (Object.keys(extraFields).length > 0) {
          assistantMsg += '\n\n```json\n' + JSON.stringify(extraFields, null, 2) + '\n```';
        }

        let suggestedEndpoints = null;
        let shouldSend = false;

        if (output.operations && Array.isArray(output.operations)) {
          console.log("[AI DEBUG] Found", output.operations.length, "operations");
          output.operations.forEach(op => {
            console.log("[AI DEBUG] Processing operation:", op.type, JSON.stringify(op.payload));
            if (op.type === "UPDATE_CURRENT_REQUEST") {
              if (op.payload.method) setMethod(op.payload.method);
              if (op.payload.url) setUrl(op.payload.url);
              if (op.payload.headersText) setHeadersText(op.payload.headersText);
              
              if (protocol === "graphql" || (op.payload.protocol === "graphql")) {
                setGraphqlConfig(prev => ({
                  ...prev,
                  query: op.payload.query || op.payload.bodyText || prev.query,
                  variables: op.payload.variables || prev.variables
                }));
              } else {
                if (op.payload.bodyText) setBodyText(op.payload.bodyText);
              }
            } else if (op.type === "UPDATE_REQUEST_BY_ID") {
              setCollections(prev => prev.map(col => ({
                ...col,
                requests: col.requests.map(req => req.id === op.payload.id ? { ...req, ...op.payload.updates } : req)
              })));
            } else if (op.type === "SUGGEST_ENDPOINTS") {
              suggestedEndpoints = op.payload.endpoints;
            } else if (op.type === "SEND_REQUEST") {
              shouldSend = true;
            } else if (op.type === "GENERATE_TESTS") {
              if (op.payload && op.payload.tests && Array.isArray(op.payload.tests)) {
                setActiveRequestTab("Tests");
                setTestsPostText(op.payload.tests.join("\n"));
                assistantMsg += "\n\n*(Tests have been added to your Tests > Post-response script tab.)*";
              }
            } else if (op.type === "DELETE_REQUEST") {
              if (op.payload && op.payload.requestId) {
                deleteRequest(op.payload.requestId);
                assistantMsg += "\n\n*(Request has been deleted from your workspace.)*";
              }
            } else if (op.type === "MOVE_REQUEST") {
              if (op.payload && op.payload.requestId && op.payload.targetCollectionId) {
                moveItemInCollection(op.payload.requestId, op.payload.targetFolderId || op.payload.targetCollectionId, true);
                assistantMsg += "\n\n*(Request has been moved.)*";
              }
            } else if (op.type === "CREATE_REQUEST") {
              const newReqId = "req-" + Date.now().toString() + "-" + Math.random().toString(36).substr(2, 5);
              let targetColId = op.payload.collectionId;
              let targetColName = op.payload.newCollectionName || "";

              let newHeadersRows = [{ key: "", value: "", enabled: true }];
              if (op.payload.headersText) {
                try {
                  const parsed = JSON.parse(op.payload.headersText);
                  newHeadersRows = objectToRows(parsed);
                } catch (e) {
                  try {
                    const headerObj = {};
                    op.payload.headersText.split('\n').forEach(line => {
                      const idx = line.indexOf(':');
                      if (idx > 0) {
                        headerObj[line.substring(0, idx).trim()] = line.substring(idx + 1).trim();
                      }
                    });
                    if (Object.keys(headerObj).length > 0) {
                      newHeadersRows = objectToRows(headerObj);
                    }
                  } catch (e2) { }
                }
              }

              if (op.payload.newCollectionName) {
                const existing = collections.find(c => c.name.toLowerCase() === op.payload.newCollectionName.toLowerCase());
                if (existing) {
                  targetColId = existing.id;
                  targetColName = existing.name;
                } else {
                  targetColId = "col-" + Date.now().toString() + "-" + Math.random().toString(36).substr(2, 5);
                  targetColName = op.payload.newCollectionName;
                }
              } else if (!targetColId || !collections.find(c => c.id === targetColId)) {
                targetColId = activeCollectionId || (collections.length > 0 ? collections[0].id : null);
              }

              if (!targetColName && targetColId) {
                targetColName = collections.find(c => c.id === targetColId)?.name || "your workspace";
              }

              const newRequest = {
                type: "request",
                id: newReqId,
                name: op.payload.name || "New AI Request",
                description: "",
                tags: [],
                method: op.payload.method || "GET",
                url: op.payload.url || "",
                headersText: "",
                bodyText: op.payload.bodyText || "",
                testsPreText: "",
                testsPostText: "",
                testsInputText: "",
                bodyType: "json",
                paramsRows: [{ key: "", value: "", enabled: true }],
                headersRows: newHeadersRows,
                authRows: [{ key: "", value: "", enabled: false }],
                bodyRows: [{ key: "", value: "", enabled: true }]
              };

              setCollections(prev => {
                let updated = [...prev];
                if (op.payload.newCollectionName && !updated.find(c => c.id === targetColId)) {
                  updated.push({ id: targetColId, name: targetColName, items: [] });
                }
                if (!targetColId) return updated;
                return updated.map(col => {
                  if (col.id === targetColId) {
                    return { ...col, items: [...(col.items || []), newRequest] };
                  }
                  return col;
                });
              });

              if (targetColId) {
                setTimeout(() => {
                  setActiveCollectionId(targetColId);
                  handleRequestClick(newRequest);
                }, 150);
              }

              console.log("[AI DEBUG] Created request", newReqId, "in collection", targetColId, targetColName);
              assistantMsg += `\n\n*(Note: I've placed this new request into your **${targetColName}** collection, and opened it for you!)*`;
            }
          });
        }

        setIsAiTyping(false);
        const finalHistory = [...newHistory];
        if (output._usage?.input) {
          finalHistory[finalHistory.length - 1] = {
            ...finalHistory[finalHistory.length - 1],
            usage: { input: output._usage.input }
          };
        }

        updateAiChatHistory([...finalHistory, {
          role: "assistant",
          text: assistantMsg,
          suggestedEndpoints,
          model: output._model || activeModel,
          usage: output._usage?.output ? { output: output._usage.output } : null
        }]);

        if (shouldSend) {
          setTimeout(() => {
            handleProtocolSend();
          }, 300);
        }
      }
    } catch (err) {
      setIsAiTyping(false);
      updateAiChatHistory([...newHistory, { role: "assistant", text: `AI Error: ${err.message}` }]);
    }
  }

  const handleChatKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAiChatSubmit();
    }
  };

  async function runTests() {
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
        await runScript(testsPreText, ctx, out, "pre-script");
      } else {
        await runScript(testsPostText, ctx, out, "post-script");
      }
      setTestsOutput(out.length ? out : [{ type: "info", text: "Tests executed.", label: testsMode }]);
      setShowTestOutput(true);
    } catch (err) {
      setTestsOutput([{ type: "error", text: err.message, label: testsMode, errorType: err.name }]);
      setShowTestOutput(true);
    }
  }

  async function runScript(code, context, output, label) {
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
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    // eslint-disable-next-line no-new-func
    const fn = new AsyncFunction("context", "api", "pm", "output", code);
    await fn({ request, response }, api, pm, safeOutput);
  }

  function buildPm(request, response, output, label) {
    const env = environments.find((entry) => entry.id === activeEnvId) || null;
    const collection = collections.find((entry) => entry.id === activeCollectionId) || null;

    const readCollectionVar = (key) => {
      const vars = collection?.variables || {};
      return vars[key];
    };
    const writeCollectionVar = (key, value) => {
      setCollections((prev) => prev.map((entry) => {
        if (entry.id !== activeCollectionId) return entry;
        return {
          ...entry,
          variables: {
            ...(entry.variables || {}),
            [key]: value
          }
        };
      }));
    };
    const unsetCollectionVar = (key) => {
      setCollections((prev) => prev.map((entry) => {
        if (entry.id !== activeCollectionId) return entry;
        const nextVars = { ...(entry.variables || {}) };
        delete nextVars[key];
        return { ...entry, variables: nextVars };
      }));
    };

    const readEnvVar = (key) => env?.vars?.find((row) => row.key === key && row.enabled !== false)?.value;
    const writeEnvVar = (key, value) => handleUpdateEnvVar(key, value);
    const unsetEnvVar = (key) => {
      if (!activeEnvId) return;
      setEnvironments((prev) => prev.map((entry) => {
        if (entry.id !== activeEnvId) return entry;
        return {
          ...entry,
          vars: (entry.vars || []).filter((row) => row.key !== key)
        };
      }));
    };

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
        },
        to: {
          have: {
            status: (expected) => {
              const actual = response?.status ?? response?.code ?? 0;
              if (actual !== expected) throw new Error(`Expected status ${expected} but got ${actual}`);
            }
          }
        }
      },
      environment: {
        get: (key) => readEnvVar(key),
        set: (key, value) => writeEnvVar(key, value),
        unset: (key) => unsetEnvVar(key),
        toObject: () => getEnvVars()
      },
      variables: {
        get: (key) => readEnvVar(key),
        set: (key, value) => writeEnvVar(key, value),
        unset: (key) => unsetEnvVar(key),
        toObject: () => getEnvVars()
      },
      collectionVariables: {
        get: (key) => readCollectionVar(key),
        set: (key, value) => writeCollectionVar(key, value),
        unset: (key) => unsetCollectionVar(key),
        toObject: () => ({ ...(collection?.variables || {}) })
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
          exist: () => {
            if (value === null || value === undefined) throw new Error("Expected value to exist");
          },
          have: {
            property: (prop) => {
              if (value == null || !(prop in Object(value))) {
                throw new Error(`Expected property ${prop} to exist`);
              }
            }
          },
          contain: (expected) => {
            if (!String(value).includes(String(expected))) {
              throw new Error(`Expected ${value} to contain ${expected}`);
            }
          }
        }
      }),
      sendRequest: async (config) => {
        const result = await window.api.sendRequest({
          method: config.method || "GET",
          url: interpolate(config.url || ""),
          headers: config.headers || {},
          body: config.body,
          httpVersion: config.httpVersion || httpVersion,
          timeoutMs: config.timeoutMs || requestTimeoutMs
        });
        return result;
      }
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
    <div className={styles.app}>
      <header className="flex justify-between items-center p-3 bg-panel border-b border-border shadow-sm" style={{ background: "linear-gradient(90deg, #141a28, #10131c)" }}>
        <div className="flex items-center gap-2">
          <img src={logo} alt="Commu Logo" style={{ height: '24px', width: 'auto', marginRight: '6px' }} />
          <div className={styles.brand} style={{ fontSize: '1.2rem', background: 'linear-gradient(90deg, #fff, var(--muted))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: '700', marginRight: '10px' }}>commu</div>
          <Button
            variant={activeSidebar === "Collections" ? "secondary" : "ghost"}
            onClick={() => setActiveSidebar("Collections")}
            size="sm"
          >
            Collections
          </Button>
          <Button
            variant={activeSidebar === "History" ? "secondary" : "ghost"}
            onClick={() => setActiveSidebar("History")}
            size="sm"
          >
            History
          </Button>

          <div style={{ marginLeft: '8px' }}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-[200px] justify-between h-8 bg-panel border-border">
                  <div className="flex items-center gap-2 truncate">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--accent-2)' }}>
                      <circle cx="12" cy="12" r="10"></circle>
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                    </svg>
                    <span className="truncate">{environments.find(e => e.id === activeEnvId)?.name || "No Environment"}</span>
                  </div>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[250px] bg-panel border-border p-2">
                <DropdownMenuLabel className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">Environments</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => setActiveEnvId(null)}
                  className={`flex items-center gap-2 cursor-pointer ${!activeEnvId ? 'text-accent-2 bg-accent-2/10' : ''}`}
                >
                  No Environment
                  {!activeEnvId && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="ml-auto"><polyline points="20 6 9 17 4 12"></polyline></svg>}
                </DropdownMenuItem>
                {environments.length > 0 && <DropdownMenuSeparator className="bg-border" />}
                {environments.map((env) => {
                  const isActive = env.id === activeEnvId;
                  return (
                    <DropdownMenuItem
                      key={env.id}
                      onClick={() => setActiveEnvId(env.id)}
                      className={`flex items-center gap-2 cursor-pointer ${isActive ? 'text-accent-2 bg-accent-2/10' : ''}`}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill={isActive ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={isActive ? "0" : "2"} strokeLinecap="round" strokeLinejoin="round" className="opacity-70">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                      </svg>
                      <span className="truncate">{env.name}</span>
                      {isActive && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="ml-auto"><polyline points="20 6 9 17 4 12"></polyline></svg>}
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuSeparator className="bg-border" />
                <DropdownMenuItem onClick={() => setShowEnvModal(true)} className="flex items-center gap-2 text-muted-foreground cursor-pointer">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                  </svg>
                  Manage Environments
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Input
            className="w-[240px] h-8 bg-panel-2 border-border text-sm"
            placeholder="Search collections, tags, history"
            value={topSearch}
            onChange={(e) => setTopSearch(e.target.value)}
          />
          <Button variant="ghost" size="sm" onClick={() => setShowWorkspace(true)}>Workspace: Default</Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowGitHubSyncModal(true)}
            className="gap-2"
            title={gitHubSyncState.detail || "Open GitHub sync"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>
            GitHub Sync
            {gitHubSyncState.label && gitHubSyncBadgeStyle && (
              <span
                style={{
                  ...gitHubSyncBadgeStyle,
                  marginLeft: 4,
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  lineHeight: 1.4,
                  whiteSpace: "nowrap"
                }}
              >
                {gitHubSyncState.label}
              </span>
            )}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)}>Settings</Button>
        </div>
      </header>

      <div
        className={showRightRail ? layoutStyles.layout : `${layoutStyles.layout} ${layoutStyles.railCollapsed}`}
        style={{
          gridTemplateColumns: showRightRail
            ? `${leftWidth}px 10px 1fr 10px ${rightWidth}px`
            : `${leftWidth}px 10px 1fr 10px 44px`
        }}
      >
        <Sidebar
          activeSidebar={activeSidebar}
          topSearch={topSearch}
          history={history}
          setShowCollectionModal={setShowCollectionModal}
          setShowImportMenu={setShowImportMenu}
          showImportMenu={showImportMenu}
          importCollection={importCollection}
          setShowImportTextModal={setShowImportTextModal}
          setShowImportApiModal={setShowImportApiModal}
          setShowImportCurlModal={setShowImportCurlModal}
          collections={collections}
          activeCollectionId={activeCollectionId}
          setActiveCollectionId={handleCollectionSwitch}
          addCollection={addCollection}
          getActiveCollection={getActiveCollection}
          updateCollectionName={updateCollectionName}
          addFolderToCollection={addFolderToCollection}
          addRequestToCollection={addRequestToCollection}
          updateRequestState={updateRequestState}
          duplicateCollection={duplicateCollection}
          exportCollection={exportCollection}
          moveItemInCollection={moveItemInCollection}
          updateFolderName={updateFolderName}
          deleteFolder={deleteFolder}
          duplicateItem={duplicateItem}
          deleteRequest={deleteRequest}
          updateRequestName={updateRequestName}
          loadRequest={handleRequestClick}
          loadHistoryItem={handleLoadHistory}
          setItemToMove={setItemToMove}
          setMoveTargetId={setMoveTargetId}
          setShowMoveModal={setShowMoveModal}
        />

        <div className={layoutStyles.resizer} onMouseDown={() => setDraggingLeft(true)} />

        <main className={layoutStyles.main} style={{ gridTemplateRows: `${topHeight}px 10px 1fr` }}>
          {/* Protocol-specific request panes — rendered based on the current request's protocol */}
          <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ flex: 1, overflow: "auto" }}>
              {(!protocol || protocol === "http") && (
                <RequestEditor
                  editingMainRequestName={editingMainRequestName}
                  setEditingMainRequestName={setEditingMainRequestName}
                  requestName={requestName}
                  setRequestName={setRequestName}
                  currentRequestId={currentRequestId}
                  updateRequestName={updateRequestName}
                  setShowSnippetModal={setShowSnippetModal}
                  method={method}
                  setMethod={setMethod}
                  updateRequestMethod={updateRequestMethod}
                  url={url}
                  setUrl={setUrl}
                  getEnvVars={getEnvVars}
                  handleUpdateEnvVar={handleUpdateEnvVar}
                  handleSend={handleSend}
                  isSending={isSending}
                  requestTabs={requestTabs}
                  activeRequestTab={activeRequestTab}
                  setActiveRequestTab={setActiveRequestTab}
                  headersMode={headersMode}
                  setHeadersMode={setHeadersMode}
                  bodyType={bodyType}
                  setBodyType={setBodyType}
                  setContentType={setContentType}
                  bodyText={bodyText}
                  setBodyText={setBodyText}
                  showTestOutput={showTestOutput}
                  setShowTestOutput={setShowTestOutput}
                  showTestInput={showTestInput}
                  setShowTestInput={setShowTestInput}
                  testsMode={testsMode}
                  setTestsMode={setTestsMode}
                  runTests={runTests}
                  paramsRows={paramsRows}
                  setParamsRows={setParamsRows}
                  updateRequestState={updateRequestState}
                  headersRows={headersRows}
                  handleHeadersRowsChange={handleHeadersRowsChange}
                  headersText={headersText}
                  handleHeadersTextChange={handleHeadersTextChange}
                  authType={authType}
                  setAuthType={setAuthType}
                  authConfig={authConfig}
                  setAuthConfig={setAuthConfig}
                  authRows={authRows}
                  setAuthRows={setAuthRows}
                  httpVersion={httpVersion}
                  setHttpVersion={setHttpVersion}
                  requestTimeoutMs={requestTimeoutMs}
                  setRequestTimeoutMs={setRequestTimeoutMs}
                  setCmEnvEdit={setCmEnvEdit}
                  bodyRows={bodyRows}
                  setBodyRows={setBodyRows}
                  testsInputText={testsInputText}
                  setTestsInputText={setTestsInputText}
                  testsPreText={testsPreText}
                  setTestsPreText={setTestsPreText}
                  testsPostText={testsPostText}
                  setTestsPostText={setTestsPostText}
                  testsOutput={testsOutput}
                  handleCancelSend={handleCancelHttpSend}
                />
              )}
              {protocol === "graphql" && (
                <GraphQLPane
                  url={url}
                  setUrl={setUrl}
                  config={graphqlConfig}
                  setConfig={setGraphqlConfig}
                  onSend={handleGraphQLSend}
                  isSending={isSending}
                  response={graphqlResponse}
                />
              )}
              {protocol === "websocket" && (
                <WebSocketPane
                  url={url}
                  setUrl={setUrl}
                  config={wsConfig}
                  setConfig={setWsConfig}
                  currentRequestId={currentRequestId}
                  updateRequestState={updateRequestState}
                  getEnvVars={getEnvVars}
                  interpolate={interpolate}
                  clearSignal={wsClearSignal}
                  onResponseChange={(nextResponse) => setActiveProtocolResponse("websocket", nextResponse)}
                />
              )}
              {protocol === "grpc" && (
                <GrpcPane
                  url={url}
                  setUrl={setUrl}
                  config={grpcConfig}
                  setConfig={setGrpcConfig}
                  onSend={handleGrpcSend}
                  isSending={isSending}
                  response={grpcResponse}
                />
              )}
              {protocol === "mock" && (
                <MockServerPane
                  collections={collections}
                />
              )}
              {protocol === "sse" && (
                <SseSocketPane
                  url={url}
                  setUrl={setUrl}
                />
              )}
              {protocol === "mcp" && (
                <McpPane
                  url={url}
                  setUrl={setUrl}
                />
              )}
              {protocol === "dag" && (
                <DagFlowPane
                  collections={collections}
                />
              )}
            </div>
          </div>

          <div className={`${layoutStyles.resizer} ${layoutStyles.vertical}`} onMouseDown={() => setDraggingMain(true)} />

          <ResponseViewer
            response={response}
            responseTabs={responseTabs}
            activeResponseTab={activeResponseTab}
            setActiveResponseTab={setActiveResponseTab}
            error={error}
            pretty={pretty}
            raw={raw}
            xml={xml}
            handleXmlToJson={handleXmlToJson}
            search={search}
            setSearch={setSearch}
            searchKey={searchKey}
            setSearchKey={setSearchKey}
            computedRows={computedRows}
            selectedTablePath={selectedTablePath}
            setSelectedTablePath={setSelectedTablePath}
            tableCandidates={tableCandidates}
            sortKey={sortKey}
            setSortKey={setSortKey}
            sortDirection={sortDirection}
            setSortDirection={setSortDirection}
            downloadText={downloadText}
            csv={csv}
            tableRows={tableRows}
            derivedName={derivedName}
            setDerivedName={setDerivedName}
            derivedExpr={derivedExpr}
            setDerivedExpr={setDerivedExpr}
            handleAddDerivedField={handleAddDerivedField}
            handleSort={handleSort}
            responseSummary={responseSummary}
            isSending={isSending}
            onClearWebSocketMessages={() => setWsClearSignal((prev) => prev + 1)}
          />
        </main>

        <div className={layoutStyles.resizer} onMouseDown={() => setDraggingRight(true)} />

        <RightRail
          activeRightTab={activeRightTab}
          setActiveRightTab={setActiveRightTab}
          showRightRail={showRightRail}
          setShowRightRail={setShowRightRail}
          responseSummary={responseSummary}
          setResponseSummary={setResponseSummary}
          response={response}
          isAiTyping={isAiTyping}
          aiChatHistory={aiChatHistory}
          aiChatSessions={aiChatSessions}
          activeAiSessionId={activeAiSessionId}
          setActiveAiSessionId={setActiveAiSessionId}
          createNewAiSession={createNewAiSession}
          aiPrompt={aiPrompt}
          setAiPrompt={setAiPrompt}
          handleAiChatSubmit={handleAiChatSubmit}
          handleChatKeyDown={handleChatKeyDown}
          setMethod={setMethod}
          setUrl={setUrl}
          setHeadersText={setHeadersText}
          setBodyText={setBodyText}
          aiProvider={aiProvider}
          activeModel={activeModel}
          setActiveModel={setActiveModel}
          availableModels={availableModels}
          chatEndRef={chatEndRef}
          history={history}
          setHistory={setHistory}
          testsOutput={testsOutput}
          appLogs={appLogs}
          setAppLogs={setAppLogs}
        />
      </div>

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          aiProvider={aiProvider}
          setAiProvider={setAiProvider}
          aiApiKeyOpenAI={aiApiKeyOpenAI}
          setAiApiKeyOpenAI={setAiApiKeyOpenAI}
          aiApiKeyAnthropic={aiApiKeyAnthropic}
          setAiApiKeyAnthropic={setAiApiKeyAnthropic}
          aiApiKeyGemini={aiApiKeyGemini}
          setAiApiKeyGemini={setAiApiKeyGemini}
          aiSemanticSearchEnabled={aiSemanticSearchEnabled}
          setAiSemanticSearchEnabled={setAiSemanticSearchEnabled}
          semanticProgress={semanticProgress}
          historyRetentionDays={historyRetentionDays}
          setHistoryRetentionDays={setHistoryRetentionDays}
        />
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


      <ExportModal
        showExportModal={showExportModal}
        setShowExportModal={setShowExportModal}
        exportTargetNode={exportTargetNode}
        exportSelections={exportSelections}
        setExportSelections={setExportSelections}
        exportInterpolate={exportInterpolate}
        setExportInterpolate={setExportInterpolate}
        renderExportTree={renderExportTree}
        getExportPayload={getExportPayload}
      />

      <GitHubSyncModal
        isOpen={showGitHubSyncModal}
        onClose={() => setShowGitHubSyncModal(false)}
        onSyncStateChange={handleGitHubSyncStateChange}
        onPulledState={handlePulledState}
      />

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

      <EnvironmentModal
        showEnvModal={showEnvModal}
        setShowEnvModal={setShowEnvModal}
        environments={environments}
        setEnvironments={setEnvironments}
        activeEnvId={activeEnvId}
        setActiveEnvId={setActiveEnvId}
        getActiveEnv={getActiveEnv}
        getEnvVars={getEnvVars}
        handleUpdateEnvVar={handleUpdateEnvVar}
      />

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
                        <button className="ghost env-select" onClick={() => {
                          handleCollectionSwitch(col.id);
                          setManageItemSelections(new Set());
                        }}>
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
                      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '0.9rem', color: 'var(--text)' }}>
                            Contents of {getActiveCollection()?.name || "Untitled"}
                          </span>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button className="ghost compact" style={{ fontSize: '11px', padding: '2px 8px' }} onClick={() => {
                              const activeCol = getActiveCollection();
                              if (!activeCol) return;
                              const allIds = new Set();
                              const collectIds = (n) => { allIds.add(n.id); if (n.items) n.items.forEach(collectIds); };
                              collectIds(activeCol);
                              setManageItemSelections(allIds);
                            }}>Select All</button>
                            <button className="ghost compact" style={{ fontSize: '11px', padding: '2px 8px' }} onClick={() => setManageItemSelections(new Set())}>None</button>
                          </div>
                        </div>

                        <div className="export-list" style={{ flex: 1, minHeight: 0 }}>
                          {getActiveCollection() ? renderManageTree(getActiveCollection()) : null}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                          <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                            {manageItemSelections.size} items selected
                          </div>
                          <button
                            className="ghost"
                            style={{ color: 'var(--accent-red)', borderColor: 'var(--border)' }}
                            disabled={manageItemSelections.size === 0}
                            onClick={() => {
                              if (!window.confirm(`Are you sure you want to delete ${manageItemSelections.size} items?`)) return;
                              manageItemSelections.forEach((id) => {
                                if (id.startsWith('req-')) deleteRequest(id);
                                else if (id.startsWith('fld-')) deleteFolder(id);
                              });
                              setManageItemSelections(new Set());
                              if (manageItemSelections.has(currentRequestId)) {
                                setCurrentRequestId("");
                              }
                            }}
                          >
                            Delete Selected Items
                          </button>
                        </div>
                      </div>
                      <div className="modal-footer">
                        <button className="primary" onClick={() => setShowCollectionModal(false)}>Done</button>
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

      {showSnippetModal && (
        <div className="modal-backdrop" onClick={() => setShowSnippetModal(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()} style={{ width: '800px', maxWidth: '90vw' }}>
            <div className="modal-title">
              <div>Export Code Snippet</div>
              <button className="ghost icon-button" onClick={() => setShowSnippetModal(false)} style={{ margin: "-8px", padding: "8px" }}>✕</button>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'center' }}>
              <SnippetLanguageSelector
                value={snippetLanguage}
                onChange={(val) => setSnippetLanguage(val)}
              />
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
                onClick={() => navigator.clipboard.writeText(generateSnippet())}
              >
                Copy to Clipboard
              </button>
            </div>
          </div>
        </div>
      )}

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
          <div className="modal-backdrop" onClick={() => setShowImportTextModal(false)} style={{ zIndex: 9999 }}>
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
        showImportCurlModal && (
          <div className="modal-backdrop" onClick={() => setShowImportCurlModal(false)} style={{ zIndex: 9999 }}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-title">Import Request from cURL</div>
              <textarea
                className="input code-editor"
                value={importCurlDraft}
                onChange={(e) => setImportCurlDraft(e.target.value)}
                placeholder="Paste a cURL command here..."
                style={{ width: '100%', height: '220px', marginBottom: '10px' }}
              />
              <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '-4px' }}>
                Supports common flags like -X, -H, -d, --data-raw, -F, -G, --url and -u.
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button className="ghost" onClick={() => setShowImportCurlModal(false)}>Cancel</button>
                <button className="primary" onClick={handleImportCurlSubmit}>Import</button>
              </div>
            </div>
          </div>
        )
      }

      {
        showImportApiModal && (
          <div className="modal-backdrop" onClick={() => setShowImportApiModal(false)} style={{ zIndex: 9999 }}>
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
