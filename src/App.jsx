import React, { useEffect, useMemo, useState } from "react";
import { generateRequestFromPrompt, generateTestsFromResponse, summarizeResponse } from "./services/ai.js";
import { jsonToCsv, jsonToXml, xmlToJson } from "./services/format.js";
import { applyDerivedFields, filterRows, sortRows } from "./services/table.js";

const responseTabs = ["Pretty", "Raw", "XML", "Table", "Visualize"];
const requestTabs = ["Params", "Headers", "Auth", "Body", "Tests"];
const templates = [
  { id: "crud", label: "CRUD (REST)" },
  { id: "graphql", label: "GraphQL" },
  { id: "auth", label: "Auth / Token" },
  { id: "webhook", label: "Webhook Receiver" },
  { id: "search", label: "Search / Query" }
];

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
    const match = part.match(/(\\w+)\\[(\\d+)\\]/);
    if (match) return [match[1], Number(match[2])];
    return [part];
  });
  return parts.reduce((acc, key) => (acc == null ? acc : acc[key]), root);
}

function TableEditor({ rows, onChange, keyPlaceholder, valuePlaceholder }) {
  function updateRow(index, field, value) {
    const next = rows.map((row, idx) => (idx === index ? { ...row, [field]: value } : row));
    onChange(next);
  }

  function addRow() {
    onChange([...rows, { key: "", value: "", enabled: true }]);
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
        <div className="table-editor-actions">
          <button className="ghost" onClick={addRow}>Add</button>
        </div>
      </div>
      {rows.map((row, idx) => (
        <div className={row.enabled ? "table-editor-row active" : "table-editor-row"} key={idx}>
          <label className="table-editor-toggle">
            <input
              type="checkbox"
              checked={row.enabled ?? true}
              onChange={(e) => updateRow(idx, "enabled", e.target.checked)}
            />
          </label>
          <input
            className="input"
            value={row.key}
            placeholder={keyPlaceholder}
            onChange={(e) => updateRow(idx, "key", e.target.value)}
          />
          <input
            className="input"
            value={row.value}
            placeholder={valuePlaceholder}
            onChange={(e) => updateRow(idx, "value", e.target.value)}
          />
          <button className="ghost" onClick={() => removeRow(idx)}>Remove</button>
        </div>
      ))}
    </div>
  );
}

function App() {
  const [activeRequestTab, setActiveRequestTab] = useState("Body");
  const [activeResponseTab, setActiveResponseTab] = useState("Pretty");
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("https://api.example.com/users");
  const [headersText, setHeadersText] = useState("{\n  \"Content-Type\": \"application/json\"\n}");
  const [bodyText, setBodyText] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [templateId, setTemplateId] = useState("");

  const [response, setResponse] = useState(null);
  const [responseSummary, setResponseSummary] = useState({ summary: "No response yet.", hints: [] });
  const [error, setError] = useState("");
  const [activeSidebar, setActiveSidebar] = useState("Collections");
  const [showSettings, setShowSettings] = useState(false);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [showRightRail, setShowRightRail] = useState(true);
  const [collections, setCollections] = useState([
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
  const [activeCollectionId, setActiveCollectionId] = useState("col-default");
  const [environments, setEnvironments] = useState([
    {
      id: "env-default",
      name: "Local",
      vars: [{ key: "baseUrl", value: "https://api.example.com", enabled: true }]
    }
  ]);
  const [activeEnvId, setActiveEnvId] = useState("env-default");

  const [paramsRows, setParamsRows] = useState([{ key: "", value: "", enabled: true }]);
  const [headersRows, setHeadersRows] = useState([{ key: "Content-Type", value: "application/json", enabled: true }]);
  const [authRows, setAuthRows] = useState([{ key: "Authorization", value: "Bearer <token>", enabled: false }]);
  const [bodyType, setBodyType] = useState("json");
  const [bodyRows, setBodyRows] = useState([{ key: "", value: "", enabled: true }]);
  const [testsPreText, setTestsPreText] = useState("");
  const [testsPostText, setTestsPostText] = useState("");
  const [testsInputText, setTestsInputText] = useState("{\n  \"status\": 200,\n  \"body\": {\"ok\": true}\n}");
  const [testsOutput, setTestsOutput] = useState([]);
  const [headersMode, setHeadersMode] = useState("table");
  const [testsMode, setTestsMode] = useState("post");
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
  const [importTextDraft, setImportTextDraft] = useState("");
  const [importApiDraft, setImportApiDraft] = useState("");
  const [editingCollectionName, setEditingCollectionName] = useState(false);
  const [collectionNameDraft, setCollectionNameDraft] = useState("");
  const [editingFolderId, setEditingFolderId] = useState("");
  const [folderNameDraft, setFolderNameDraft] = useState("");
  const [openFolderMenuId, setOpenFolderMenuId] = useState("");
  const [requestName, setRequestName] = useState("/users");
  const [currentRequestId, setCurrentRequestId] = useState("");
  const [editingRequestId, setEditingRequestId] = useState("");
  const [requestNameDraft, setRequestNameDraft] = useState("");
  const [editingMainRequestName, setEditingMainRequestName] = useState(false);
  const [topSearch, setTopSearch] = useState("");

  const [leftWidth, setLeftWidth] = useState(260);
  const [rightWidth, setRightWidth] = useState(260);
  const [topHeight, setTopHeight] = useState(window.innerHeight / 2);
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
      const authHeaders = authRows
        .filter((row) => row.key && row.enabled !== false)
        .reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
      return { ...authHeaders, ...parsed };
    } catch (err) {
      setError("Headers must be valid JSON.");
      return null;
    }
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
          if (!imported.id) {
            alert("Invalid collection format.");
            return;
          }
          imported.id = `col-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
          setCollections((prev) => [...prev, imported]);
          setActiveCollectionId(imported.id);
        } catch (err) {
          alert("Failed to parse JSON file.");
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
      if (!imported.id) {
        alert("Invalid collection format. Expected an object with an 'id'.");
        return;
      }
      imported.id = `col-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      setCollections((prev) => [...prev, imported]);
      setActiveCollectionId(imported.id);
      setShowImportTextModal(false);
      setImportTextDraft("");
    } catch (err) {
      alert("Failed to parse the provided text as JSON.");
    }
  }

  function handleImportApiSubmit() {
    if (!importApiDraft) return;
    fetch(importApiDraft)
      .then(res => res.json())
      .then(imported => {
        if (!imported.id) {
          alert("Invalid collection format. Expected an object with an 'id'.");
          return;
        }
        imported.id = `col-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        setCollections((prev) => [...prev, imported]);
        setActiveCollectionId(imported.id);
        setShowImportApiModal(false);
        setImportApiDraft("");
      })
      .catch(err => {
        alert("Failed to fetch or parse the collection from the URL.");
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
    setBodyRows(req.bodyRows || [{ key: "", value: "", enabled: true }]);
  }

  function updateRequestName(requestId, name) {
    const updateItems = (items) =>
      items.map((item) => {
        if (item.type === "folder") {
          return { ...item, items: updateItems(item.items || []) };
        }
        if (item.type === "request" && item.id === requestId) {
          return { ...item, name };
        }
        return item;
      });
    setCollections((prev) =>
      prev.map((col) =>
        col.id === activeCollectionId ? { ...col, items: updateItems(col.items || []) } : col
      )
    );
  }

  function updateRequestMethod(requestId, method) {
    const updateItems = (items) =>
      items.map((item) => {
        if (item.type === "folder") {
          return { ...item, items: updateItems(item.items || []) };
        }
        if (item.type === "request" && item.id === requestId) {
          return { ...item, method };
        }
        return item;
      });
    setCollections((prev) =>
      prev.map((col) =>
        col.id === activeCollectionId ? { ...col, items: updateItems(col.items || []) } : col
      )
    );
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

  function interpolate(value) {
    if (typeof value !== "string") return value;
    const vars = getEnvVars();
    return value.replace(/\\{\\{(.*?)\\}\\}/g, (_match, key) => {
      const trimmed = String(key).trim();
      return Object.prototype.hasOwnProperty.call(vars, trimmed) ? vars[trimmed] : "";
    });
  }

  function rowsToObject(rows) {
    return rows
      .filter((row) => row.key && row.enabled !== false)
      .reduce((acc, row) => ({ ...acc, [row.key]: interpolate(row.value) }), {});
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

  function buildUrlWithParams() {
    if (!paramsRows.length) return url;
    const base = interpolate(url || "");
    const query = paramsRows
      .filter((row) => row.key && row.enabled !== false)
      .map((row) => `${encodeURIComponent(row.key)}=${encodeURIComponent(interpolate(row.value || ""))}`)
      .join("&");
    if (!query) return base;
    return base.includes("?") ? `${base}&${query}` : `${base}?${query}`;
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
          <button className="ghost" onClick={() => setShowEnvModal(true)}>Environments</button>
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
                    <div className="menu-wrap">
                      <button
                        className="ghost icon-button"
                        aria-label="Add item"
                        onClick={() => setShowCollectionMenu((prev) => !prev)}
                      >
                        +
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
            <div className="request-title">
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
              <input
                className="input url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <select className="input template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">Template</option>
                {templates.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
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
                    {bodyType === "json" && <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Supports // comments</div>}
                  </>
                )}
                {activeRequestTab === "Tests" && (
                  <>
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
                    <button className="ghost compact" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => setShowTestOutput((prev) => !prev)}>
                      Output
                    </button>
                    <button className="ghost compact" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => setShowTestInput((prev) => !prev)}>
                      Test Input
                    </button>
                    <button className="primary compact" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={runTests}>Run Tests</button>
                  </>
                )}
              </div>
            </div>

            <div className="editor">
              {activeRequestTab === "Params" && (
                <TableEditor
                  rows={paramsRows}
                  onChange={setParamsRows}
                  keyPlaceholder="Param"
                  valuePlaceholder="Value"
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
                <TableEditor
                  rows={authRows}
                  onChange={setAuthRows}
                  keyPlaceholder="Auth key"
                  valuePlaceholder="Value"
                />
              )}
              {activeRequestTab === "Body" && (
                <div className="body-editor">
                  {(bodyType === "json" || bodyType === "xml" || bodyType === "raw") && (
                    <textarea
                      className="textarea fixed"
                      value={bodyText}
                      onChange={(e) => setBodyText(e.target.value)}
                    />
                  )}
                  {(bodyType === "form" || bodyType === "multipart") && (
                    <TableEditor
                      rows={bodyRows}
                      onChange={setBodyRows}
                      keyPlaceholder="Field"
                      valuePlaceholder="Value"
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
            <div className="response-meta">
              <div>Status: {response?.status ? `${response.status} ${response.statusText}` : "-"}</div>
              <div>Latency: {response?.duration ? `${response.duration} ms` : "-"}</div>
              <div>Size: {response?.body ? `${response.body.length} bytes` : "-"}</div>
            </div>

            {error && <div className="error">{error}</div>}

            <div className="tabs">
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

            <div className="response-body">
              {activeResponseTab === "Pretty" && (
                <pre className="code">{pretty || "No response yet."}</pre>
              )}
              {activeResponseTab === "Raw" && (
                <pre className="code">{raw || "No response yet."}</pre>
              )}
              {activeResponseTab === "XML" && (
                <div className="split">
                  <pre className="code">{xml || raw || "No XML available."}</pre>
                  <div className="inline-actions">
                    <button className="ghost" onClick={handleXmlToJson}>XML → JSON</button>
                    <button className="ghost" onClick={() => navigator.clipboard.writeText(xml || raw || "")}>Copy XML</button>
                  </div>
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

      {showEnvModal && (
        <div className="modal-backdrop" onClick={() => setShowEnvModal(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Environments</div>
            <div className="env-layout">
              <div className="env-sidebar">
                <div className="env-sidebar-header">
                  <div className="field-label">Select env</div>
                  <button
                    className="ghost"
                    onClick={() => {
                      const id = `env-${Date.now()}`;
                      setEnvironments((prev) => [
                        ...prev,
                        { id, name: `Env ${prev.length + 1}`, vars: [{ key: "", value: "", enabled: true }] }
                      ]);
                      setActiveEnvId(id);
                    }}
                  >
                    Create Env
                  </button>
                </div>
                <div className="env-list scroll">
                  {environments.map((env) => (
                    <label key={env.id} className={activeEnvId === env.id ? "env-item active" : "env-item"}>
                      <input
                        type="checkbox"
                        checked={selectedEnvIds.includes(env.id)}
                        onChange={(e) => {
                          setSelectedEnvIds((prev) =>
                            e.target.checked ? [...prev, env.id] : prev.filter((id) => id !== env.id)
                          );
                        }}
                      />
                      <button
                        className="ghost env-select"
                        onClick={() => setActiveEnvId(env.id)}
                      >
                        {env.name}
                      </button>
                    </label>
                  ))}
                </div>
                <button
                  className="ghost"
                  onClick={() => {
                    if (selectedEnvIds.length === 0) return;
                    const remaining = environments.filter((env) => !selectedEnvIds.includes(env.id));
                    setEnvironments(remaining);
                    if (remaining.length === 0) {
                      setActiveEnvId("");
                    } else if (!remaining.find((env) => env.id === activeEnvId)) {
                      setActiveEnvId(remaining[0].id);
                    }
                    setSelectedEnvIds([]);
                  }}
                >
                  Delete Selected
                </button>
              </div>

              <div className="env-editor">
                {getActiveEnv() ? (
                  <>
                    <div className="panel-row">
                      <input
                        className="input"
                        placeholder="Environment name"
                        value={getActiveEnv()?.name || ""}
                        onChange={(e) =>
                          setEnvironments((prev) =>
                            prev.map((env) =>
                              env.id === activeEnvId ? { ...env, name: e.target.value } : env
                            )
                          )
                        }
                      />
                    </div>
                    <div className="env-vars">
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
                      />
                    </div>
                    <div className="panel-body">
                      Use in requests as <code>{"{{baseUrl}}"}</code>
                    </div>
                    <div className="modal-footer">
                      <button className="primary" onClick={() => setShowEnvModal(false)}>Save Environment</button>
                    </div>
                  </>
                ) : (
                  <div className="empty-state">
                    No Environments. Create one from the left panel.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showCollectionModal && (
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
      )}

      {showImportTextModal && (
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
      )}

      {showImportApiModal && (
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
      )}

      {showMoveModal && itemToMove && (
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
      )}
    </div>
  );
}

export default App;
